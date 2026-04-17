"""
Fixtures partagées.
Isolation : toutes les sauvegardes sont redirigées vers un tmp_path par test.
GAME_STATE et ACTIVE_SLOT sont réinitialisés entre chaque test.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import server  # noqa: E402


@pytest.fixture
def isolated_saves(tmp_path, monkeypatch):
    """Redirige saves + active_slot vers tmp, reset GAME_STATE entre tests."""
    def fake_get_save_path(slot: int) -> Path:
        return tmp_path / f"game_save_{slot}.json"

    def fake_read_active_slot():
        p = tmp_path / "active_slot.txt"
        if not p.exists():
            return None
        try:
            v = int(p.read_text().strip())
            return v if v in (1, 2, 3) else None
        except Exception:
            return None

    def fake_write_active_slot(slot: int):
        if slot not in (1, 2, 3):
            return
        (tmp_path / "active_slot.txt").write_text(str(slot))

    monkeypatch.setattr(server, "get_save_path", fake_get_save_path)
    monkeypatch.setattr(server, "_read_active_slot_file", fake_read_active_slot)
    monkeypatch.setattr(server, "_write_active_slot_file", fake_write_active_slot)

    # Reset état global
    server.ACTIVE_SLOT = None
    server._WORKER_STATE_MTIME = 0.0
    for k in list(server.GAME_STATE.keys()):
        server.GAME_STATE[k] = None if k != "initialized" else False
    server.GAME_STATE.update({
        "initialized": False,
        "teams": {}, "players": {}, "erl_players": {},
        "schedule": [], "history": [], "negotiations": [],
        "inbox": [], "champion_stats": {},
        "current_week": 0, "current_split": 1, "season": 2026,
        "phase": "regular", "league": "LEC",
        "total_games_played": 0,
        "draft_state": None, "playoffs_bracket": None,
        "tactics": None, "meta_champions": None,
        "user_team": None,
    })
    yield tmp_path


@pytest.fixture
def client(isolated_saves):
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def fresh_game(client):
    """Slot 1 initialisé (LEC), équipe g2 sélectionnée, saison démarrée."""
    r = client.post("/api/saves/1/new", json={"league": "LEC"})
    assert r.status_code == 200, r.text
    r = client.post("/api/teams/select/g2")
    assert r.status_code == 200, r.text
    r = client.post("/api/season/start")
    assert r.status_code == 200, r.text
    return client
