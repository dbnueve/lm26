"""Shared mutable state for the LM26 backend.

All modules import GAME_STATE and state from here so that
in-process mutation is visible across modules (dict reference
and object attribute are the same object everywhere).
"""

GAME_STATE: dict = {
    "initialized": False,
    "user_team": None,
    "teams": {},
    "players": {},
    "erl_players": {},
    "schedule": [],
    "current_week": 0,
    "current_split": 1,
    "season": 2026,
    "phase": "regular",
    "playoffs_bracket": None,
    "history": [],
    "negotiations": [],
    "draft_state": None,
    "champion_stats": {},
    "meta_champions": None,
    "total_games_played": 0,
    "league": "LEC",
    "tactics": None,
    "inbox": [],
}


class _State:
    """Per-worker scalar state (not persisted to disk)."""
    active_slot: int | None = None
    worker_mtime: float = 0.0


state = _State()
