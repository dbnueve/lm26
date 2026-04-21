"""Phase 2e smoke test for the MP-as-shared-solo refactor.

Verifies in-process (no running uvicorn needed) that:
  1. `POST /api/mp2/create` creates a session with an isolated state clone.
  2. `POST /api/mp2/join` lets a second player join via the join code.
  3. `GET /api/mp2/{sid}/info` returns the public view with `my_team_id`.
  4. `POST /api/mp2/{sid}/team` assigns a team to the player token.
  5. `use_session_state(sid)` swaps `GAME_STATE` in-process so that solo
     logic can read/write the session's state transparently.
  6. The solo `GAME_STATE` is restored unchanged after the swap exits.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make `backend/` importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sessions  # noqa: E402
import server  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Isolate MP2 storage per-test and reset the in-memory registry."""
    monkeypatch.setattr(sessions, "SESSIONS_DIR", tmp_path)
    sessions._reset_for_tests()
    with TestClient(server.app) as c:
        yield c
    sessions._reset_for_tests()


def test_create_and_join_roundtrip(client):
    # 1. Create
    r = client.post("/api/mp2/create", json={"league": "LEC", "username": "alice"})
    assert r.status_code == 200, r.text
    created = r.json()
    sid, code, token_a = created["sid"], created["code"], created["token"]
    assert len(code) == 6
    assert created["info"]["league"] == "LEC"
    assert created["info"]["phase"] == "team_pick"

    # 2. Join
    r = client.post("/api/mp2/join", json={"code": code, "username": "bob"})
    assert r.status_code == 200, r.text
    joined = r.json()
    assert joined["sid"] == sid
    token_b = joined["token"]
    assert token_a != token_b

    # 3. Info for each player
    r_a = client.get(f"/api/mp2/{sid}/info", params={"token": token_a}).json()
    r_b = client.get(f"/api/mp2/{sid}/info", params={"token": token_b}).json()
    assert len(r_a["players"]) == 2
    assert r_a["my_team_id"] is None
    assert r_b["my_team_id"] is None


def test_assign_team(client):
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, token = created["sid"], created["token"]

    # Pick first team from the session's state
    sess = sessions.get_session(sid)
    team_id = next(iter(sess.state["teams"]))

    r = client.post(
        f"/api/mp2/{sid}/team", json={"token": token, "team_id": team_id}
    )
    assert r.status_code == 200, r.text
    assert r.json()["my_team_id"] == team_id


def test_invalid_join_code_returns_404(client):
    r = client.post("/api/mp2/join", json={"code": "ZZZZZZ", "username": "bob"})
    assert r.status_code == 404


def test_info_for_unknown_session_returns_404(client):
    r = client.get("/api/mp2/does-not-exist/info")
    assert r.status_code == 404


def test_swap_isolates_session_state_from_solo(client):
    """Core guarantee of MP-as-shared-solo: `use_session_state` swaps
    `GAME_STATE` in place so solo endpoints work untouched, then restores
    the solo state on exit with mutations persisted to the session dict.
    """
    # Ensure solo state is initialized with a known league
    server.ensure_initialized()
    solo_league = server.GAME_STATE.get("league")
    solo_week = server.GAME_STATE.get("current_week")
    assert solo_league is not None

    # Create an MP session on a DIFFERENT league so the swap is observable
    mp_league = "LPL" if solo_league != "LPL" else "LCK"
    created = client.post(
        "/api/mp2/create", json={"league": mp_league, "username": "alice"}
    ).json()
    sid = created["sid"]

    async def _run() -> None:
        # Before swap: solo state intact
        assert server.GAME_STATE["league"] == solo_league

        async with server.use_session_state(sid) as sess:
            # Inside swap: GAME_STATE points at the session's state
            assert server.GAME_STATE["league"] == mp_league
            assert sess is not None
            # Mutate via GAME_STATE — the session should see it after exit
            server.GAME_STATE["current_week"] = 42

        # After swap: solo state restored untouched
        assert server.GAME_STATE["league"] == solo_league
        assert server.GAME_STATE.get("current_week") == solo_week

        # Mutation persisted into the session
        assert sessions.get_state(sid)["current_week"] == 42
        # Session marked dirty for autosave
        assert sessions.get_session(sid)._dirty is True

    asyncio.run(_run())


def test_swap_with_none_session_id_is_noop(client):
    server.ensure_initialized()
    before = dict(server.GAME_STATE)

    async def _run() -> None:
        async with server.use_session_state(None) as sess:
            assert sess is None
            # GAME_STATE untouched
            assert server.GAME_STATE["league"] == before["league"]

    asyncio.run(_run())


def test_swap_with_unknown_session_raises(client):
    async def _run() -> None:
        with pytest.raises(Exception):  # HTTPException
            async with server.use_session_state("does-not-exist"):
                pass  # pragma: no cover

    asyncio.run(_run())
