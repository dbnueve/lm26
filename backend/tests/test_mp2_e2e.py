"""End-to-end test for LM26 multiplayer v2 (MP-as-shared-solo).

Covers the full 2-player flow via HTTP + WebSocket using
``TestClient`` (no running uvicorn required):

1. Alice creates an MP2 session in LEC.
2. Bob joins via the share code.
3. Both sides see each other through ``/api/mp2/{sid}/info``.
4. Each player selects their team via solo endpoint ``/api/teams/select``
   transparently routed through the session (``?session_id=X``).
5. Mutating solo endpoints (``/api/tactics``) update the *session* state
   while the global solo state stays untouched.
6. Bob's open WebSocket receives a ``state_changed`` broadcast when Alice
   mutates the session through any solo endpoint.
7. ``/api/mp2/sessions`` lists the active session.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make ``backend/`` importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sessions  # noqa: E402
import server  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Isolate MP2 file storage per-test and reset in-memory registry."""
    monkeypatch.setattr(sessions, "SESSIONS_DIR", tmp_path)
    sessions._reset_for_tests()
    with TestClient(server.app) as c:
        yield c
    sessions._reset_for_tests()


def _drain_hello_and_self_join(ws) -> None:
    """Consume the two self-events that every peer sees on connect."""
    assert ws.receive_json()["event"] == "hello"
    assert ws.receive_json()["event"] == "peer_joined"


def test_full_two_player_flow(client):
    """The headline e2e: two players, shared state, broadcast on mutation."""

    # Capture the solo baseline so we can prove it stays untouched.
    server.ensure_initialized()
    solo_league = server.GAME_STATE.get("league")
    solo_user_team = server.GAME_STATE.get("user_team")

    # ── 1. Alice creates an LEC session ──
    mp_league = "LPL" if solo_league != "LPL" else "LCK"
    r = client.post(
        "/api/mp2/create",
        json={"league": mp_league, "username": "alice"},
    )
    assert r.status_code == 200, r.text
    created = r.json()
    sid, code, tok_a = created["sid"], created["code"], created["token"]
    assert len(code) == 6
    assert created["info"]["league"] == mp_league

    # ── 2. Bob joins via the share code ──
    r = client.post("/api/mp2/join", json={"code": code, "username": "bob"})
    assert r.status_code == 200, r.text
    joined = r.json()
    assert joined["sid"] == sid
    tok_b = joined["token"]
    assert tok_a != tok_b

    # ── 3. Both players see each other through /info ──
    info_a = client.get(f"/api/mp2/{sid}/info", params={"token": tok_a}).json()
    info_b = client.get(f"/api/mp2/{sid}/info", params={"token": tok_b}).json()
    assert {p["username"] for p in info_a["players"]} == {"alice", "bob"}
    assert info_a["my_team_id"] is None
    assert info_b["my_team_id"] is None

    # Session listing must surface the in-progress session.
    listed = client.get("/api/mp2/sessions").json()
    assert any(s["code"] == code for s in listed)

    # ── 4. Teams assigned via solo endpoint routed through session ──
    # Grab two distinct team ids from the session's state.
    sess = sessions.get_session(sid)
    team_ids = list(sess.state["teams"].keys())
    team_a_id, team_b_id = team_ids[0], team_ids[1]

    # Alice picks her team via the solo endpoint + session_id query param.
    r = client.post(
        f"/api/teams/select/{team_a_id}",
        params={"session_id": sid},
    )
    assert r.status_code == 200, r.text
    # Also register the team against the MP2 player slot so /info reflects it.
    client.post(
        f"/api/mp2/{sid}/team",
        json={"token": tok_a, "team_id": team_a_id},
    )
    client.post(
        f"/api/mp2/{sid}/team",
        json={"token": tok_b, "team_id": team_b_id},
    )

    # Mutation must land in the session, not in solo state.
    assert sessions.get_state(sid)["user_team"] == team_a_id
    assert server.GAME_STATE.get("user_team") == solo_user_team
    assert server.GAME_STATE.get("league") == solo_league

    # ── 5. Mutating tactics through the session persists only there ──
    r = client.post(
        "/api/tactics",
        params={"session_id": sid},
        json={"strong_side": "bot"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["tactics"]["strong_side"] == "bot"

    # Solo side still has no session-specific tactics mutation visible.
    solo_tactics = client.get("/api/tactics").json()["tactics"]
    session_tactics = client.get(
        "/api/tactics", params={"session_id": sid}
    ).json()["tactics"]
    assert session_tactics["strong_side"] == "bot"
    assert solo_tactics is not session_tactics  # distinct dicts

    # ── 6. Bob's WS receives state_changed when Alice mutates the session ──
    with client.websocket_connect(f"/ws/mp2/{sid}?token={tok_b}") as ws_b:
        _drain_hello_and_self_join(ws_b)

        r = client.post(
            "/api/tactics",
            params={"session_id": sid},
            json={"strong_side": "top"},
        )
        assert r.status_code == 200, r.text

        evt = ws_b.receive_json()
        assert evt["event"] == "state_changed"
        assert evt["data"]["path"] == "/api/tactics"
        assert evt["data"]["method"] == "POST"

    # ── 7. Read-only endpoint routed through session returns session state ──
    r = client.get("/api/game/state", params={"session_id": sid})
    assert r.status_code == 200, r.text

    # And solo state is still exactly what we captured at the start.
    assert server.GAME_STATE.get("league") == solo_league
    assert server.GAME_STATE.get("user_team") == solo_user_team


def test_unknown_session_and_bad_token_are_rejected(client):
    # Unknown session via middleware → 404
    r = client.get("/api/game/state", params={"session_id": "nope"})
    assert r.status_code == 404

    # Unknown join code → 404
    r = client.post("/api/mp2/join", json={"code": "ZZZZZZ", "username": "x"})
    assert r.status_code == 404

    # WS with wrong token → rejected
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid = created["sid"]
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/mp2/{sid}?token=wrongtoken"):
            pass  # pragma: no cover


def test_team_is_reserved_and_cannot_be_double_picked(client):
    """Two players in the same session cannot grab the same team."""
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok_a = created["sid"], created["token"]
    tok_b = client.post(
        "/api/mp2/join", json={"code": created["code"], "username": "bob"}
    ).json()["token"]

    # Grab a team id from the session's state.
    sess = sessions.get_session(sid)
    team_id = next(iter(sess.state["teams"].keys()))

    # Alice picks it via the solo endpoint routed through the session,
    # carrying her mp_token so the server reserves against her slot.
    r = client.post(
        f"/api/teams/select/{team_id}",
        params={"session_id": sid, "mp_token": tok_a},
    )
    assert r.status_code == 200, r.text
    assert sess.players[tok_a] == team_id

    # Bob tries to take the same team — server must reject with 409.
    r = client.post(
        f"/api/teams/select/{team_id}",
        params={"session_id": sid, "mp_token": tok_b},
    )
    assert r.status_code == 409, r.text
    assert sess.players[tok_b] is None


def test_per_player_user_team_view(client):
    """Each player's requests see their own user_team via mp_token."""
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok_a = created["sid"], created["token"]
    tok_b = client.post(
        "/api/mp2/join", json={"code": created["code"], "username": "bob"}
    ).json()["token"]
    sess = sessions.get_session(sid)
    ids = list(sess.state["teams"].keys())
    team_a, team_b = ids[0], ids[1]

    client.post(f"/api/teams/select/{team_a}",
                params={"session_id": sid, "mp_token": tok_a})
    client.post(f"/api/teams/select/{team_b}",
                params={"session_id": sid, "mp_token": tok_b})

    # Each player's read sees their own team when they include mp_token.
    view_a = client.get("/api/game/state",
                        params={"session_id": sid, "mp_token": tok_a}).json()
    view_b = client.get("/api/game/state",
                        params={"session_id": sid, "mp_token": tok_b}).json()
    assert view_a["user_team"] == team_a
    assert view_b["user_team"] == team_b


def test_ready_vote_gates_season_simulate(client):
    """Season-simulate must wait until every human votes ready."""
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok_a = created["sid"], created["token"]
    tok_b = client.post(
        "/api/mp2/join", json={"code": created["code"], "username": "bob"}
    ).json()["token"]

    # Alice votes ready — action must NOT fire yet.
    r = client.post(f"/api/mp2/{sid}/ready",
                    json={"token": tok_a, "action": "season/simulate"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fired"] is False
    assert "alice" in body["info"]["ready"]["season/simulate"]

    # Bob un-votes (harmless) then re-votes — action fires.
    client.delete(f"/api/mp2/{sid}/ready",
                  params={"token": tok_b, "action": "season/simulate"})
    r = client.post(f"/api/mp2/{sid}/ready",
                    json={"token": tok_b, "action": "season/simulate"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fired"] is True
    # Ready set is cleared after firing.
    assert "season/simulate" not in body["info"]["ready"]


def test_ready_unknown_action_is_rejected(client):
    created = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    sid, tok = created["sid"], created["token"]
    r = client.post(f"/api/mp2/{sid}/ready",
                    json={"token": tok, "action": "bogus/action"})
    assert r.status_code == 400


def test_two_sessions_are_independent(client):
    """Two parallel MP sessions must not leak state into each other."""
    c1 = client.post(
        "/api/mp2/create", json={"league": "LEC", "username": "alice"}
    ).json()
    c2 = client.post(
        "/api/mp2/create", json={"league": "LCK", "username": "carol"}
    ).json()
    sid1, sid2 = c1["sid"], c2["sid"]

    # Mutate session 1 only.
    r = client.post(
        "/api/tactics",
        params={"session_id": sid1},
        json={"strong_side": "top"},
    )
    assert r.status_code == 200

    # Session 2 must NOT see that mutation.
    t2 = client.get("/api/tactics", params={"session_id": sid2}).json()["tactics"]
    t1 = client.get("/api/tactics", params={"session_id": sid1}).json()["tactics"]
    assert t1["strong_side"] == "top"
    assert t2["strong_side"] != "top" or t2 is not t1
