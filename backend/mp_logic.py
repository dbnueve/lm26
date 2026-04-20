"""
Multiplayer game logic for LM26 — N players, full league simulation.

Each session has its own isolated game state stored in SQLite (mp_db).
Solo GAME_STATE is never touched.

Draft sequence (BO1 standard LoL format — 10 bans, 10 picks):
  Bans R1:  1,2,1,2,1,2
  Picks R1: 1,2,2,1,1,2
  Bans R2:  2,1,2,1
  Picks R2: 2,1,2,1
"""

from __future__ import annotations

import logging
import random
import string
import uuid
from typing import Any, Callable

import mp_db

logger = logging.getLogger(__name__)

# ── Draft sequence ─────────────────────────────────────────────────────────────
DRAFT_SEQUENCE: list[tuple[str, int]] = [
    ("ban", 1), ("ban", 2), ("ban", 1), ("ban", 2), ("ban", 1), ("ban", 2),
    ("pick", 1), ("pick", 2), ("pick", 2), ("pick", 1), ("pick", 1), ("pick", 2),
    ("ban", 2), ("ban", 1), ("ban", 2), ("ban", 1),
    ("pick", 2), ("pick", 1), ("pick", 2), ("pick", 1),
]

# ── Code generation ────────────────────────────────────────────────────────────

def _gen_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _unique_code() -> str:
    for _ in range(10):
        code = _gen_code()
        if mp_db.get_session_by_code(code) is None:
            return code
    return _gen_code()  # fallback (collision astronomiquement rare)


# ── Session lifecycle ──────────────────────────────────────────────────────────

def create_session(league: str, username: str, max_players: int = 10) -> dict:
    """Create a new session. Returns {session_id, code, token}."""
    league = league.upper()
    session_id = str(uuid.uuid4())
    token = str(uuid.uuid4())
    code = _unique_code()

    mp_db.create_session(session_id, code, league, token, max_players)
    mp_db.update_player_username(session_id, token, username)

    mp_db.log_event(session_id, "session_created", {
        "league": league, "host": username, "max_players": max_players
    })
    logger.info(f"Session créée {session_id[:8]} code={code} league={league}")
    return {"session_id": session_id, "code": code, "token": token}


def join_session(code: str, username: str) -> dict:
    """Join by code. Returns {session_id, token, league}."""
    code = code.strip().upper()
    session = mp_db.get_session_by_code(code)
    if session is None:
        raise ValueError(f"Aucune session avec le code {code}")

    # Seulement autoriser le join en phase d'attente ou sélection d'équipe
    if session["phase"] in ("finished",):
        raise ValueError("La session est terminée")
    if session["phase"] not in ("waiting", "team_pick"):
        raise ValueError("La partie est déjà en cours — rejoins via ton token existant")

    n = mp_db.count_players(session["id"])
    if n >= session["max_players"]:
        raise ValueError(f"Session complète ({session['max_players']} joueurs max)")

    # Prevent duplicate username
    existing = {p["username"] for p in mp_db.get_players(session["id"])}
    if username in existing:
        raise ValueError(f"Le pseudo '{username}' est déjà pris")

    token = str(uuid.uuid4())
    side = mp_db.get_next_side(session["id"])
    mp_db.add_player(session["id"], token, username, side)

    # Move to team_pick once at least 2 players are in
    if n + 1 >= 2 and session["phase"] == "waiting":
        mp_db.update_session_phase(session["id"], "team_pick")

    mp_db.log_event(session["id"], "player_joined", {"username": username, "side": side})
    logger.info(f"'{username}' a rejoint session {session['id'][:8]}")
    return {"session_id": session["id"], "token": token, "league": session["league"]}


def get_full_state(session_id: str, token: str) -> dict:
    """Return full session state for a given player token."""
    session = mp_db.get_session(session_id)
    if session is None:
        raise ValueError("Session introuvable")

    player = mp_db.get_player(session_id, token)
    if player is None:
        raise ValueError("Token invalide")

    players = mp_db.get_players(session_id)
    game_state = mp_db.load_game_state(session_id) or {}
    matches = mp_db.get_all_matches(session_id)
    week_matches = mp_db.get_week_matches(session_id, session["current_week"])

    # Find active draft match (human vs human, not yet completed)
    active_draft = next(
        (m for m in week_matches
         if m["is_human_vs_human"] and not m["draft_completed"] and m["result_json"] is None),
        None
    )

    # Build per-player team data for the frontend (roster, budget, stats)
    my_team_id = player["team_id"]
    teams_raw = game_state.get("teams", {})
    players_raw = game_state.get("players", {})
    standings_raw = game_state.get("standings", {})

    # Enrich standings with elo from teams
    standings_enriched = {}
    for tid, s in standings_raw.items():
        team_info = teams_raw.get(tid, {})
        standings_enriched[tid] = {
            **s,
            "elo": team_info.get("elo", 1000),
            "name": team_info.get("name", tid),
            "abbr": team_info.get("abbr", tid.upper()),
        }

    # Build my team object (players hydrated)
    my_team_data = None
    if my_team_id and my_team_id in teams_raw:
        team_obj = teams_raw[my_team_id]
        roster_ids = team_obj.get("roster", [])
        hydrated_players = []
        for pid in roster_ids:
            p = players_raw.get(str(pid)) or players_raw.get(pid)
            if p:
                hydrated_players.append(p)
        my_team_data = {
            **team_obj,
            "id": my_team_id,
            "players": hydrated_players,
            "wins": standings_raw.get(my_team_id, {}).get("wins", 0),
            "losses": standings_raw.get(my_team_id, {}).get("losses", 0),
        }

    return {
        "session_id": session_id,
        "code": session["code"],
        "league": session["league"],
        "phase": session["phase"],
        "week": session["current_week"],
        "max_players": session["max_players"],
        "players": players,
        "my_side": player["side"],
        "my_team": my_team_id,
        "my_team_data": my_team_data,
        "standings": standings_enriched,
        "schedule": matches,
        "week_matches": week_matches,
        "active_draft": active_draft,
        "recent_events": mp_db.get_recent_events(session_id, 20),
    }


# ── Team pick ─────────────────────────────────────────────────────────────────

def pick_team(session_id: str, token: str, team_id: str,
              leagues_data: dict, init_fn: Callable) -> dict:
    """
    Assign a team. When all players have picked → initialize isolated game state
    and generate schedule.
    """
    lock = mp_db._get_session_lock(session_id)
    with lock:
        session = mp_db.get_session(session_id)
        if session is None:
            raise ValueError("Session introuvable")

        player = mp_db.get_player(session_id, token)
        if player is None:
            raise ValueError("Token invalide")

        # Autoriser la sélection d'équipe si le joueur n'a pas encore d'équipe,
        # même si la phase a avancé (ex: Joueur 2 rejoint après que Joueur 1 a choisi)
        if player["team_id"]:
            raise ValueError("Vous avez déjà choisi une équipe")
        if session["phase"] == "finished":
            raise ValueError("La session est terminée")

        # Validate team in league
        league = session["league"].upper()
        league_data = leagues_data.get(league)
        if league_data is None:
            raise ValueError(f"Ligue '{league}' inconnue")

        valid_ids = {t["id"] for t in league_data["teams"]}
        if team_id not in valid_ids:
            raise ValueError(f"'{team_id}' n'appartient pas à la ligue {league}")

        # No duplicate teams
        taken = {p["team_id"] for p in mp_db.get_players(session_id) if p["team_id"]}
        if team_id in taken:
            raise ValueError(f"'{team_id}' est déjà pris")

        mp_db.set_player_team(session_id, token, team_id)
        mp_db.log_event(session_id, "team_picked", {
            "username": player["username"], "team": team_id
        })

        # Check if all players have picked
        players = mp_db.get_players(session_id)
        all_picked = all(p["team_id"] for p in players)

        if all_picked:
            _init_session_game_state(session_id, session, players, leagues_data, init_fn)
            mp_db.update_session_phase(session_id, "regular", week=1)
            logger.info(f"Session {session_id[:8]}: toutes équipes choisies → regular")
            return {"ok": True, "phase": "regular"}

        return {"ok": True, "phase": "team_pick"}


def _init_session_game_state(session_id: str, session: dict, players: list[dict],
                              leagues_data: dict, init_fn: Callable) -> None:
    """
    Build an isolated game state for this session:
    - Full league roster (all teams + players)
    - Mark human-controlled teams
    - Generate round-robin schedule between ALL teams
    - Initialize standings
    """
    gs = init_fn(session["league"])  # returns a fresh state dict (not GAME_STATE global)

    # Mark which teams are human-controlled
    human_teams = {p["team_id"] for p in players if p["team_id"]}
    for team_id, team in gs["teams"].items():
        team["is_human"] = team_id in human_teams

    # Build standings
    gs["standings"] = {
        tid: {"wins": 0, "losses": 0}
        for tid in gs["teams"]
    }

    mp_db.save_game_state(session_id, gs)

    # Generate schedule: round-robin among all teams, mark human vs human matches
    schedule = _generate_round_robin(list(gs["teams"].keys()), human_teams)
    mp_db.insert_matches(session_id, schedule)
    logger.info(
        f"Session {session_id[:8]}: state initialisé "
        f"({len(gs['teams'])} équipes, {len(schedule)} matchs)"
    )


def _generate_round_robin(team_ids: list[str], human_teams: set[str]) -> list[dict]:
    """Standard circle-method round-robin. Returns match dicts for mp_db."""
    n = len(team_ids)
    if n % 2 != 0:
        team_ids = team_ids + ["BYE"]
        n += 1

    fixed = team_ids[0]
    rotating = list(team_ids[1:])
    matches = []
    total_rounds = n - 1

    for round_idx in range(total_rounds):
        week = round_idx + 1
        pairs = [(fixed, rotating[0])]
        for i in range(1, n // 2):
            pairs.append((rotating[i], rotating[n - 2 - i]))

        for t1, t2 in pairs:
            if "BYE" in (t1, t2):
                continue
            matches.append({
                "week": week,
                "team1": t1,
                "team2": t2,
                "is_human_vs_human": (t1 in human_teams and t2 in human_teams),
            })

        # Second half (home/away swapped), weeks offset by total_rounds
        for t1, t2 in pairs:
            if "BYE" in (t1, t2):
                continue
            matches.append({
                "week": week + total_rounds,
                "team1": t2,
                "team2": t1,
                "is_human_vs_human": (t1 in human_teams and t2 in human_teams),
            })

        rotating = [rotating[-1]] + rotating[:-1]

    return matches


# ── Ready & week advance ───────────────────────────────────────────────────────

def set_ready(session_id: str, token: str) -> dict:
    """Mark player ready. When all ready → advance week."""
    lock = mp_db._get_session_lock(session_id)
    with lock:
        session = mp_db.get_session(session_id)
        if session is None:
            raise ValueError("Session introuvable")

        player = mp_db.get_player(session_id, token)
        if player is None:
            raise ValueError("Token invalide")

        if session["phase"] != "regular":
            raise ValueError(f"Pas en phase regular (phase: {session['phase']})")

        if not player["team_id"]:
            raise ValueError("Vous devez choisir une équipe avant de vous marquer prêt")

        mp_db.set_player_ready(session_id, token, True)
        mp_db.log_event(session_id, "player_ready", {"username": player["username"]})

        players = mp_db.get_players(session_id)
        # Seuls les joueurs avec une équipe comptent pour le check "tous prêts"
        active_players = [p for p in players if p["team_id"]]
        all_ready = len(active_players) > 0 and all(p["ready"] for p in active_players)

        return {"ok": True, "all_ready": all_ready}


def advance_week(session_id: str, simulate_fn: Callable) -> dict:
    """
    Simulate all AI vs AI matches for current week.
    Human vs AI matches are also auto-simulated.
    Human vs Human matches → draft required first.
    Returns list of results + list of pending human drafts.
    """
    lock = mp_db._get_session_lock(session_id)
    with lock:
        session = mp_db.get_session(session_id)
        if session is None:
            raise ValueError("Session introuvable")

        week = session["current_week"]
        week_matches = mp_db.get_week_matches(session_id, week)
        gs = mp_db.load_game_state(session_id) or {}

        players = mp_db.get_players(session_id)
        human_teams = {p["team_id"] for p in players if p["team_id"]}

        results = []
        pending_drafts = []

        for match in week_matches:
            if match["result_json"] is not None:
                continue  # already simulated

            t1, t2 = match["team1"], match["team2"]

            if match["is_human_vs_human"]:
                # Initialize draft state if not started yet
                if match["draft_json"] is None:
                    draft = _new_draft_state()
                    import json as _json
                    mp_db.update_draft_state(
                        match["id"],
                        _json.dumps(draft),
                        0,
                        False
                    )
                pending_drafts.append({
                    "match_id": match["id"],
                    "team1": t1,
                    "team2": t2,
                    "week": week,
                })
                continue

            # AI vs AI or human vs AI — auto simulate
            result = simulate_fn(t1, t2, gs, [], [])
            _apply_match_result(session_id, match["id"], t1, t2, result, gs, None)
            results.append({"week": week, "team1": t1, "team2": t2, "result": result})

        mp_db.save_game_state(session_id, gs)

        # If no pending drafts → advance to next week
        if not pending_drafts:
            _finalize_week(session_id, session, gs)

        mp_db.log_event(session_id, "week_advanced", {
            "week": week, "results": len(results), "pending_drafts": len(pending_drafts)
        })

        return {
            "week": week,
            "results": results,
            "pending_drafts": pending_drafts,
            "phase": session["phase"],
        }


def _apply_match_result(session_id: str, match_id: int,
                        team1: str, team2: str,
                        result: dict, gs: dict,
                        draft: dict | None) -> None:
    """Save match result and update standings in gs (caller saves gs)."""
    import json as _json

    winner = team1 if result["winner"] == 1 else team2
    loser = team2 if result["winner"] == 1 else team1

    gs.setdefault("standings", {})
    gs["standings"].setdefault(winner, {"wins": 0, "losses": 0})
    gs["standings"].setdefault(loser, {"wins": 0, "losses": 0})
    gs["standings"][winner]["wins"] += 1
    gs["standings"][loser]["losses"] += 1

    mp_db.save_match_result(match_id, result, draft)


def _finalize_week(session_id: str, session: dict, gs: dict) -> None:
    """Move to next week or playoffs."""
    week = session["current_week"]
    mp_db.reset_all_ready(session_id)

    # Find highest week in schedule
    all_matches = mp_db.get_all_matches(session_id)
    max_week = max((m["week"] for m in all_matches), default=week)

    if week >= max_week:
        # Auto-démarrer les playoffs
        try:
            mp_start_playoffs(session_id)
            logger.info(f"Session {session_id[:8]}: split terminé → playoffs démarrés")
        except Exception as e:
            # En cas d'erreur (ex: pas assez d'équipes), passer directement en finished
            logger.warning(f"Session {session_id[:8]}: impossible de démarrer les playoffs: {e}")
            mp_db.update_session_phase(session_id, "finished", week=week)
    else:
        mp_db.update_session_phase(session_id, "regular", week=week + 1)
        logger.info(f"Session {session_id[:8]}: semaine {week} → {week + 1}")


# ── Draft ─────────────────────────────────────────────────────────────────────

def _normalize_draft_keys(draft: dict) -> dict:
    """
    JSON ne supporte que des clés string. Après json.loads, bans/picks ont
    des clés "1"/"2". On les convertit en int pour cohérence avec DRAFT_SEQUENCE.
    """
    def to_int_keys(d: dict) -> dict:
        return {int(k): v for k, v in d.items()}

    return {
        **draft,
        "bans": to_int_keys(draft.get("bans", {"1": [], "2": {}})),
        "picks": to_int_keys(draft.get("picks", {"1": [], "2": {}})),
    }


def _new_draft_state() -> dict:
    # Clés int pour cohérence avec DRAFT_SEQUENCE (qui utilise int pour side)
    return {
        "step": 0,
        "sequence": DRAFT_SEQUENCE,
        "bans": {1: [], 2: []},
        "picks": {1: [], 2: []},
        "completed": False,
    }


def draft_action(session_id: str, token: str, match_id: int,
                 champion: str, simulate_fn: Callable) -> dict:
    """
    Perform a ban or pick. When draft complete → auto-simulate match.
    Side mapping: team1 of match = side 1, team2 = side 2.
    """
    import json as _json

    lock = mp_db._get_session_lock(session_id)
    with lock:
        session = mp_db.get_session(session_id)
        if session is None:
            raise ValueError("Session introuvable")

        player = mp_db.get_player(session_id, token)
        if player is None:
            raise ValueError("Token invalide")

        match = mp_db.get_match_by_id(match_id)
        if match is None or match["session_id"] != session_id:
            raise ValueError("Match introuvable")

        if match["draft_completed"]:
            raise ValueError("Draft déjà terminée")

        raw_draft = _json.loads(match["draft_json"]) if match["draft_json"] else _new_draft_state()
        # JSON deserialise les clés en strings — on normalise en int pour cohérence
        draft = _normalize_draft_keys(raw_draft)
        step = draft["step"]

        if step >= len(DRAFT_SEQUENCE):
            raise ValueError("Toutes les actions ont été effectuées")

        action_type, expected_side = DRAFT_SEQUENCE[step]

        # Determine player's side in this match (team1=side1, team2=side2)
        players = mp_db.get_players(session_id)
        player_team = player["team_id"]
        if player_team == match["team1"]:
            my_match_side = 1
        elif player_team == match["team2"]:
            my_match_side = 2
        else:
            raise ValueError("Vous ne participez pas à ce match")

        if my_match_side != expected_side:
            raise ValueError(f"Pas votre tour (attendu: side {expected_side})")

        champion = champion.strip()
        all_used = draft["bans"][1] + draft["bans"][2] + draft["picks"][1] + draft["picks"][2]
        if champion in all_used:
            raise ValueError(f"'{champion}' déjà utilisé")

        if action_type == "ban":
            draft["bans"][my_match_side].append(champion)
        else:
            draft["picks"][my_match_side].append(champion)

        draft["step"] += 1
        completed = draft["step"] >= len(DRAFT_SEQUENCE)
        draft["completed"] = completed

        mp_db.update_draft_state(match_id, _json.dumps(draft), draft["step"], completed)
        mp_db.log_event(session_id, "draft_action", {
            "match_id": match_id, "action": action_type,
            "champion": champion, "side": my_match_side
        })

        result = None
        if completed:
            # Simulate the match with draft picks
            gs = mp_db.load_game_state(session_id) or {}
            picks1 = draft["picks"][1]
            picks2 = draft["picks"][2]
            result = simulate_fn(match["team1"], match["team2"], gs, picks1, picks2)
            _apply_match_result(session_id, match_id, match["team1"], match["team2"], result, gs, draft)
            mp_db.save_game_state(session_id, gs)

            # Check if all human drafts for this week are done → finalize
            week_matches = mp_db.get_week_matches(session_id, session["current_week"])
            all_done = all(
                m["result_json"] is not None
                for m in week_matches
            )
            if all_done:
                _finalize_week(session_id, session, gs)

        next_step = None
        if not completed and draft["step"] < len(DRAFT_SEQUENCE):
            a, s = DRAFT_SEQUENCE[draft["step"]]
            next_step = {"action": a, "side": s}

        return {
            "ok": True,
            "step": draft["step"],
            "completed": completed,
            "next_action": next_step,
            "bans": draft["bans"],
            "picks": draft["picks"],
            "match_result": result,
        }


# ── Roster management (modifie l'état de la session, pas le GAME_STATE solo) ──

def roster_swap(session_id: str, token: str, player1_id: str, player2_id: str) -> dict:
    """Swap starter status between two players of the player's team."""
    lock = mp_db._get_session_lock(session_id)
    with lock:
        player = mp_db.get_player(session_id, token)
        if player is None:
            raise ValueError("Token invalide")

        gs = mp_db.load_game_state(session_id)
        if gs is None:
            raise ValueError("État de jeu non initialisé")

        team_id = player["team_id"]
        team = gs["teams"].get(team_id)
        if team is None:
            raise ValueError("Équipe introuvable")

        if player1_id not in team["roster"] or player2_id not in team["roster"]:
            raise ValueError("Joueur non dans votre équipe")

        p1 = gs["players"][player1_id]
        p2 = gs["players"][player2_id]

        # Swap is_starter
        p1["is_starter"], p2["is_starter"] = p2["is_starter"], p1["is_starter"]

        mp_db.save_game_state(session_id, gs)
        return {"ok": True}


def get_team_state(session_id: str, token: str) -> dict:
    """Return team data + players for the caller's team."""
    player = mp_db.get_player(session_id, token)
    if player is None:
        raise ValueError("Token invalide")

    gs = mp_db.load_game_state(session_id)
    if gs is None:
        raise ValueError("État de jeu non initialisé")

    team_id = player["team_id"]
    team = gs["teams"].get(team_id, {})
    roster = [gs["players"][pid] for pid in team.get("roster", []) if pid in gs["players"]]

    return {"team": team, "players": roster}


# ── Playoffs ───────────────────────────────────────────────────────────────────

def _mp_make_playoff_match(round_name: str, match_number: int, team1: str, team2: str) -> dict:
    import uuid as _uuid
    return {
        "id": str(_uuid.uuid4()),
        "round": round_name,
        "match_number": match_number,
        "team1": team1,
        "team2": team2,
        "team1_wins": 0,
        "team2_wins": 0,
        "games": [],
        "winner": None,
        "best_of": 5,
        "completed": False,
    }


def _mp_match_loser(match: dict) -> str:
    return match["team2"] if match["winner"] == match["team1"] else match["team1"]


def mp_start_playoffs(session_id: str) -> dict:
    """Initialize playoffs bracket from current standings. Stores bracket in game_state."""
    lock = mp_db._get_session_lock(session_id)
    with lock:
        gs = mp_db.load_game_state(session_id) or {}
        standings = gs.get("standings", {})
        league = gs.get("league", "LEC").upper()

        # Sort teams by wins desc, losses asc
        sorted_teams = sorted(
            standings.items(),
            key=lambda x: (-x[1].get("wins", 0), x[1].get("losses", 0), x[0])
        )

        n_qual = 10 if league == "LPL" else 6
        qualified = [tid for tid, _ in sorted_teams[:n_qual]]

        if league == "LPL" and len(qualified) >= 10:
            bracket = _mp_init_bracket_lpl(qualified)
        else:
            # Fallback: cap at available teams, minimum 4
            qualified = qualified[:6]
            bracket = _mp_init_bracket_standard(qualified)

        gs["playoffs_bracket"] = bracket
        mp_db.save_game_state(session_id, gs)
        mp_db.update_session_phase(session_id, "playoffs")
        mp_db.log_event(session_id, "playoffs_started", {"qualified": qualified})
        return bracket


def _mp_init_bracket_standard(qualified: list) -> dict:
    """6-team double-elim: seeds 1-4 UB, seeds 5-6 LB entry."""
    q = qualified
    return {
        "format": "standard",
        "qualified_teams": q,
        "active_rounds": ["ub_r1"],
        "matches": [
            _mp_make_playoff_match("ub_r1", 1, q[0], q[3]),  # #1 vs #4
            _mp_make_playoff_match("ub_r1", 2, q[1], q[2]),  # #2 vs #3
        ],
        "champion": None,
        "ub_r1_losers": [],
        "ub_final_winner": None,
        "ub_final_loser": None,
        "lb_r1_winner": None,
        "lb_r2_winner": None,
        "lb_r3_winner": None,
    }


def _mp_init_bracket_lpl(qualified: list) -> dict:
    """10-team LPL double-elim."""
    q = qualified
    return {
        "format": "lpl",
        "qualified_teams": q,
        "active_rounds": ["ub_r1", "lb_r1"],
        "matches": [
            _mp_make_playoff_match("ub_r1", 1, q[2], q[5]),
            _mp_make_playoff_match("ub_r1", 2, q[3], q[4]),
            _mp_make_playoff_match("lb_r1", 1, q[6], q[9]),
            _mp_make_playoff_match("lb_r1", 2, q[7], q[8]),
        ],
        "champion": None,
        "ub_r1_winners": [], "ub_r1_losers": [],
        "ub_r2_winners": [], "ub_r2_losers": [],
        "ub_final_winner": None, "ub_final_loser": None,
        "lb_r1_winners": [], "lb_r2_winners": [], "lb_r3_winners": [],
        "lb_sf_winner": None,
    }


def mp_advance_playoffs(session_id: str) -> dict:
    """Advance bracket when all active-round matches are complete. Returns updated bracket."""
    lock = mp_db._get_session_lock(session_id)
    with lock:
        gs = mp_db.load_game_state(session_id) or {}
        bracket = gs.get("playoffs_bracket")
        if bracket is None:
            raise ValueError("Bracket non initialisé")

        if bracket.get("format") == "lpl":
            _mp_advance_lpl(bracket)
        else:
            _mp_advance_standard(bracket)

        # Champion crowned → session finished
        if bracket.get("champion"):
            mp_db.update_session_phase(session_id, "finished")
            mp_db.log_event(session_id, "champion_crowned", {"champion": bracket["champion"]})

        gs["playoffs_bracket"] = bracket
        mp_db.save_game_state(session_id, gs)
        return bracket


def _mp_advance_standard(bracket: dict) -> None:
    active_rounds = bracket["active_rounds"]
    active_matches = [m for m in bracket["matches"] if m["round"] in active_rounds]
    if not all(m["completed"] for m in active_matches):
        return

    qualified = bracket["qualified_teams"]

    def get_m(rnd, num=None):
        ms = [m for m in active_matches if m["round"] == rnd]
        if num is not None:
            ms = [m for m in ms if m["match_number"] == num]
        return ms[0] if ms else None

    if active_rounds == ["ub_r1"]:
        m1 = get_m("ub_r1", 1)
        m2 = get_m("ub_r1", 2)
        bracket["ub_r1_losers"] = [_mp_match_loser(m1), _mp_match_loser(m2)]
        bracket["active_rounds"] = ["ub_final", "lb_r1"]
        bracket["matches"] += [
            _mp_make_playoff_match("ub_final", 1, m1["winner"], m2["winner"]),
            _mp_make_playoff_match("lb_r1", 1, qualified[4], qualified[5]),
        ]

    elif set(active_rounds) == {"ub_final", "lb_r1"}:
        ubf = get_m("ub_final")
        lb1 = get_m("lb_r1")
        bracket["ub_final_winner"] = ubf["winner"]
        bracket["ub_final_loser"] = _mp_match_loser(ubf)
        bracket["lb_r1_winner"] = lb1["winner"]
        bracket["active_rounds"] = ["lb_r2"]
        bracket["matches"].append(
            _mp_make_playoff_match("lb_r2", 1, bracket["lb_r1_winner"], bracket["ub_r1_losers"][0])
        )

    elif active_rounds == ["lb_r2"]:
        lb2 = active_matches[0]
        bracket["lb_r2_winner"] = lb2["winner"]
        bracket["active_rounds"] = ["lb_r3"]
        bracket["matches"].append(
            _mp_make_playoff_match("lb_r3", 1, bracket["lb_r2_winner"], bracket["ub_r1_losers"][1])
        )

    elif active_rounds == ["lb_r3"]:
        lb3 = active_matches[0]
        bracket["lb_r3_winner"] = lb3["winner"]
        bracket["active_rounds"] = ["lb_final"]
        bracket["matches"].append(
            _mp_make_playoff_match("lb_final", 1, bracket["lb_r3_winner"], bracket["ub_final_loser"])
        )

    elif active_rounds == ["lb_final"]:
        lbf = active_matches[0]
        bracket["active_rounds"] = ["grand_final"]
        bracket["matches"].append(
            _mp_make_playoff_match("grand_final", 1, bracket["ub_final_winner"], lbf["winner"])
        )

    elif active_rounds == ["grand_final"]:
        gf = active_matches[0]
        bracket["champion"] = gf["winner"]
        bracket["active_rounds"] = []


def _mp_advance_lpl(bracket: dict) -> None:
    active_rounds = bracket["active_rounds"]
    qualified = bracket["qualified_teams"]
    active_matches = [m for m in bracket["matches"] if m["round"] in active_rounds]
    if not all(m["completed"] for m in active_matches):
        return

    def ms(rnd): return sorted([m for m in active_matches if m["round"] == rnd], key=lambda m: m["match_number"])

    if set(active_rounds) == {"ub_r1", "lb_r1"}:
        ub_ms = ms("ub_r1"); lb_ms = ms("lb_r1")
        bracket["ub_r1_winners"] = [m["winner"] for m in ub_ms]
        bracket["ub_r1_losers"] = [_mp_match_loser(m) for m in ub_ms]
        bracket["lb_r1_winners"] = [m["winner"] for m in lb_ms]
        bracket["active_rounds"] = ["ub_r2", "lb_r2"]
        bracket["matches"] += [
            _mp_make_playoff_match("ub_r2", 1, qualified[0], bracket["ub_r1_winners"][0]),
            _mp_make_playoff_match("ub_r2", 2, qualified[1], bracket["ub_r1_winners"][1]),
            _mp_make_playoff_match("lb_r2", 1, bracket["ub_r1_losers"][0], bracket["lb_r1_winners"][0]),
            _mp_make_playoff_match("lb_r2", 2, bracket["ub_r1_losers"][1], bracket["lb_r1_winners"][1]),
        ]

    elif set(active_rounds) == {"ub_r2", "lb_r2"}:
        ub_ms = ms("ub_r2"); lb_ms = ms("lb_r2")
        bracket["ub_r2_winners"] = [m["winner"] for m in ub_ms]
        bracket["ub_r2_losers"] = [_mp_match_loser(m) for m in ub_ms]
        bracket["lb_r2_winners"] = [m["winner"] for m in lb_ms]
        bracket["active_rounds"] = ["ub_final", "lb_r3"]
        bracket["matches"] += [
            _mp_make_playoff_match("ub_final", 1, bracket["ub_r2_winners"][0], bracket["ub_r2_winners"][1]),
            _mp_make_playoff_match("lb_r3", 1, bracket["ub_r2_losers"][0], bracket["lb_r2_winners"][0]),
            _mp_make_playoff_match("lb_r3", 2, bracket["ub_r2_losers"][1], bracket["lb_r2_winners"][1]),
        ]

    elif set(active_rounds) == {"ub_final", "lb_r3"}:
        ubf = ms("ub_final")[0]; lb_ms = ms("lb_r3")
        bracket["ub_final_winner"] = ubf["winner"]
        bracket["ub_final_loser"] = _mp_match_loser(ubf)
        bracket["lb_r3_winners"] = [m["winner"] for m in lb_ms]
        bracket["active_rounds"] = ["lb_sf"]
        bracket["matches"].append(
            _mp_make_playoff_match("lb_sf", 1, bracket["lb_r3_winners"][0], bracket["lb_r3_winners"][1])
        )

    elif active_rounds == ["lb_sf"]:
        lbsf = active_matches[0]
        bracket["lb_sf_winner"] = lbsf["winner"]
        bracket["active_rounds"] = ["lb_final"]
        bracket["matches"].append(
            _mp_make_playoff_match("lb_final", 1, bracket["lb_sf_winner"], bracket["ub_final_loser"])
        )

    elif active_rounds == ["lb_final"]:
        lbf = active_matches[0]
        bracket["active_rounds"] = ["grand_final"]
        bracket["matches"].append(
            _mp_make_playoff_match("grand_final", 1, bracket["ub_final_winner"], lbf["winner"])
        )

    elif active_rounds == ["grand_final"]:
        gf = active_matches[0]
        bracket["champion"] = gf["winner"]
        bracket["active_rounds"] = []


def mp_simulate_playoff_series(session_id: str, match_id: str,
                                simulate_fn: callable) -> dict:
    """Simulate a full Bo5 series (AI vs AI). Returns series result."""
    lock = mp_db._get_session_lock(session_id)
    with lock:
        gs = mp_db.load_game_state(session_id) or {}
        bracket = gs.get("playoffs_bracket")
        if bracket is None:
            raise ValueError("Bracket non initialisé")

        match = next((m for m in bracket["matches"] if m["id"] == match_id), None)
        if match is None:
            raise ValueError("Match introuvable")
        if match["completed"]:
            raise ValueError("Série déjà terminée")

        wins_needed = (match["best_of"] // 2) + 1
        while match["team1_wins"] < wins_needed and match["team2_wins"] < wins_needed:
            result = simulate_fn(match["team1"], match["team2"], gs, [], [])
            if result["winner"] == 1:
                match["team1_wins"] += 1
            else:
                match["team2_wins"] += 1
            match["games"].append({"winner": match["team1"] if result["winner"] == 1 else match["team2"]})

        match["winner"] = match["team1"] if match["team1_wins"] >= wins_needed else match["team2"]
        match["completed"] = True

        # Update standings for champion tracking
        gs.setdefault("standings", {})
        gs["standings"].setdefault(match["winner"], {"wins": 0, "losses": 0})

        # Advance bracket if all active matches complete
        active_matches = [m for m in bracket["matches"] if m["round"] in bracket["active_rounds"]]
        if all(m["completed"] for m in active_matches):
            if bracket.get("format") == "lpl":
                _mp_advance_lpl(bracket)
            else:
                _mp_advance_standard(bracket)
            if bracket.get("champion"):
                mp_db.update_session_phase(session_id, "finished")
                mp_db.log_event(session_id, "champion_crowned", {"champion": bracket["champion"]})

        gs["playoffs_bracket"] = bracket
        mp_db.save_game_state(session_id, gs)

        return {
            "match_id": match_id,
            "winner": match["winner"],
            "team1_wins": match["team1_wins"],
            "team2_wins": match["team2_wins"],
            "champion": bracket.get("champion"),
            "active_rounds": bracket["active_rounds"],
        }
