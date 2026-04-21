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


# ── Phase 3: middleware routes solo endpoints to session state ───────────────
def test_middleware_routes_solo_endpoint_to_session(client):
    """Key guarantee of Phase 3: `GET /api/game/state?session_id=X` reads the
    MP session's state, not the global solo state. Same endpoint, same code
    path, transparently multiplayer.
    """
    server.ensure_initialized()
    solo_league = server.GAME_STATE.get("league")
    mp_league = "LPL" if solo_league != "LPL" else "LCK"

    created = client.post(
        "/api/mp2/create", json={"league": mp_league, "username": "alice"}
    ).json()
    sid = created["sid"]

    # Solo call (no session_id) — sees solo state
    r_solo = client.get("/api/game/state").json()
    assert r_solo["initialized"] is True

    # MP call — sees the session's state. Phase isn't in solo-state shape,
    # but the endpoint should respond 200 and return the session's phase.
    r_mp = client.get("/api/game/state", params={"session_id": sid})
    assert r_mp.status_code == 200, r_mp.text

    # Solo state untouched after the MP call
    r_solo_after = client.get("/api/game/state").json()
    assert r_solo_after["current_week"] == r_solo["current_week"]


def test_middleware_returns_404_on_unknown_session(client):
    r = client.get(
        "/api/game/state", params={"session_id": "does-not-exist"}
    )
    assert r.status_code == 404
    assert "introuvable" in r.json()["detail"].lower()


# ── Phase 4: WebSocket smoke ─────────────────────────────────────────────────
def test_ws_rejects_unknown_session(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/mp2/does-not-exist?token=abc"):
            pass  # pragma: no cover


def test_ws_rejects_bad_token(client):
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid = created["sid"]
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/mp2/{sid}?token=wrongtoken"):
            pass  # pragma: no cover


def test_ws_hello_and_chat_fanout(client):
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok_a = created["sid"], created["token"]
    joined = client.post(
        "/api/mp2/join", json={"code": created["code"], "username": "bob"}
    ).json()
    tok_b = joined["token"]

    with client.websocket_connect(f"/ws/mp2/{sid}?token={tok_a}") as ws_a:
        hello_a = ws_a.receive_json()
        assert hello_a["event"] == "hello"
        assert hello_a["data"]["code"] == created["code"]

        # alice's own peer_joined broadcast also lands on her own socket
        self_join = ws_a.receive_json()
        assert self_join == {"event": "peer_joined",
                             "data": {"username": "alice"}}

        with client.websocket_connect(f"/ws/mp2/{sid}?token={tok_b}") as ws_b:
            # bob joining triggers peer_joined that alice receives
            bob_join_on_a = ws_a.receive_json()
            assert bob_join_on_a == {"event": "peer_joined",
                                     "data": {"username": "bob"}}

            # bob receives his own hello + self peer_joined
            hello_b = ws_b.receive_json()
            assert hello_b["event"] == "hello"
            self_join_b = ws_b.receive_json()
            assert self_join_b == {"event": "peer_joined",
                                   "data": {"username": "bob"}}

            # bob sends a chat; both sockets should receive it
            ws_b.send_json({"type": "chat", "text": "gl hf"})
            chat_on_a = ws_a.receive_json()
            assert chat_on_a == {"event": "chat",
                                 "data": {"username": "bob", "text": "gl hf"}}
            chat_on_b = ws_b.receive_json()
            assert chat_on_b["event"] == "chat"


def test_mutating_solo_endpoint_broadcasts_state_changed(client):
    """Phase 5b auto-broadcast: a successful POST on a solo endpoint routed
    through the middleware emits `state_changed` to every MP2 subscriber.
    """
    # Alice creates + picks a team so she's a "real" player in the session
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok_a = created["sid"], created["token"]
    sess = sessions.get_session(sid)
    team_id = next(iter(sess.state["teams"]))
    client.post(
        f"/api/mp2/{sid}/team", json={"token": tok_a, "team_id": team_id}
    )

    # Bob joins
    joined = client.post(
        "/api/mp2/join", json={"code": created["code"], "username": "bob"}
    ).json()
    tok_b = joined["token"]

    with client.websocket_connect(f"/ws/mp2/{sid}?token={tok_b}") as ws_b:
        # Drain hello + self peer_joined
        assert ws_b.receive_json()["event"] == "hello"
        assert ws_b.receive_json()["event"] == "peer_joined"

        # Alice triggers a mutating solo endpoint with session_id
        # (POST /api/tactics — updates session state and calls save_state)
        r = client.post(
            "/api/tactics",
            params={"session_id": sid},
            json={"strong_side": "top"},
        )
        assert r.status_code == 200, r.text

        # Bob's WS should now receive state_changed
        evt = ws_b.receive_json()
        assert evt["event"] == "state_changed"
        assert evt["data"]["path"] == "/api/tactics"
        assert evt["data"]["method"] == "POST"


def test_get_endpoint_does_not_broadcast(client):
    """GETs don't mutate — they should NOT trigger a broadcast."""
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok = created["sid"], created["token"]

    with client.websocket_connect(f"/ws/mp2/{sid}?token={tok}") as ws:
        assert ws.receive_json()["event"] == "hello"
        assert ws.receive_json()["event"] == "peer_joined"

        # Read-only call
        r = client.get("/api/game/state", params={"session_id": sid})
        assert r.status_code == 200

        # Set a short timeout and expect nothing more
        import queue
        try:
            # TestClient's websocket doesn't expose a proper timeout; we rely
            # on the next receive to block. Instead we send a cheap roundtrip
            # (chat) and assert it is the first message, proving no earlier
            # state_changed is queued.
            ws.send_json({"type": "chat", "text": "probe"})
            evt = ws.receive_json()
            assert evt["event"] == "chat", (
                f"expected chat as next event, got {evt['event']} — "
                "GET triggered an unexpected broadcast"
            )
        except queue.Empty:
            pass


def test_middleware_mutation_persists_to_session(client):
    """Call a solo endpoint that mutates state with ?session_id=X and confirm
    the mutation lands in the session, not in solo.
    """
    server.ensure_initialized()
    solo_week = server.GAME_STATE.get("current_week")

    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid = created["sid"]

    # Directly poke the session state to simulate a mutation that happened
    # inside a solo endpoint that we route through the middleware.
    # (A real solo endpoint that advances weeks would do the same, but most
    # mutating endpoints require complex setup; we prove the plumbing here.)
    async def _run() -> None:
        async with server.use_session_state(sid):
            server.GAME_STATE["current_week"] = 99

    asyncio.run(_run())

    assert sessions.get_state(sid)["current_week"] == 99
    # Solo state still unchanged
    assert server.GAME_STATE.get("current_week") == solo_week
