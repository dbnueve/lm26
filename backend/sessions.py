"""In-memory MP session registry (Phase 1 of mp-as-shared-solo refactor).

Design
------
- Each MP session owns a fresh clone of the solo `GAME_STATE` dict. Callers
  (endpoints, helpers) simply read/write that dict the same way solo code
  reads/writes the global `GAME_STATE` — no duplicate logic.
- Players are tracked *alongside* the state (not inside it) so that game logic
  stays identical to solo. `players` maps `token -> team_id`. A session can
  have multiple humans; every other team is played by AI, exactly like solo.
- Persistence: JSON files in `backend/mp_sessions/{sid}.json`. No SQLite.
  Sessions are autosaved every 30s and on-demand after key mutations.
- Broadcast: each session keeps a set of subscribed WebSockets. `broadcast()`
  pushes a JSON envelope to every live socket, dropping closed ones.
- Concurrency: one `asyncio.Lock` per session is enough because uvicorn dev
  is single-worker/async. Callers must `async with session.lock:` around any
  read-modify-write on the state when called from an HTTP handler.

Non-goals
---------
- Multi-process / multi-worker scale. For parties between friends (<= 20
  concurrent sessions) a single uvicorn worker is plenty.
- Authentication. Tokens are opaque strings generated on create/join; a leak
  means the leaker can control the team. Same threat model as the old MP.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import secrets
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

# ── Storage ───────────────────────────────────────────────────────────────────
_BASE_DIR = Path(__file__).resolve().parent
SESSIONS_DIR = _BASE_DIR / "mp_sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# ── In-memory registry ────────────────────────────────────────────────────────
@dataclass
class Session:
    """One MP session. `state` is the same shape as solo GAME_STATE."""

    sid: str
    code: str                               # short join code (human friendly)
    league: str
    state: dict                             # = clone of solo GAME_STATE
    players: dict[str, str | None] = field(default_factory=dict)  # token -> team_id
    usernames: dict[str, str] = field(default_factory=dict)        # token -> display name
    phase: str = "lobby"                    # lobby | team_pick | running | finished
    # Ready/vote map: action_key -> set of tokens that have signaled "ready".
    # Used to gate shared progression actions (season/simulate, split/next,
    # etc.) until every human player has agreed. Reset after the action fires.
    ready: dict[str, set[str]] = field(default_factory=dict)
    # Shared versus-draft state when two humans face each other for a match.
    # None when no PvP draft is active. Shape:
    #   {
    #     "match_id": str,
    #     "team1_id": str, "team2_id": str,     # blue=team1, red=team2
    #     "side": {token1: 1, token2: 2},
    #     "step": int,                          # 0..len(sequence)
    #     "sequence": [["ban"|"pick", 1|2], ...],
    #     "bans":  {"1": [...], "2": [...]},
    #     "picks": {"1": [{"champion": str, "position": str}, ...], "2": [...]},
    #     "completed": bool,
    #   }
    mp_draft: dict | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    _dirty: bool = False                    # needs save
    # Runtime-only (excluded from JSON)
    subscribers: set[Any] = field(default_factory=set)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# Registry indexed by session id *and* by join code for fast /mp/join lookup.
_SESSIONS: dict[str, Session] = {}
_CODES: dict[str, str] = {}  # code -> sid

# ── Identifiers ───────────────────────────────────────────────────────────────
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # unambiguous


def _gen_code() -> str:
    while True:
        c = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        if c not in _CODES:
            return c


def _gen_token() -> str:
    return secrets.token_urlsafe(16)


def _gen_sid() -> str:
    return str(uuid.uuid4())


# ── Public API ────────────────────────────────────────────────────────────────
def create_session(league: str, host_username: str,
                   initialize_state_fn: Callable[[str], dict]) -> tuple[Session, str]:
    """Create a new MP session.

    Parameters
    ----------
    league : str
        League id (e.g. "LEC") passed to `initialize_state_fn`.
    host_username : str
        Display name for the player who creates the session. Gets the first token.
    initialize_state_fn : Callable[[str], dict]
        Factory returning a fresh game state dict for the given league.
        Typically a thin wrapper around solo `initialize_game` that produces
        an isolated dict instead of mutating the global.

    Returns
    -------
    (Session, token) — token is the host player's token.
    """
    sid = _gen_sid()
    code = _gen_code()
    state = initialize_state_fn(league)
    session = Session(sid=sid, code=code, league=league, state=state)
    host_token = _gen_token()
    session.players[host_token] = None
    session.usernames[host_token] = host_username
    session.phase = "team_pick"
    session._dirty = True
    _SESSIONS[sid] = session
    _CODES[code] = sid
    logger.info("MP session created sid=%s code=%s league=%s host=%s",
                sid[:8], code, league, host_username)
    return session, host_token


def join_session(code: str, username: str) -> tuple[Session, str]:
    """Join an existing session by its short code. Returns (session, token)."""
    sid = _CODES.get(code.upper())
    if sid is None:
        raise ValueError("Code de session inconnu")
    session = _SESSIONS[sid]
    if session.phase == "finished":
        raise ValueError("Cette session est terminée")
    token = _gen_token()
    session.players[token] = None
    session.usernames[token] = username
    session._dirty = True
    logger.info("MP join sid=%s user=%s", sid[:8], username)
    return session, token


def get_session(sid: str) -> Session | None:
    return _SESSIONS.get(sid)


def get_state(sid: str) -> dict | None:
    """Return the session's state dict, or None if the session doesn't exist."""
    s = _SESSIONS.get(sid)
    return s.state if s else None


def player_token_to_team(session: Session, token: str) -> str | None:
    return session.players.get(token)


def assign_team(session: Session, token: str, team_id: str) -> None:
    """Assign a team to a player token. Rejects if team already taken by someone else."""
    if token not in session.players:
        raise ValueError("Token invalide")
    current_owner = next((t for t, tid in session.players.items()
                          if tid == team_id and t != token), None)
    if current_owner is not None:
        raise ValueError("Équipe déjà prise par un autre joueur")
    session.players[token] = team_id
    session._dirty = True


def mark_dirty(sid: str) -> None:
    """Call this after any mutation to the state that should be persisted."""
    s = _SESSIONS.get(sid)
    if s:
        s.updated_at = time.time()
        s._dirty = True


# ── Ready/vote gates ──────────────────────────────────────────────────────────
def mark_ready(session: Session, action: str, token: str) -> bool:
    """Record that `token` is ready to run `action`. Returns True if everyone
    is now ready (caller should run the action + call `clear_ready`)."""
    if token not in session.players:
        raise ValueError("Token invalide")
    ready_set = session.ready.setdefault(action, set())
    ready_set.add(token)
    # "Everyone" = every human token currently in the session.
    return set(session.players.keys()) <= ready_set


def unmark_ready(session: Session, action: str, token: str) -> None:
    """Remove a player's ready vote (e.g., they changed their mind)."""
    ready_set = session.ready.get(action)
    if ready_set:
        ready_set.discard(token)
        if not ready_set:
            session.ready.pop(action, None)


def clear_ready(session: Session, action: str) -> None:
    """Clear all ready votes for `action`. Call after the action has fired."""
    session.ready.pop(action, None)


def ready_snapshot(session: Session) -> dict[str, list[str]]:
    """Return a client-friendly view: action -> list of usernames that are ready."""
    return {
        action: [session.usernames.get(t, "?") for t in tokens]
        for action, tokens in session.ready.items()
    }


# ── WebSocket fan-out ─────────────────────────────────────────────────────────
def subscribe(session: Session, ws: Any) -> None:
    session.subscribers.add(ws)


def unsubscribe(session: Session, ws: Any) -> None:
    session.subscribers.discard(ws)


async def broadcast(sid: str, event: str, data: Any) -> None:
    """Fan-out a JSON envelope to every live subscriber. Closed sockets are dropped."""
    s = _SESSIONS.get(sid)
    if not s or not s.subscribers:
        return
    payload = {"event": event, "data": data}
    stale: list[Any] = []
    for ws in list(s.subscribers):
        try:
            await ws.send_json(payload)
        except Exception:  # noqa: BLE001 — connection closed, protocol error, etc.
            stale.append(ws)
    for ws in stale:
        s.subscribers.discard(ws)


# ── Persistence ───────────────────────────────────────────────────────────────
_EXCLUDE_SERIALIZE = {"subscribers", "lock", "_dirty"}


def _session_to_json(s: Session) -> dict:
    return {
        "sid": s.sid,
        "code": s.code,
        "league": s.league,
        "state": s.state,
        "players": s.players,
        "usernames": s.usernames,
        "phase": s.phase,
        # Sets aren't JSON-serializable — store as sorted lists.
        "ready": {k: sorted(v) for k, v in s.ready.items()},
        "mp_draft": s.mp_draft,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


def _json_to_session(raw: dict) -> Session:
    return Session(
        sid=raw["sid"],
        code=raw["code"],
        league=raw["league"],
        state=raw["state"],
        players=raw.get("players", {}),
        usernames=raw.get("usernames", {}),
        phase=raw.get("phase", "lobby"),
        ready={k: set(v) for k, v in raw.get("ready", {}).items()},
        created_at=raw.get("created_at", time.time()),
        updated_at=raw.get("updated_at", time.time()),
    )


def save_session(sid: str) -> None:
    s = _SESSIONS.get(sid)
    if s is None:
        return
    path = SESSIONS_DIR / f"{sid}.json"
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(_session_to_json(s), ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        s._dirty = False
    except Exception:
        logger.exception("Failed to save session %s", sid[:8])


def save_all_dirty() -> int:
    n = 0
    for sid, s in list(_SESSIONS.items()):
        if s._dirty:
            save_session(sid)
            n += 1
    return n


def load_all() -> int:
    """Restore all sessions from disk at process start. Returns count loaded."""
    if not SESSIONS_DIR.exists():
        return 0
    n = 0
    for path in SESSIONS_DIR.glob("*.json"):
        if path.suffix == ".tmp":
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            s = _json_to_session(raw)
            _SESSIONS[s.sid] = s
            _CODES[s.code] = s.sid
            n += 1
        except Exception:
            logger.exception("Failed to load session file %s", path.name)
    if n:
        logger.info("Restored %d MP session(s) from disk", n)
    return n


def list_sessions() -> list[dict]:
    """Compact listing for debug/health endpoints."""
    return [
        {
            "sid": s.sid,
            "code": s.code,
            "league": s.league,
            "phase": s.phase,
            "players": list(s.usernames.values()),
            "player_count": len(s.players),
            "current_week": s.state.get("current_week", 0),
            "subscribers": len(s.subscribers),
            "updated_at": s.updated_at,
        }
        for s in _SESSIONS.values()
    ]


# ── Autosave task ─────────────────────────────────────────────────────────────
_AUTOSAVE_INTERVAL_S = 30.0
_autosave_task: asyncio.Task | None = None


async def _autosave_loop() -> None:
    while True:
        try:
            await asyncio.sleep(_AUTOSAVE_INTERVAL_S)
            n = save_all_dirty()
            if n:
                logger.debug("Autosaved %d MP session(s)", n)
        except asyncio.CancelledError:
            save_all_dirty()  # final flush on shutdown
            raise
        except Exception:
            logger.exception("Autosave loop error")


def start_autosave() -> None:
    global _autosave_task
    if _autosave_task and not _autosave_task.done():
        return
    loop = asyncio.get_event_loop()
    _autosave_task = loop.create_task(_autosave_loop(), name="mp-autosave")


async def stop_autosave() -> None:
    global _autosave_task
    if _autosave_task and not _autosave_task.done():
        _autosave_task.cancel()
        try:
            await _autosave_task
        except asyncio.CancelledError:
            pass
    _autosave_task = None


# ── Test hooks ────────────────────────────────────────────────────────────────
def _reset_for_tests() -> None:
    """Clear the in-memory registry. NEVER call outside tests."""
    _SESSIONS.clear()
    _CODES.clear()
