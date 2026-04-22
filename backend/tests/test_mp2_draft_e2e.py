"""End-to-end test for the MP2 shared versus draft (2 humans facing off).

Covers:
1. Two players join an MP session, pick opposing teams, and schedule a match.
2. Either player starts the versus draft via /api/mp2/{sid}/draft/start.
3. Alternating picks/bans following DRAFT_SEQUENCE (remapped to sides 1/2).
4. Validation: wrong-turn rejection, duplicate-champion rejection.
5. On completion, session.mp_draft.completed=True and session.state
   ["draft_state"] is reconciled so /match/simulate consumes the picks.
6. WebSocket subscribers see `mp_draft_update` broadcasts on every action.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sessions  # noqa: E402
import server  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(sessions, "SESSIONS_DIR", tmp_path)
    sessions._reset_for_tests()
    with TestClient(server.app) as c:
        yield c
    sessions._reset_for_tests()


def _bootstrap_pvp_session(client: TestClient) -> dict:
    """Create a 2-player MP session where Alice and Bob play each other
    next. Returns a dict with sid, tokens, teams, and the match id."""
    r = client.post("/api/mp2/create",
                    json={"league": "LEC", "username": "alice"})
    assert r.status_code == 200, r.text
    sid = r.json()["sid"]
    code = r.json()["code"]
    tok_a = r.json()["token"]

    r = client.post("/api/mp2/join",
                    json={"code": code, "username": "bob"})
    assert r.status_code == 200, r.text
    tok_b = r.json()["token"]

    sess = sessions.get_session(sid)
    # Find a regular-season match between two distinct teams, and assign
    # those teams to Alice and Bob.
    match = sess.state["schedule"][0]
    team_a, team_b = match["team1"], match["team2"]
    assert team_a != team_b

    client.post(f"/api/mp2/{sid}/team",
                json={"token": tok_a, "team_id": team_a})
    client.post(f"/api/mp2/{sid}/team",
                json={"token": tok_b, "team_id": team_b})

    return {
        "sid": sid,
        "tok_a": tok_a, "tok_b": tok_b,
        "team_a": team_a, "team_b": team_b,
        "match_id": match["id"],
    }


def _pick_champion_for(sess, side: int) -> str:
    """Pick any champion not yet taken by either side in the current draft."""
    d = sess.mp_draft
    taken: set = set()
    for s in ("1", "2"):
        taken.update(d["bans"].get(s, []))
        taken.update(p["champion"] for p in d["picks"].get(s, []))
    taken.update(d.get("fearless_excluded", []))
    # Grab any champion from META_LOOKUP not yet taken.
    for name in server.META_LOOKUP:
        if name not in taken:
            return name
    raise RuntimeError("No champion left to pick")


def test_versus_draft_full_flow(client):
    """Complete 20-step alternating pick/ban between two humans."""
    ctx = _bootstrap_pvp_session(client)
    sid, tok_a, tok_b, mid = ctx["sid"], ctx["tok_a"], ctx["tok_b"], ctx["match_id"]

    # ── 1. Start the versus draft (Alice = team1 = side 1) ──
    r = client.post(f"/api/mp2/{sid}/draft/start",
                    json={"token": tok_a, "match_id": mid})
    assert r.status_code == 200, r.text
    state = r.json()
    assert state["step"] == 0
    assert state["completed"] is False
    assert state["current_side"] == 1  # user starts in DRAFT_SEQUENCE
    assert state["_mySide"] == 1

    # Bob also fetches — he should see side 2.
    r = client.get(f"/api/mp2/{sid}/draft", params={"token": tok_b})
    assert r.status_code == 200
    assert r.json()["_mySide"] == 2

    # ── 2. Play the full sequence ──
    sess = sessions.get_session(sid)
    for step_idx in range(len(sess.mp_draft["sequence"])):
        kind, expected_side = sess.mp_draft["sequence"][step_idx]
        tok = tok_a if expected_side == 1 else tok_b
        champ = _pick_champion_for(sess, expected_side)
        r = client.post(f"/api/mp2/{sid}/draft/action",
                        json={"token": tok, "action": kind, "champion": champ})
        assert r.status_code == 200, f"step {step_idx}: {r.text}"

    # ── 3. Draft complete, state reconciled into session.state["draft_state"] ──
    final = client.get(f"/api/mp2/{sid}/draft", params={"token": tok_a}).json()
    assert final["completed"] is True
    assert final["step"] == len(sess.mp_draft["sequence"])
    ds = sess.state["draft_state"]
    assert ds["phase"] == "complete"
    assert len(ds["user_picks"]) == 5
    assert len(ds["enemy_picks"]) == 5
    assert len(ds["user_bans"]) == 5
    assert len(ds["enemy_bans"]) == 5
    # No overlap between the two sides' picks.
    user_set = {p["champion"] for p in ds["user_picks"]}
    enemy_set = {p["champion"] for p in ds["enemy_picks"]}
    assert user_set.isdisjoint(enemy_set)


def test_versus_draft_rejects_wrong_turn(client):
    """A player acting on their peer's turn gets a 409."""
    ctx = _bootstrap_pvp_session(client)
    sid, tok_a, tok_b, mid = ctx["sid"], ctx["tok_a"], ctx["tok_b"], ctx["match_id"]

    client.post(f"/api/mp2/{sid}/draft/start",
                json={"token": tok_a, "match_id": mid})

    # Bob tries to act at step 0 (which is Alice's turn).
    sess = sessions.get_session(sid)
    champ = _pick_champion_for(sess, 2)
    r = client.post(f"/api/mp2/{sid}/draft/action",
                    json={"token": tok_b, "action": "ban", "champion": champ})
    assert r.status_code == 409


def test_versus_draft_rejects_duplicate_champion(client):
    """A champion already banned by one side cannot be re-banned/picked."""
    ctx = _bootstrap_pvp_session(client)
    sid, tok_a, tok_b, mid = ctx["sid"], ctx["tok_a"], ctx["tok_b"], ctx["match_id"]

    client.post(f"/api/mp2/{sid}/draft/start",
                json={"token": tok_a, "match_id": mid})

    sess = sessions.get_session(sid)
    champ = _pick_champion_for(sess, 1)
    # Alice bans champ (step 0).
    r = client.post(f"/api/mp2/{sid}/draft/action",
                    json={"token": tok_a, "action": "ban", "champion": champ})
    assert r.status_code == 200

    # Bob tries to ban the same champion (step 1 = his turn).
    r = client.post(f"/api/mp2/{sid}/draft/action",
                    json={"token": tok_b, "action": "ban", "champion": champ})
    assert r.status_code == 400
    assert "déjà" in r.json()["detail"].lower() or "pris" in r.json()["detail"].lower()


def test_versus_draft_websocket_broadcasts(client):
    """Each draft action fans out a `mp_draft_update` event to subscribers."""
    ctx = _bootstrap_pvp_session(client)
    sid, tok_a, tok_b, mid = ctx["sid"], ctx["tok_a"], ctx["tok_b"], ctx["match_id"]

    with client.websocket_connect(f"/ws/mp2/{sid}?token={tok_b}") as ws_b:
        # Drain hello + self-peer-joined.
        assert ws_b.receive_json()["event"] == "hello"
        assert ws_b.receive_json()["event"] == "peer_joined"

        # Alice starts the draft → Bob's WS should receive an update.
        r = client.post(f"/api/mp2/{sid}/draft/start",
                        json={"token": tok_a, "match_id": mid})
        assert r.status_code == 200
        evt = ws_b.receive_json()
        assert evt["event"] == "mp_draft_update"
        assert evt["data"]["reason"] == "start"

        # Alice bans champ → another update.
        sess = sessions.get_session(sid)
        champ = _pick_champion_for(sess, 1)
        r = client.post(f"/api/mp2/{sid}/draft/action",
                        json={"token": tok_a, "action": "ban", "champion": champ})
        assert r.status_code == 200
        evt = ws_b.receive_json()
        assert evt["event"] == "mp_draft_update"
        assert evt["data"]["step"] == 1


def test_versus_draft_persists_across_reload(client):
    """Draft state survives session save/load (autosave reliability)."""
    ctx = _bootstrap_pvp_session(client)
    sid, tok_a, mid = ctx["sid"], ctx["tok_a"], ctx["match_id"]

    client.post(f"/api/mp2/{sid}/draft/start",
                json={"token": tok_a, "match_id": mid})
    sess = sessions.get_session(sid)
    champ = _pick_champion_for(sess, 1)
    client.post(f"/api/mp2/{sid}/draft/action",
                json={"token": tok_a, "action": "ban", "champion": champ})

    # Force save + wipe registry + reload from disk.
    sessions.save_session(sid)
    sessions._reset_for_tests()
    n = sessions.load_all()
    assert n >= 1

    reloaded = sessions.get_session(sid)
    assert reloaded is not None
    assert reloaded.mp_draft is not None
    assert reloaded.mp_draft["step"] == 1
    assert reloaded.mp_draft["bans"]["1"] == [champ]
