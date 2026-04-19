"""
Multiplayer module for LM26 — asynchronous sessions with shared draft phase.

Each session is an independent JSON file in backend/multiplayer_sessions/.
Two players each get a token; they manage their team independently each week.
When they face each other, a shared ban/pick draft runs before simulation.

Draft order (BO1, standard LoL format):
  Bans R1:  P1 ban, P2 ban, P1 ban, P2 ban, P1 ban, P2 ban  (6 bans)
  Picks R1: P1 pick, P2 pick, P2 pick, P1 pick, P1 pick, P2 pick (6 picks)
  Bans R2:  P2 ban, P1 ban, P2 ban, P1 ban  (4 bans)
  Picks R2: P2 pick, P1 pick, P2 pick, P1 pick (4 picks)

Total: 10 bans, 10 picks → each side gets 5 champions.
"""

from __future__ import annotations

import json
import logging
import random
import string
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SESSIONS_DIR = Path(__file__).parent / "multiplayer_sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# ── Draft sequence ────────────────────────────────────────────────────────────
# Each entry: (action, side)  side=1 → player1, side=2 → player2
DRAFT_SEQUENCE: list[tuple[str, int]] = [
    # Bans round 1
    ("ban", 1), ("ban", 2), ("ban", 1), ("ban", 2), ("ban", 1), ("ban", 2),
    # Picks round 1
    ("pick", 1), ("pick", 2), ("pick", 2), ("pick", 1), ("pick", 1), ("pick", 2),
    # Bans round 2
    ("ban", 2), ("ban", 1), ("ban", 2), ("ban", 1),
    # Picks round 2
    ("pick", 2), ("pick", 1), ("pick", 2), ("pick", 1),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_path(session_id: str) -> Path:
    return SESSIONS_DIR / f"{session_id}.json"


def _load_session(session_id: str) -> dict | None:
    path = _session_path(session_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"_load_session {session_id}: {e}")
        return None


def _save_session(session: dict) -> None:
    path = _session_path(session["session_id"])
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(session, f, ensure_ascii=False)
        tmp.replace(path)
    except Exception as e:
        logger.error(f"_save_session {session['session_id']}: {e}")


def _generate_code() -> str:
    """Short 6-char alphanumeric join code (uppercase)."""
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _generate_token() -> str:
    return str(uuid.uuid4())


def _new_draft_state() -> dict:
    return {
        "step": 0,                # index in DRAFT_SEQUENCE
        "sequence": DRAFT_SEQUENCE,
        "bans": {1: [], 2: []},
        "picks": {1: [], 2: []},
        "completed": False,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def create_session(league: str, host_username: str) -> dict:
    """Create a new multiplayer session. Returns session_id, join code, and host token."""
    session_id = str(uuid.uuid4())
    token = _generate_token()
    code = _generate_code()

    # Avoid code collision (unlikely but safe)
    existing_codes = {
        json.load(open(p))["code"]
        for p in SESSIONS_DIR.glob("*.json")
        if p.suffix == ".json"
        if _try_load_code(p) is not None
    }
    while code in existing_codes:
        code = _generate_code()

    session: dict = {
        "session_id": session_id,
        "code": code,
        "league": league,
        "phase": "waiting",          # waiting → team_pick → regular → (draft →) match → finished
        "week": 1,
        "players": {
            token: {
                "username": host_username,
                "side": 1,
                "team": None,
                "ready": False,
            }
        },
        "schedule": [],              # list of {week, p1_team, p2_team, result}
        "draft_state": None,
        "match_results": [],
        "standings": {},             # team_id → {wins, losses}
        "created_at": _now_iso(),
    }
    _save_session(session)
    logger.info(f"Session créée: {session_id} code={code} league={league}")
    return {"session_id": session_id, "code": code, "token": token}


def _try_load_code(path: Path) -> str | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f).get("code")
    except Exception:
        return None


def join_session(code: str, username: str) -> dict:
    """Join an existing session by code. Returns token for the joining player."""
    code = code.strip().upper()
    session = _find_session_by_code(code)
    if session is None:
        raise ValueError(f"Aucune session avec le code {code}")

    if len(session["players"]) >= 2:
        raise ValueError("Session déjà complète (2 joueurs)")

    if session["phase"] != "waiting":
        raise ValueError("La session a déjà démarré")

    # Prevent duplicate username
    existing_names = {p["username"] for p in session["players"].values()}
    if username in existing_names:
        raise ValueError(f"Le nom '{username}' est déjà pris dans cette session")

    token = _generate_token()
    session["players"][token] = {
        "username": username,
        "side": 2,
        "team": None,
        "ready": False,
    }
    session["phase"] = "team_pick"
    _save_session(session)
    logger.info(f"Joueur '{username}' a rejoint session {session['session_id']}")
    return {"session_id": session["session_id"], "token": token, "league": session["league"]}


def _find_session_by_code(code: str) -> dict | None:
    for path in SESSIONS_DIR.glob("*.json"):
        data = _load_session(path.stem)
        if data and data.get("code") == code:
            return data
    return None


def get_session_state(session_id: str, token: str) -> dict:
    """Return the full session state, with the caller's side identified."""
    session = _load_session(session_id)
    if session is None:
        raise ValueError("Session introuvable")

    player = session["players"].get(token)
    if player is None:
        raise ValueError("Token invalide")

    # Mask other player's token in the response
    players_public = {
        tok: {k: v for k, v in p.items()}
        for tok, p in session["players"].items()
    }

    return {
        **session,
        "players": players_public,
        "my_side": player["side"],
        "my_team": player["team"],
    }


def pick_team(session_id: str, token: str, team_id: str, game_state: dict) -> dict:
    """Assign a team to a player. Both must pick different teams from the session league."""
    from server import LEAGUES_DATA  # import local pour éviter circular import au module level

    session = _load_session(session_id)
    if session is None:
        raise ValueError("Session introuvable")

    player = session["players"].get(token)
    if player is None:
        raise ValueError("Token invalide")

    if session["phase"] != "team_pick":
        raise ValueError(f"Pas en phase de sélection d'équipe (phase actuelle: {session['phase']})")

    # Validate team belongs to the session league via LEAGUES_DATA (indépendant du GAME_STATE)
    league = session["league"].upper()
    league_data = LEAGUES_DATA.get(league)
    if league_data is None:
        raise ValueError(f"Ligue '{league}' inconnue")
    valid_ids = {t["id"] for t in league_data["teams"]}
    if team_id not in valid_ids:
        raise ValueError(f"L'équipe '{team_id}' n'appartient pas à la ligue {league}")

    # Prevent both players picking the same team
    taken = {p["team"] for p in session["players"].values() if p["team"]}
    if team_id in taken:
        raise ValueError(f"L'équipe '{team_id}' est déjà prise par l'autre joueur")

    player["team"] = team_id
    session["players"][token] = player

    # Initialize standings entry
    if team_id not in session["standings"]:
        session["standings"][team_id] = {"wins": 0, "losses": 0}

    # Both picked → move to regular phase and build schedule
    all_teams = [p["team"] for p in session["players"].values() if p["team"]]
    if len(all_teams) == 2:
        session["phase"] = "regular"
        session["schedule"] = _build_schedule(all_teams)
        logger.info(f"Session {session_id}: les deux équipes choisies, phase regular")

    _save_session(session)
    return {"ok": True, "phase": session["phase"]}


def _build_schedule(teams: list[str], weeks: int = 9) -> list[dict]:
    """Round-robin over 9 weeks (best-of-1 each week, alternating home/away)."""
    t1, t2 = teams[0], teams[1]
    schedule = []
    for week in range(1, weeks + 1):
        if week % 2 == 1:
            schedule.append({"week": week, "team1": t1, "team2": t2, "result": None, "draft": None})
        else:
            schedule.append({"week": week, "team1": t2, "team2": t1, "result": None, "draft": None})
    return schedule


def set_ready(session_id: str, token: str) -> dict:
    """Mark a player as ready for the current week."""
    session = _load_session(session_id)
    if session is None:
        raise ValueError("Session introuvable")

    player = session["players"].get(token)
    if player is None:
        raise ValueError("Token invalide")

    if session["phase"] not in ("regular", "draft", "match"):
        raise ValueError(f"Impossible de se marquer prêt en phase '{session['phase']}'")

    player["ready"] = True
    session["players"][token] = player

    # Check if both are ready
    all_ready = all(p["ready"] for p in session["players"].values())
    if all_ready:
        current_week = session["week"]
        match_entry = next(
            (m for m in session["schedule"] if m["week"] == current_week), None
        )
        if match_entry is not None:
            # Direct confrontation this week → go to draft phase
            session["phase"] = "draft"
            session["draft_state"] = _new_draft_state()
            logger.info(f"Session {session_id} week {current_week}: draft phase lancée")
        else:
            # No direct match this week (shouldn't happen in 2-player but handled)
            session["phase"] = "match"

    _save_session(session)
    return {
        "ok": True,
        "all_ready": all_ready,
        "phase": session["phase"],
    }


def draft_action(session_id: str, token: str, champion: str) -> dict:
    """
    Perform a ban or pick in the shared draft.
    Validates it's the caller's turn, the champion is available, and updates draft state.
    """
    session = _load_session(session_id)
    if session is None:
        raise ValueError("Session introuvable")

    if session["phase"] != "draft":
        raise ValueError("Pas en phase de draft")

    player = session["players"].get(token)
    if player is None:
        raise ValueError("Token invalide")

    draft = session["draft_state"]
    step = draft["step"]

    if draft["completed"]:
        raise ValueError("La draft est déjà terminée")

    if step >= len(DRAFT_SEQUENCE):
        raise ValueError("Toutes les actions de draft ont déjà été effectuées")

    action_type, expected_side = DRAFT_SEQUENCE[step]

    if player["side"] != expected_side:
        raise ValueError(f"Ce n'est pas votre tour (attendu: side {expected_side})")

    champion = champion.strip()

    # Check champion not already banned/picked
    all_bans = draft["bans"][1] + draft["bans"][2]
    all_picks = draft["picks"][1] + draft["picks"][2]
    if champion in all_bans or champion in all_picks:
        raise ValueError(f"'{champion}' est déjà banni ou choisi")

    side_key = str(player["side"])

    if action_type == "ban":
        draft["bans"][player["side"]].append(champion)
    else:
        draft["picks"][player["side"]].append(champion)

    draft["step"] += 1

    if draft["step"] >= len(DRAFT_SEQUENCE):
        draft["completed"] = True
        session["phase"] = "match"
        logger.info(f"Session {session_id}: draft terminée")

    session["draft_state"] = draft
    _save_session(session)

    next_step = draft["step"]
    next_action = None
    if next_step < len(DRAFT_SEQUENCE):
        next_action = {
            "action": DRAFT_SEQUENCE[next_step][0],
            "side": DRAFT_SEQUENCE[next_step][1],
        }

    return {
        "ok": True,
        "step": draft["step"],
        "completed": draft["completed"],
        "next_action": next_action,
        "bans": draft["bans"],
        "picks": draft["picks"],
    }


def simulate_week(
    session_id: str,
    token: str,
    simulate_fn,  # callable: (team1_id, team2_id, picks1, picks2) -> result dict
) -> dict:
    """
    Simulate the current week's match. Only callable once draft is complete (phase='match').
    Either player can trigger this — first caller runs it.
    """
    session = _load_session(session_id)
    if session is None:
        raise ValueError("Session introuvable")

    if session["players"].get(token) is None:
        raise ValueError("Token invalide")

    if session["phase"] != "match":
        raise ValueError(f"Pas en phase de simulation (phase actuelle: {session['phase']})")

    current_week = session["week"]
    match_entry = next(
        (m for m in session["schedule"] if m["week"] == current_week), None
    )
    if match_entry is None:
        raise ValueError(f"Aucun match trouvé pour la semaine {current_week}")

    if match_entry["result"] is not None:
        raise ValueError("Ce match a déjà été simulé")

    draft = session.get("draft_state", {})
    picks1 = draft.get("picks", {}).get(1, []) if draft else []
    picks2 = draft.get("picks", {}).get(2, []) if draft else []

    result = simulate_fn(
        match_entry["team1"],
        match_entry["team2"],
        picks1,
        picks2,
    )

    match_entry["result"] = result
    match_entry["draft"] = session.get("draft_state")

    # Update standings
    winner_team = match_entry["team1"] if result["winner"] == 1 else match_entry["team2"]
    loser_team = match_entry["team2"] if result["winner"] == 1 else match_entry["team1"]

    session["standings"].setdefault(winner_team, {"wins": 0, "losses": 0})
    session["standings"].setdefault(loser_team, {"wins": 0, "losses": 0})
    session["standings"][winner_team]["wins"] += 1
    session["standings"][loser_team]["losses"] += 1

    session["match_results"].append({
        "week": current_week,
        "team1": match_entry["team1"],
        "team2": match_entry["team2"],
        "result": result,
    })

    # Advance to next week or finish
    next_week = current_week + 1
    has_next = any(m["week"] == next_week for m in session["schedule"])
    if has_next:
        session["week"] = next_week
        session["phase"] = "regular"
        # Reset ready flags
        for p in session["players"].values():
            p["ready"] = False
        session["draft_state"] = None
        logger.info(f"Session {session_id}: semaine {current_week} terminée → semaine {next_week}")
    else:
        session["phase"] = "finished"
        logger.info(f"Session {session_id}: toutes les semaines jouées → finished")

    _save_session(session)
    return {
        "ok": True,
        "result": result,
        "week": session["week"],
        "phase": session["phase"],
        "standings": session["standings"],
    }


def list_sessions() -> list[dict]:
    """Return a summary of all active (non-finished) sessions."""
    summaries = []
    for path in SESSIONS_DIR.glob("*.json"):
        data = _load_session(path.stem)
        if data is None:
            continue
        summaries.append({
            "session_id": data["session_id"],
            "code": data["code"],
            "league": data["league"],
            "phase": data["phase"],
            "week": data["week"],
            "players": [p["username"] for p in data["players"].values()],
            "created_at": data.get("created_at"),
        })
    return summaries


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
