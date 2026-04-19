"""
SQLite persistence layer for LM26 multiplayer.

Tables:
  sessions            — session metadata (id, code, league, phase, week, max_players)
  session_players     — players in a session (token, username, side, team_id, ready)
  session_game_state  — full game state JSON per session (teams, players, schedule, standings)
  session_matches     — match results per week
  session_events      — event log for replay / reconnection
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "multiplayer.db"

# Per-session write locks — prevents concurrent writes corrupting a session
_session_locks: dict[str, threading.Lock] = {}
_locks_mu = threading.Lock()


def _get_session_lock(session_id: str) -> threading.Lock:
    with _locks_mu:
        if session_id not in _session_locks:
            _session_locks[session_id] = threading.Lock()
        return _session_locks[session_id]


@contextmanager
def _conn():
    """Yield a SQLite connection with WAL mode and row_factory."""
    con = sqlite3.connect(str(DB_PATH), timeout=10, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


# ── Schema ────────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create tables if they don't exist."""
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            code        TEXT UNIQUE NOT NULL,
            league      TEXT NOT NULL,
            phase       TEXT NOT NULL DEFAULT 'waiting',
            current_week INTEGER NOT NULL DEFAULT 1,
            max_players INTEGER NOT NULL DEFAULT 10,
            host_token  TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_players (
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            token       TEXT NOT NULL,
            username    TEXT NOT NULL,
            side        INTEGER NOT NULL,
            team_id     TEXT,
            ready       INTEGER NOT NULL DEFAULT 0,
            connected   INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (session_id, token)
        );

        CREATE TABLE IF NOT EXISTS session_game_state (
            session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            state_json  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_matches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            week        INTEGER NOT NULL,
            team1       TEXT NOT NULL,
            team2       TEXT NOT NULL,
            is_human_vs_human INTEGER NOT NULL DEFAULT 0,
            result_json TEXT,
            draft_json  TEXT,
            draft_step  INTEGER NOT NULL DEFAULT 0,
            draft_completed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS session_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            timestamp   TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            payload     TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
        CREATE INDEX IF NOT EXISTS idx_players_session ON session_players(session_id);
        CREATE INDEX IF NOT EXISTS idx_matches_session_week ON session_matches(session_id, week);
        CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
        """)
    logger.info(f"DB initialisée: {DB_PATH}")


# ── Session CRUD ──────────────────────────────────────────────────────────────

def create_session(session_id: str, code: str, league: str,
                   host_token: str, max_players: int) -> None:
    now = _now()
    with _conn() as con:
        con.execute(
            """INSERT INTO sessions (id, code, league, phase, current_week,
               max_players, host_token, created_at, updated_at)
               VALUES (?,?,?,'waiting',1,?,?,?,?)""",
            (session_id, code, league, max_players, host_token, now, now)
        )
        con.execute(
            """INSERT INTO session_players (session_id, token, username, side, connected)
               VALUES (?,?,'',1,0)""",
            (session_id, host_token)
        )


def get_session(session_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        return dict(row)


def get_session_by_code(code: str) -> dict | None:
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM sessions WHERE code=?", (code.upper(),)
        ).fetchone()
        if row is None:
            return None
        return dict(row)


def update_session_phase(session_id: str, phase: str, week: int | None = None) -> None:
    with _conn() as con:
        if week is not None:
            con.execute(
                "UPDATE sessions SET phase=?, current_week=?, updated_at=? WHERE id=?",
                (phase, week, _now(), session_id)
            )
        else:
            con.execute(
                "UPDATE sessions SET phase=?, updated_at=? WHERE id=?",
                (phase, _now(), session_id)
            )


def delete_session(session_id: str) -> None:
    with _conn() as con:
        con.execute("DELETE FROM sessions WHERE id=?", (session_id,))


# ── Players ───────────────────────────────────────────────────────────────────

def add_player(session_id: str, token: str, username: str, side: int) -> None:
    with _conn() as con:
        con.execute(
            """INSERT OR REPLACE INTO session_players
               (session_id, token, username, side, team_id, ready, connected)
               VALUES (?,?,?,?,NULL,0,1)""",
            (session_id, token, username, side)
        )
        # Update host username if side=1 (host token already inserted at create)
        con.execute(
            "UPDATE sessions SET updated_at=? WHERE id=?",
            (_now(), session_id)
        )


def update_player_username(session_id: str, token: str, username: str) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE session_players SET username=? WHERE session_id=? AND token=?",
            (username, session_id, token)
        )


def get_players(session_id: str) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM session_players WHERE session_id=? ORDER BY side",
            (session_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_player(session_id: str, token: str) -> dict | None:
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM session_players WHERE session_id=? AND token=?",
            (session_id, token)
        ).fetchone()
        return dict(row) if row else None


def set_player_team(session_id: str, token: str, team_id: str) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE session_players SET team_id=? WHERE session_id=? AND token=?",
            (team_id, session_id, token)
        )


def set_player_ready(session_id: str, token: str, ready: bool) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE session_players SET ready=? WHERE session_id=? AND token=?",
            (1 if ready else 0, session_id, token)
        )


def reset_all_ready(session_id: str) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE session_players SET ready=0 WHERE session_id=?",
            (session_id,)
        )


def set_player_connected(session_id: str, token: str, connected: bool) -> None:
    with _conn() as con:
        con.execute(
            "UPDATE session_players SET connected=? WHERE session_id=? AND token=?",
            (1 if connected else 0, session_id, token)
        )


def get_next_side(session_id: str) -> int:
    with _conn() as con:
        row = con.execute(
            "SELECT MAX(side) as max_side FROM session_players WHERE session_id=?",
            (session_id,)
        ).fetchone()
        return (row["max_side"] or 0) + 1


def count_players(session_id: str) -> int:
    with _conn() as con:
        row = con.execute(
            "SELECT COUNT(*) as cnt FROM session_players WHERE session_id=?",
            (session_id,)
        ).fetchone()
        return row["cnt"]


# ── Game State ────────────────────────────────────────────────────────────────

def save_game_state(session_id: str, state: dict) -> None:
    json_str = json.dumps(state, ensure_ascii=False)
    with _conn() as con:
        con.execute(
            """INSERT INTO session_game_state (session_id, state_json)
               VALUES (?,?)
               ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json""",
            (session_id, json_str)
        )


def load_game_state(session_id: str) -> dict | None:
    with _conn() as con:
        row = con.execute(
            "SELECT state_json FROM session_game_state WHERE session_id=?",
            (session_id,)
        ).fetchone()
        if row is None:
            return None
        return json.loads(row["state_json"])


# ── Matches ───────────────────────────────────────────────────────────────────

def insert_matches(session_id: str, matches: list[dict]) -> None:
    with _conn() as con:
        con.executemany(
            """INSERT INTO session_matches
               (session_id, week, team1, team2, is_human_vs_human)
               VALUES (?,?,?,?,?)""",
            [
                (session_id, m["week"], m["team1"], m["team2"],
                 1 if m.get("is_human_vs_human") else 0)
                for m in matches
            ]
        )


def get_week_matches(session_id: str, week: int) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            """SELECT * FROM session_matches
               WHERE session_id=? AND week=?
               ORDER BY id""",
            (session_id, week)
        ).fetchall()
        return [dict(r) for r in rows]


def get_all_matches(session_id: str) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM session_matches WHERE session_id=? ORDER BY week, id",
            (session_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def save_match_result(match_id: int, result: dict, draft: dict | None = None) -> None:
    with _conn() as con:
        con.execute(
            """UPDATE session_matches
               SET result_json=?, draft_json=?, draft_completed=1
               WHERE id=?""",
            (
                json.dumps(result, ensure_ascii=False),
                json.dumps(draft, ensure_ascii=False) if draft else None,
                match_id,
            )
        )


def update_draft_state(match_id: int, draft_json: str, step: int, completed: bool) -> None:
    with _conn() as con:
        con.execute(
            """UPDATE session_matches
               SET draft_json=?, draft_step=?, draft_completed=?
               WHERE id=?""",
            (draft_json, step, 1 if completed else 0, match_id)
        )


def get_match_by_id(match_id: int) -> dict | None:
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM session_matches WHERE id=?", (match_id,)
        ).fetchone()
        return dict(row) if row else None


# ── Events ────────────────────────────────────────────────────────────────────

def log_event(session_id: str, event_type: str, payload: dict) -> None:
    with _conn() as con:
        con.execute(
            "INSERT INTO session_events (session_id, timestamp, event_type, payload) VALUES (?,?,?,?)",
            (session_id, _now(), event_type, json.dumps(payload, ensure_ascii=False))
        )


def get_recent_events(session_id: str, limit: int = 50) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            """SELECT * FROM session_events
               WHERE session_id=?
               ORDER BY id DESC LIMIT ?""",
            (session_id, limit)
        ).fetchall()
        return [dict(r) for r in reversed(rows)]


# ── Cleanup ───────────────────────────────────────────────────────────────────

def cleanup_old_sessions(days: int = 7) -> int:
    """Delete sessions inactive for more than `days` days. Returns count deleted."""
    cutoff = datetime.now(timezone.utc).isoformat()[:10]
    with _conn() as con:
        cur = con.execute(
            "DELETE FROM sessions WHERE updated_at < ?",
            (cutoff,)
        )
        return cur.rowcount


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Initialize DB on import
init_db()
