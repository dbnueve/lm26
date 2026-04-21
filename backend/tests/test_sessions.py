"""Unit tests for backend/sessions.py — the new MP session registry.

These tests use a fake `initialize_state_fn` so they don't depend on server.py.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

# Make `backend/` importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sessions  # noqa: E402


def _fake_init(league: str) -> dict:
    """Minimal fake game state — shape doesn't matter for registry tests."""
    return {
        "league": league,
        "current_week": 1,
        "teams": {"T1": {"name": "Team 1"}, "T2": {"name": "Team 2"}},
        "players": {},
    }


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """Redirect SESSIONS_DIR to a tmp path and reset registry before each test."""
    monkeypatch.setattr(sessions, "SESSIONS_DIR", tmp_path)
    sessions._reset_for_tests()
    yield
    sessions._reset_for_tests()


# ── create / join / lookup ────────────────────────────────────────────────────
def test_create_session_assigns_token_and_code():
    s, tok = sessions.create_session("LEC", "alice", _fake_init)
    assert s.league == "LEC"
    assert s.phase == "team_pick"
    assert tok in s.players
    assert s.players[tok] is None
    assert s.usernames[tok] == "alice"
    assert s.state["league"] == "LEC"
    assert len(s.code) == 6
    # Code is registered in the lookup map
    assert sessions._CODES[s.code] == s.sid


def test_join_session_with_valid_code():
    host, _ = sessions.create_session("LCK", "alice", _fake_init)
    joined, tok = sessions.join_session(host.code, "bob")
    assert joined.sid == host.sid
    assert tok in joined.players
    assert joined.usernames[tok] == "bob"


def test_join_session_with_invalid_code_raises():
    with pytest.raises(ValueError, match="inconnu"):
        sessions.join_session("ZZZZZZ", "bob")


def test_join_finished_session_raises():
    s, _ = sessions.create_session("LEC", "alice", _fake_init)
    s.phase = "finished"
    with pytest.raises(ValueError, match="terminée"):
        sessions.join_session(s.code, "bob")


def test_get_state_returns_same_dict_reference():
    s, _ = sessions.create_session("LEC", "alice", _fake_init)
    st = sessions.get_state(s.sid)
    assert st is s.state  # same reference — mutations propagate


def test_get_state_missing_returns_none():
    assert sessions.get_state("does-not-exist") is None


# ── team assignment ───────────────────────────────────────────────────────────
def test_assign_team_basic():
    s, tok = sessions.create_session("LEC", "alice", _fake_init)
    sessions.assign_team(s, tok, "T1")
    assert s.players[tok] == "T1"
    assert s._dirty is True


def test_assign_team_rejects_if_taken_by_another():
    s, tok_a = sessions.create_session("LEC", "alice", _fake_init)
    _, tok_b = sessions.join_session(s.code, "bob")
    sessions.assign_team(s, tok_a, "T1")
    with pytest.raises(ValueError, match="déjà prise"):
        sessions.assign_team(s, tok_b, "T1")


def test_assign_team_same_player_can_switch():
    s, tok = sessions.create_session("LEC", "alice", _fake_init)
    sessions.assign_team(s, tok, "T1")
    sessions.assign_team(s, tok, "T2")  # same player changes their team — ok
    assert s.players[tok] == "T2"


def test_assign_team_unknown_token_raises():
    s, _ = sessions.create_session("LEC", "alice", _fake_init)
    with pytest.raises(ValueError, match="Token"):
        sessions.assign_team(s, "bogus", "T1")


# ── persistence ───────────────────────────────────────────────────────────────
def test_save_and_reload_roundtrip(tmp_path):
    s, tok = sessions.create_session("LPL", "alice", _fake_init)
    sessions.assign_team(s, tok, "T1")
    s.state["current_week"] = 7  # mutate state
    sessions.mark_dirty(s.sid)

    sessions.save_session(s.sid)

    # Simulate process restart: clear registry, reload from disk
    sessions._reset_for_tests()
    n = sessions.load_all()
    assert n == 1

    restored = sessions.get_session(s.sid)
    assert restored is not None
    assert restored.league == "LPL"
    assert restored.players[tok] == "T1"
    assert restored.state["current_week"] == 7
    # Join code still resolvable after reload
    assert sessions._CODES[restored.code] == restored.sid


def test_save_all_dirty_skips_clean_sessions():
    s, _ = sessions.create_session("LEC", "alice", _fake_init)
    sessions.save_session(s.sid)  # marks clean
    assert sessions.save_all_dirty() == 0

    sessions.mark_dirty(s.sid)
    assert sessions.save_all_dirty() == 1


def test_save_file_is_atomic_no_tmp_left():
    s, _ = sessions.create_session("LEC", "alice", _fake_init)
    sessions.save_session(s.sid)
    files = list(sessions.SESSIONS_DIR.iterdir())
    # One .json, no stale .tmp
    assert [f.suffix for f in files] == [".json"]


def test_load_all_tolerates_corrupted_file(tmp_path):
    s, _ = sessions.create_session("LEC", "alice", _fake_init)
    sessions.save_session(s.sid)
    # Corrupt it
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("not valid json")

    sessions._reset_for_tests()
    n = sessions.load_all()
    # The valid one still loads, the corrupt one is skipped (logged).
    assert n == 1


# ── broadcast ─────────────────────────────────────────────────────────────────
class _FakeWS:
    def __init__(self, fail: bool = False) -> None:
        self.received: list[dict] = []
        self.fail = fail

    async def send_json(self, payload: dict) -> None:
        if self.fail:
            raise ConnectionError("socket closed")
        self.received.append(payload)


def test_broadcast_sends_to_all_live_subscribers():
    async def _run():
        s, _ = sessions.create_session("LEC", "alice", _fake_init)
        a, b = _FakeWS(), _FakeWS()
        sessions.subscribe(s, a)
        sessions.subscribe(s, b)

        await sessions.broadcast(s.sid, "state", {"week": 3})

        assert a.received == [{"event": "state", "data": {"week": 3}}]
        assert b.received == [{"event": "state", "data": {"week": 3}}]

    asyncio.run(_run())


def test_broadcast_drops_closed_sockets():
    async def _run():
        s, _ = sessions.create_session("LEC", "alice", _fake_init)
        good, bad = _FakeWS(), _FakeWS(fail=True)
        sessions.subscribe(s, good)
        sessions.subscribe(s, bad)

        await sessions.broadcast(s.sid, "state", {"x": 1})

        assert good.received  # delivered
        assert bad not in s.subscribers  # pruned

    asyncio.run(_run())


def test_broadcast_unknown_session_is_noop():
    # Should not raise even if the sid doesn't exist.
    asyncio.run(sessions.broadcast("nope", "state", {}))


# ── autosave ──────────────────────────────────────────────────────────────────
def test_autosave_flushes_dirty_sessions(monkeypatch):
    monkeypatch.setattr(sessions, "_AUTOSAVE_INTERVAL_S", 0.05)

    async def _run():
        s, _ = sessions.create_session("LEC", "alice", _fake_init)
        assert s._dirty is True

        sessions.start_autosave()
        await asyncio.sleep(0.15)  # let it tick at least once
        await sessions.stop_autosave()

        path = sessions.SESSIONS_DIR / f"{s.sid}.json"
        assert path.exists()
        raw = json.loads(path.read_text(encoding="utf-8"))
        assert raw["league"] == "LEC"

    asyncio.run(_run())
