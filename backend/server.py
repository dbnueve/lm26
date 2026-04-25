from fastapi import FastAPI, APIRouter, HTTPException, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import logging
import csv as _csv_module
from collections import Counter as _Counter
from pathlib import Path

# Configure logging early so all modules benefit from the same format
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from models import (
    NewGameRequest, SignERLPlayerRequest, PlayoffsGameRequest, SimulateMatchRequest,
    NegotiationOffer, CounterOfferBody, DraftStartRequest, DraftAction,
    TrainingRequest, TrainingPlanRequest, TeamTrainingPlanRequest, RosterSwapRequest,
    IntlSimRequest, _Mp2CreateBody, _Mp2JoinBody, _Mp2TeamBody, _Mp2ReadyBody,
    _Mp2DraftStartBody, _Mp2DraftActionBody,
)
from simulation import (
    simulate_match_phases, generate_kill_totals, generate_detailed_events,
    _player_performance_score,
)
from draft_ai import (
    CHAMP_TRAITS, SYNERGY_PAIRS, COUNTER_MAP, DRAFT_SEQUENCE, META_LOOKUP,
    comp_score, delta_analyzer, calculate_draft_advantage,
    ai_select_ban as _ai_select_ban, ai_select_pick as _ai_select_pick,
    _get_team_champ_pool, _get_team_champ_pool_by_pos, _get_current_opponent_id,
    _needed_positions,
)
import draft_ai as _draft_ai_module
from tactics import (
    DEFAULT_TACTICS, COHERENCE_RULES,
    get_user_tactics, evaluate_coherence, calculate_tactics_modifier,
)
from training import execute_training_apply, execute_training_plan as _execute_training_plan
from inbox import (
    add_inbox_message as _add_inbox_message,
    generate_match_inbox_messages as _generate_match_inbox_messages,
    generate_weekly_board_message as _generate_weekly_board_message,
)
import uuid
import random
from datetime import datetime, timezone
import requests as http_requests
from league_meta_data import LEAGUE_META_CHAMPIONS
from elo_system import (
    ensure_team_elo, apply_match_elo, elo_power_modifier,
    get_league_avg_elo, initial_elo,
)
try:
    from csv_erl_data import SCOUTING_PLAYERS as _CSV_SCOUTING_PLAYERS
except ImportError:
    _CSV_SCOUTING_PLAYERS = []
# ── Constantes métier ─────────────────────────────────────
BUDGET_HIGH    = 4_800_000
BUDGET_MID     = 3_800_000
BUDGET_LOW     = 2_800_000

SALARY_PRO_MIN = 80_000
SALARY_PRO_MAX = 400_000

SALARY_ERL_MIN = 20_000
SALARY_ERL_MAX = 80_000

TRANSFER_PRO_MIN      = 100_000
TRANSFER_PRO_MAX      = 800_000
TRANSFER_ERL_MULT_MIN = 8_000
TRANSFER_ERL_MULT_MAX = 15_000

GOLD_PER_MATCH_MIN = 8_000
GOLD_PER_MATCH_MAX = 18_000

# Poids des attributs pour le calcul de puissance en simulation
SKILL_W_MECHANICS   = 0.30
SKILL_W_GAME_SENSE  = 0.30
SKILL_W_RATING      = 0.20
SKILL_W_TEAMWORK    = 0.10
SKILL_W_CONSISTENCY = 0.10

# Ratios offre/valeur pour l'acceptation des transferts
TRANSFER_ACCEPT_BASE       = 0.3
TRANSFER_ACCEPT_RATIO_HIGH = 1.5   # → 90 %
TRANSFER_ACCEPT_RATIO_MID  = 1.2   # → 70 %
TRANSFER_ACCEPT_RATIO_FAIR = 1.0   # → 50 %
TRANSFER_ACCEPT_RATIO_LOW  = 0.8   # → 20 %
TRANSFER_SALARY_PCT        = 0.15  # salaire = 15 % du montant du transfert
# ─────────────────────────────────────────────────────────

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ── Champion pools from Oracle's Elixir CSV data ──────────────────────────────
def _build_csv_champion_pools() -> dict:
    """Return {playername_lower: [champ1, champ2, ...]} sorted by play count."""
    counts: dict = {}
    csv_files = [
        ROOT_DIR.parent / "2026_LoL_esports_match_data_from_OraclesElixir.csv",
        ROOT_DIR.parent / "2025_LoL_esports_match_data_from_OraclesElixir.csv",
    ]
    for path in csv_files:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8", newline="") as f:
                for row in _csv_module.DictReader(f):
                    name = (row.get("playername") or "").strip().lower()
                    champ = (row.get("champion") or "").strip()
                    pos = (row.get("position") or "").strip()
                    if not name or not champ or pos in ("", "team"):
                        continue
                    if name not in counts:
                        counts[name] = _Counter()
                    counts[name][champ] += 1
        except Exception as e:
            logging.warning(f"_build_csv_champion_pools: échec parsing CSV: {e}")
    return {name: [c for c, _ in ctr.most_common(6)] for name, ctr in counts.items()}

CSV_CHAMPION_POOLS: dict = _build_csv_champion_pools()

# ── Save slot system ──────────────────────────────────────────────────────────
# 3 independent save slots stored as game_save_1/2/3.json
# The active slot is remembered in active_slot.txt so backend restarts
# can auto-restore the last session without frontend involvement.

# I/O helpers extraits dans save_paths.py (refactor étape 1)
from save_paths import get_save_path, _read_active_slot_file, _write_active_slot_file  # noqa: E402
# État global extrait dans app_state.py (refactor étape 2)
from app_state import GAME_STATE, state  # noqa: E402
# Persistence extraite dans persistence.py (refactor étape 3)
from persistence import save_state as _persistence_save_state, load_state, _sync_state_if_stale, register_post_load_hook  # noqa: E402

# Depth counter bumped while a handler runs with GAME_STATE swapped to an MP
# session. Any `save_state()` during this window would clobber the SOLO save
# slot with session data. Module-level int is safe: `_swap_lock` already
# serialises concurrent swaps, and within a single request the middleware
# thread and the threadpool handler share the same Python process state.
# See `_mp2_session_swap_middleware` / `_run_shared_action_for_session`.
_mp_swap_depth = 0


def save_state():
    """Persist GAME_STATE to the active solo slot — NO-OP while an MP session
    is swapped in. Session mutations are copied back into `sess.state` by the
    middleware and flushed by the autosave loop; writing the solo file here
    would overwrite the offline user's save with another player's data.
    """
    if _mp_swap_depth > 0:
        return
    _persistence_save_state()
# Registre MP en mémoire (refactor étape 4: mp-as-shared-solo)
import sessions as _sessions  # noqa: E402

# Map league name -> which main league scouts from it
_LEAGUE_TO_SCOUTING_FOR = {
    # Curated European sub-leagues
    "LFL": "LEC", "PRM": "LEC", "NLC": "LEC", "LVP SL": "LEC",
    "TCL": "LEC", "EBL": "LEC", "LCK CL": "LCK",
    # CSV-derived leagues
    "LCKC": "LCK",
    "NACL": "LCS",
    "EM":   "LEC",
    "CD":   "CBLOL",
    "LRS":  "CBLOL",
    "DCup": "LPL",
}

def _refresh_erl_pool_on_load():
    """Rebuild erl_players from the current ERL_PLAYERS list when loading a save.
    
    This ensures the pool always reflects the correct scouting_for per league,
    even when loading saves created before csv_erl_data was integrated.
    Players already promoted to the main roster (in GAME_STATE["players"]) are
    kept; only the scouting pool (erl_players) is rebuilt.
    """
    # 1. Vérifier si les joueurs ERL ont déjà été restaurés par la sauvegarde
    if GAME_STATE.get("erl_players"):
        # Les données sont là, on quitte la fonction pour ne pas écraser les joueurs existants !
        return
    active_league = GAME_STATE.get("league", "LEC")
    GAME_STATE["erl_players"] = {}
    for erl_data in ERL_PLAYERS:
        player = generate_erl_player(erl_data)
        GAME_STATE["erl_players"][player["id"]] = player
    # Seed deterministically so the same save always produces the same pool
    _seed = hash((active_league, GAME_STATE.get("season", 2026), GAME_STATE.get("current_split", 1))) & 0xFFFFFFFF
    _rng_state = random.getstate()
    random.seed(_seed)
    for _ in range(30):
        newgen_data = generate_newgen(active_league)
        newgen_data["scouting_for"] = active_league
        player = generate_erl_player(newgen_data)
        GAME_STATE["erl_players"][player["id"]] = player
    random.setstate(_rng_state)


def _refresh_champion_pools_on_load():
    """Overwrite champion pools for all loaded players using CSV data."""
    for player in GAME_STATE.get("players", {}).values():
        csv_pool = CSV_CHAMPION_POOLS.get((player.get("name") or "").lower(), [])
        if csv_pool:
            player["champion_pool"] = csv_pool[:6]
    for player in GAME_STATE.get("erl_players", {}).values():
        csv_pool = CSV_CHAMPION_POOLS.get((player.get("name") or "").lower(), [])
        if csv_pool:
            player["champion_pool"] = csv_pool[:6]


def sync_base_stats():
    """Sync team ratings/budget/prestige and player KDA from updated constants (non-destructive)."""
    league = GAME_STATE.get("league", "LEC")
    league_teams = LEAGUES_DATA.get(league, LEAGUES_DATA["LEC"])["teams"]
    teams_map = {t["id"]: t for t in league_teams}
    for tid, team in GAME_STATE.get("teams", {}).items():
        if tid in teams_map:
            for key in ("rating", "budget", "prestige", "name", "abbr"):
                team[key] = teams_map[tid][key]
    # Sync player KDA/csm from PLAYER_META_STATS
    for pid, player in GAME_STATE.get("players", {}).items():
        pname = player.get("name", "")
        stats = PLAYER_META_STATS.get(pname, {})
        if stats:
            if "kda" in stats:
                player["kda"] = stats["kda"]
            if "csm" in stats:
                player["cs_min"] = stats["csm"]

def _compute_tier_from_stats(picks: int, wins: int, bans: int, total_games: int) -> str:
    """Compute S/A/B/C tier for a champion based on pick/ban/win data from a split."""
    if picks + bans < 3:
        return "C"
    if picks + bans < 6:
        return "B"
    presence = (picks + bans) / max(total_games, 1) * 100
    winrate = (wins / picks * 100) if picks > 0 else 50.0
    wr_bonus = (winrate - 50) * 0.5   # ±25 range; boosts strong champs, penalises weak
    score = presence + wr_bonus
    if score >= 50:
        return "S"
    elif score >= 22:
        return "A"
    elif score >= 8:
        return "B"
    else:
        return "C"


def update_meta_from_split_stats():
    """Recompute champion tiers from the just-finished split's pick/ban data
    and store the result in GAME_STATE['meta_champions'].
    Also rebuilds META_LOOKUP so draft / stats use up-to-date values."""
    import copy
    champ_stats = GAME_STATE.get("champion_stats", {})
    total = GAME_STATE.get("total_games_played", 0)
    if total == 0 or not champ_stats:
        return  # Nothing to update

    # Start from baseline (or previous dynamic meta) and deep-copy it
    base = GAME_STATE.get("meta_champions") or _get_league_baseline_meta()
    meta = copy.deepcopy(base)

    # Map every known champion → its position
    champ_to_pos: dict = {}
    for pos, champs in meta.items():
        for c in champs:
            champ_to_pos[c["name"]] = pos

    TIER_DECAY = {"S": "A", "A": "B", "B": "C", "C": "C"}

    # Update existing champions
    for pos, champs in meta.items():
        for c in champs:
            name = c["name"]
            if name in champ_stats:
                s = champ_stats[name]
                p = s.get("picks", 0)
                w = s.get("wins", 0)
                b = s.get("bans", 0)
                c["picks"]   = p
                c["bans"]    = b
                c["winrate"] = round(w / p * 100, 1) if p > 0 else 0.0
                c["tier"]    = _compute_tier_from_stats(p, w, b, total)
            else:
                # Champion not seen this split → decay one tier, reset counts
                c["tier"]    = TIER_DECAY.get(c.get("tier", "C"), "C")
                c["picks"]   = 0
                c["bans"]    = 0
                c["winrate"] = 0.0

    # Add champions from the split that weren't in the baseline meta
    for name, s in champ_stats.items():
        if name in champ_to_pos:
            continue  # already handled above
        positions_seen = s.get("positions", {})
        pos = max(positions_seen, key=positions_seen.get) if positions_seen else None
        if pos and pos in meta:
            p = s.get("picks", 0)
            w = s.get("wins", 0)
            b = s.get("bans", 0)
            meta[pos].append({
                "name":    name,
                "picks":   p,
                "bans":    b,
                "winrate": round(w / p * 100, 1) if p > 0 else 0.0,
                "tier":    _compute_tier_from_stats(p, w, b, total),
            })

    GAME_STATE["meta_champions"] = meta
    GAME_STATE["total_games_played_meta"] = total

    # Rebuild META_LOOKUP in-place so all code using it picks up the new data
    META_LOOKUP.clear()
    for pos, champs in meta.items():
        for c in champs:
            META_LOOKUP[c["name"]] = {
                **c,
                "position": pos,
                "presence": round((c["picks"] + c["bans"]) / max(total, 1) * 100, 1),
            }


def ensure_initialized():
    """Restore last session from file, or start fresh."""
    if not GAME_STATE["initialized"]:
        if not load_state():
            initialize_game()
        sync_base_stats()

# Migrate legacy game_save.json → game_save_1.json once
_legacy = ROOT_DIR / "game_save.json"
_slot1  = get_save_path(1)
if _legacy.exists() and not _slot1.exists():
    try:
        _legacy.rename(_slot1)
    except Exception as e:
        logging.error(f"Migration failed: {e}")

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Real LEC 2026 Meta Data from Oracle's Elixir CSV (Spring + Versus, 62 games)
TOTAL_GAMES = 62

META_CHAMPIONS = {
    "TOP": [
        {"name": "Rumble", "picks": 45, "bans": 58, "winrate": 60.0, "tier": "S"},
        {"name": "K'Sante", "picks": 48, "bans": 19, "winrate": 41.7, "tier": "S"},
        {"name": "Sion", "picks": 29, "bans": 28, "winrate": 55.2, "tier": "S"},
        {"name": "Ambessa", "picks": 20, "bans": 27, "winrate": 60.0, "tier": "S"},
        {"name": "Gnar", "picks": 17, "bans": 23, "winrate": 58.8, "tier": "S"},
        {"name": "Renekton", "picks": 14, "bans": 21, "winrate": 50.0, "tier": "A"},
        {"name": "Poppy", "picks": 5, "bans": 28, "winrate": 40.0, "tier": "A"},
        {"name": "Gwen", "picks": 8, "bans": 15, "winrate": 37.5, "tier": "A"},
        {"name": "Jax", "picks": 3, "bans": 9, "winrate": 0.0, "tier": "B"},
        {"name": "Ornn", "picks": 9, "bans": 0, "winrate": 44.4, "tier": "C"},
        {"name": "Kennen", "picks": 4, "bans": 4, "winrate": 75.0, "tier": "C"},
        {"name": "Kled", "picks": 5, "bans": 1, "winrate": 60.0, "tier": "C"},
        {"name": "Gragas", "picks": 2, "bans": 0, "winrate": 100.0, "tier": "C"},
        {"name": "Yasuo", "picks": 2, "bans": 0, "winrate": 50.0, "tier": "C"},
        {"name": "Shen", "picks": 2, "bans": 0, "winrate": 100.0, "tier": "C"},
        {"name": "Volibear", "picks": 2, "bans": 0, "winrate": 0.0, "tier": "C"},
    ],
    "JUNGLE": [
        {"name": "Xin Zhao", "picks": 36, "bans": 7, "winrate": 50.0, "tier": "S"},
        {"name": "Vi", "picks": 32, "bans": 43, "winrate": 53.1, "tier": "S"},
        {"name": "Jarvan IV", "picks": 29, "bans": 47, "winrate": 41.4, "tier": "S"},
        {"name": "Pantheon", "picks": 31, "bans": 41, "winrate": 38.7, "tier": "S"},
        {"name": "Dr. Mundo", "picks": 18, "bans": 31, "winrate": 61.1, "tier": "S"},
        {"name": "Jayce", "picks": 11, "bans": 42, "winrate": 45.5, "tier": "S"},
        {"name": "Wukong", "picks": 23, "bans": 12, "winrate": 52.2, "tier": "A"},
        {"name": "Aatrox", "picks": 17, "bans": 10, "winrate": 70.6, "tier": "A"},
        {"name": "Malphite", "picks": 3, "bans": 21, "winrate": 0.0, "tier": "A"},
        {"name": "Nocturne", "picks": 9, "bans": 12, "winrate": 33.3, "tier": "B"},
        {"name": "Zac", "picks": 8, "bans": 7, "winrate": 62.5, "tier": "B"},
        {"name": "Skarner", "picks": 4, "bans": 2, "winrate": 75.0, "tier": "C"},
        {"name": "Sejuani", "picks": 3, "bans": 1, "winrate": 66.7, "tier": "C"},
        {"name": "Qiyana", "picks": 3, "bans": 6, "winrate": 100.0, "tier": "C"},
        {"name": "Naafiri", "picks": 4, "bans": 3, "winrate": 25.0, "tier": "C"},
        {"name": "Trundle", "picks": 2, "bans": 4, "winrate": 50.0, "tier": "C"},
    ],
    "MID": [
        {"name": "Azir", "picks": 56, "bans": 41, "winrate": 53.6, "tier": "S"},
        {"name": "Orianna", "picks": 31, "bans": 56, "winrate": 58.1, "tier": "S"},
        {"name": "Taliyah", "picks": 33, "bans": 20, "winrate": 57.6, "tier": "S"},
        {"name": "Ryze", "picks": 33, "bans": 27, "winrate": 51.5, "tier": "S"},
        {"name": "Akali", "picks": 5, "bans": 22, "winrate": 60.0, "tier": "A"},
        {"name": "Ahri", "picks": 14, "bans": 1, "winrate": 57.1, "tier": "B"},
        {"name": "Aurora", "picks": 12, "bans": 6, "winrate": 50.0, "tier": "B"},
        {"name": "Anivia", "picks": 10, "bans": 6, "winrate": 50.0, "tier": "B"},
        {"name": "Galio", "picks": 8, "bans": 4, "winrate": 37.5, "tier": "B"},
        {"name": "Yone", "picks": 9, "bans": 7, "winrate": 22.2, "tier": "B"},
        {"name": "Cassiopeia", "picks": 7, "bans": 5, "winrate": 42.9, "tier": "B"},
        {"name": "Viktor", "picks": 6, "bans": 1, "winrate": 66.7, "tier": "C"},
        {"name": "Aurelion Sol", "picks": 3, "bans": 2, "winrate": 33.3, "tier": "C"},
        {"name": "LeBlanc", "picks": 3, "bans": 1, "winrate": 0.0, "tier": "C"},
        {"name": "Syndra", "picks": 3, "bans": 0, "winrate": 0.0, "tier": "C"},
        {"name": "Zoe", "picks": 2, "bans": 2, "winrate": 100.0, "tier": "C"},
    ],
    "ADC": [
        {"name": "Yunara", "picks": 45, "bans": 46, "winrate": 55.6, "tier": "S"},
        {"name": "Varus", "picks": 19, "bans": 86, "winrate": 68.4, "tier": "S"},
        {"name": "Corki", "picks": 41, "bans": 8, "winrate": 39.0, "tier": "S"},
        {"name": "Ezreal", "picks": 26, "bans": 10, "winrate": 42.3, "tier": "A"},
        {"name": "Aphelios", "picks": 22, "bans": 16, "winrate": 45.5, "tier": "A"},
        {"name": "Kai'Sa", "picks": 15, "bans": 17, "winrate": 60.0, "tier": "A"},
        {"name": "Caitlyn", "picks": 14, "bans": 21, "winrate": 64.3, "tier": "A"},
        {"name": "Jhin", "picks": 18, "bans": 8, "winrate": 50.0, "tier": "A"},
        {"name": "Sivir", "picks": 13, "bans": 7, "winrate": 53.8, "tier": "B"},
        {"name": "Ashe", "picks": 11, "bans": 4, "winrate": 63.6, "tier": "B"},
        {"name": "Xayah", "picks": 8, "bans": 7, "winrate": 75.0, "tier": "B"},
        {"name": "Jinx", "picks": 4, "bans": 0, "winrate": 0.0, "tier": "C"},
        {"name": "Lucian", "picks": 4, "bans": 2, "winrate": 0.0, "tier": "C"},
        {"name": "Kalista", "picks": 2, "bans": 0, "winrate": 50.0, "tier": "C"},
        {"name": "Smolder", "picks": 1, "bans": 1, "winrate": 0.0, "tier": "C"},
    ],
    "SUPPORT": [
        {"name": "Alistar", "picks": 34, "bans": 22, "winrate": 58.8, "tier": "S"},
        {"name": "Bard", "picks": 31, "bans": 26, "winrate": 58.1, "tier": "S"},
        {"name": "Rakan", "picks": 30, "bans": 17, "winrate": 60.0, "tier": "S"},
        {"name": "Nautilus", "picks": 29, "bans": 51, "winrate": 34.5, "tier": "S"},
        {"name": "Neeko", "picks": 22, "bans": 49, "winrate": 45.5, "tier": "S"},
        {"name": "Nami", "picks": 20, "bans": 17, "winrate": 60.0, "tier": "A"},
        {"name": "Lulu", "picks": 16, "bans": 6, "winrate": 43.8, "tier": "A"},
        {"name": "Karma", "picks": 15, "bans": 19, "winrate": 40.0, "tier": "A"},
        {"name": "Seraphine", "picks": 11, "bans": 3, "winrate": 54.5, "tier": "B"},
        {"name": "Rell", "picks": 12, "bans": 4, "winrate": 50.0, "tier": "B"},
        {"name": "Braum", "picks": 8, "bans": 12, "winrate": 50.0, "tier": "B"},
        {"name": "Leona", "picks": 5, "bans": 0, "winrate": 80.0, "tier": "C"},
        {"name": "Thresh", "picks": 4, "bans": 2, "winrate": 25.0, "tier": "C"},
        {"name": "Renata Glasc", "picks": 3, "bans": 2, "winrate": 33.3, "tier": "C"},
        {"name": "Pyke", "picks": 2, "bans": 0, "winrate": 0.0, "tier": "C"},
        {"name": "Elise", "picks": 2, "bans": 1, "winrate": 50.0, "tier": "C"},
    ]
}

# Flat champion name lists (LEC baseline for backward compatibility)
CHAMPIONS = {
    pos: [c["name"] for c in champs] for pos, champs in META_CHAMPIONS.items()
}

# Build global lookup from LEC baseline (updated dynamically per active league at runtime)
META_LOOKUP = {}
for pos, champs in META_CHAMPIONS.items():
    for c in champs:
        META_LOOKUP[c["name"]] = {**c, "position": pos, "presence": round((c["picks"] + c["bans"]) / TOTAL_GAMES * 100, 1)}

def _get_league_baseline_meta() -> dict:
    """Return the static baseline meta for the active league from CSV data."""
    league = GAME_STATE.get("league", "LEC")
    return LEAGUE_META_CHAMPIONS.get(league, LEAGUE_META_CHAMPIONS.get("LEC", META_CHAMPIONS))

def get_meta_champions():
    """Return dynamic meta (updated after each split) or league-specific baseline from CSV."""
    return GAME_STATE.get("meta_champions") or _get_league_baseline_meta()

def _rebuild_meta_lookup():
    """Rebuild META_LOOKUP from the current league baseline meta."""
    base = _get_league_baseline_meta()
    all_picks = sum(c["picks"] + c["bans"] for champs in base.values() for c in champs)
    META_LOOKUP.clear()
    for pos, champs in base.items():
        for c in champs:
            META_LOOKUP[c["name"]] = {
                **c, "position": pos,
                "presence": round((c["picks"] + c["bans"]) / max(all_picks / 5, 1) * 100, 1)
            }

# Enregistrement des hooks post-chargement (refactor étape 3)
register_post_load_hook(_rebuild_meta_lookup)
register_post_load_hook(_refresh_erl_pool_on_load)
register_post_load_hook(_refresh_champion_pools_on_load)

# Player stats from Oracle's Elixir LEC 2026 CSV (avg per game)
PLAYER_META_STATS = {
    "BrokenBlade": {"kda": 4.26, "k": 1.9, "d": 2.0, "a": 6.8, "csm": 8.6, "dpm": 599},
    "SkewMond":    {"kda": 5.88, "k": 4.7, "d": 2.2, "a": 8.4, "csm": 7.4, "dpm": 531},
    "Caps":        {"kda": 5.22, "k": 4.5, "d": 2.3, "a": 7.7, "csm": 9.2, "dpm": 696},
    "Hans Sama":   {"kda": 5.59, "k": 5.2, "d": 1.9, "a": 5.5, "csm": 10.2, "dpm": 747},
    "Labrov":      {"kda": 3.93, "k": 1.0, "d": 3.2, "a": 11.7, "csm": 1.0, "dpm": 256},
    "Canna":       {"kda": 3.49, "k": 2.7, "d": 2.2, "a": 5.1, "csm": 8.8, "dpm": 639},
    "Yike":        {"kda": 3.97, "k": 3.9, "d": 2.7, "a": 6.7, "csm": 7.2, "dpm": 488},
    "kyeahoo":     {"kda": 4.08, "k": 2.9, "d": 2.1, "a": 5.9, "csm": 9.5, "dpm": 672},
    "Caliste":     {"kda": 5.93, "k": 4.6, "d": 1.6, "a": 4.9, "csm": 11.0, "dpm": 774},
    "Busio":       {"kda": 4.33, "k": 0.7, "d": 2.6, "a": 10.6, "csm": 1.0, "dpm": 201},
    "Myrwn":       {"kda": 2.99, "k": 2.2, "d": 2.5, "a": 5.1, "csm": 8.7, "dpm": 562},
    "Elyoya":      {"kda": 5.07, "k": 3.4, "d": 2.2, "a": 7.6, "csm": 7.2, "dpm": 471},
    "jojopyun":    {"kda": 2.85, "k": 3.0, "d": 3.3, "a": 6.4, "csm": 9.7, "dpm": 684},
    "Supa":        {"kda": 4.61, "k": 5.1, "d": 2.1, "a": 4.6, "csm": 10.4, "dpm": 849},
    "Alvaro":      {"kda": 3.46, "k": 0.8, "d": 3.1, "a": 10.0, "csm": 1.2, "dpm": 233},
    "Maynter":     {"kda": 2.86, "k": 1.9, "d": 2.9, "a": 6.3, "csm": 8.1, "dpm": 583},
    "Rhilech":     {"kda": 4.06, "k": 4.5, "d": 2.8, "a": 6.7, "csm": 7.4, "dpm": 502},
    "Poby":        {"kda": 3.67, "k": 3.3, "d": 2.5, "a": 6.0, "csm": 9.5, "dpm": 609},
    "SamD":        {"kda": 4.07, "k": 4.3, "d": 2.4, "a": 5.5, "csm": 10.7, "dpm": 764},
    "Parus":       {"kda": 3.70, "k": 0.6, "d": 3.0, "a": 10.6, "csm": 1.1, "dpm": 212},
    "Lot":         {"kda": 2.50, "k": 2.3, "d": 2.8, "a": 4.7, "csm": 8.7, "dpm": 511},
    "ISMA":        {"kda": 3.24, "k": 2.8, "d": 2.7, "a": 6.0, "csm": 7.1, "dpm": 404},
    "Jackies":     {"kda": 3.24, "k": 2.4, "d": 2.4, "a": 5.2, "csm": 9.8, "dpm": 663},
    "Noah":        {"kda": 3.54, "k": 3.7, "d": 2.4, "a": 4.7, "csm": 10.2, "dpm": 696},
    "Jun":         {"kda": 3.15, "k": 0.5, "d": 2.8, "a": 8.4, "csm": 1.1, "dpm": 206},
    "Tracyn":      {"kda": 3.16, "k": 2.1, "d": 2.1, "a": 4.5, "csm": 8.9, "dpm": 605},
    "Sheo":        {"kda": 3.14, "k": 2.5, "d": 2.8, "a": 6.3, "csm": 6.9, "dpm": 509},
    "Serin":       {"kda": 4.41, "k": 3.8, "d": 2.0, "a": 4.9, "csm": 8.8, "dpm": 673},
    "Ice":         {"kda": 3.47, "k": 3.6, "d": 2.3, "a": 4.5, "csm": 10.4, "dpm": 651},
    "Stend":       {"kda": 2.19, "k": 0.3, "d": 3.7, "a": 7.8, "csm": 1.1, "dpm": 146},
    "Empyros":     {"kda": 2.00, "k": 2.0, "d": 2.9, "a": 3.6, "csm": 8.7, "dpm": 569},
    "Razork":      {"kda": 2.05, "k": 2.0, "d": 4.0, "a": 6.2, "csm": 6.7, "dpm": 443},
    "Vladi":       {"kda": 2.98, "k": 2.5, "d": 2.8, "a": 5.7, "csm": 9.3, "dpm": 621},
    "Upset":       {"kda": 4.67, "k": 4.4, "d": 1.8, "a": 4.0, "csm": 10.4, "dpm": 719},
    "Lospa":       {"kda": 2.62, "k": 0.2, "d": 3.2, "a": 8.2, "csm": 1.0, "dpm": 148},
    "Wunder":      {"kda": 2.02, "k": 3.0, "d": 3.5, "a": 4.0, "csm": 8.6, "dpm": 685},
    "Skeanz":      {"kda": 2.52, "k": 2.6, "d": 3.3, "a": 5.6, "csm": 6.4, "dpm": 442},
    "Lider":       {"kda": 2.43, "k": 2.9, "d": 3.3, "a": 5.1, "csm": 9.5, "dpm": 631},
    "Jopa":        {"kda": 3.18, "k": 3.8, "d": 2.6, "a": 4.6, "csm": 10.3, "dpm": 793},
    "Mikyx":       {"kda": 1.74, "k": 0.4, "d": 5.1, "a": 8.5, "csm": 1.1, "dpm": 190},
    "Rooster":     {"kda": 3.00, "k": 3.1, "d": 2.5, "a": 4.5, "csm": 8.8, "dpm": 518},
    "Boukada":     {"kda": 3.18, "k": 1.7, "d": 3.1, "a": 8.1, "csm": 6.1, "dpm": 309},
    "nuc":         {"kda": 3.31, "k": 3.6, "d": 2.9, "a": 6.0, "csm": 8.9, "dpm": 581},
    "Paduck":      {"kda": 3.50, "k": 5.8, "d": 2.9, "a": 4.4, "csm": 9.8, "dpm": 820},
    "Trymbi":      {"kda": 2.91, "k": 0.5, "d": 4.2, "a": 11.7, "csm": 1.1, "dpm": 218},
    "Naak Nako":   {"kda": 2.65, "k": 3.2, "d": 3.0, "a": 4.7, "csm": 8.6, "dpm": 703},
    "Lyncas":      {"kda": 3.52, "k": 3.3, "d": 2.7, "a": 6.3, "csm": 6.8, "dpm": 469},
    "Humanoid":    {"kda": 2.45, "k": 3.0, "d": 3.5, "a": 5.5, "csm": 9.4, "dpm": 764},
    "Carzzy":      {"kda": 3.44, "k": 4.8, "d": 2.7, "a": 4.5, "csm": 9.7, "dpm": 906},
    "Fleshy":      {"kda": 3.73, "k": 0.8, "d": 2.9, "a": 9.9, "csm": 1.1, "dpm": 248},
}

# LEC Teams 2026 Data with Real Rosters
LEC_TEAMS = [
    {"id": "g2",  "name": "G2 Esports",    "abbr": "G2",   "country": "EU", "rating": 92, "budget": 5000000, "prestige": 95},
    {"id": "kc",  "name": "Karmine Corp",  "abbr": "KC",   "country": "FR", "rating": 90, "budget": 4200000, "prestige": 89},
    {"id": "navi","name": "Natus Vincere", "abbr": "NAVI", "country": "UA", "rating": 84, "budget": 3800000, "prestige": 82},
    {"id": "vit", "name": "Team Vitality", "abbr": "VIT",  "country": "FR", "rating": 85, "budget": 4200000, "prestige": 83},
    {"id": "koi", "name": "Movistar KOI",  "abbr": "KOI",  "country": "ES", "rating": 89, "budget": 3800000, "prestige": 85},
    {"id": "gx",  "name": "GIANTX",        "abbr": "GX",   "country": "ES", "rating": 86, "budget": 3200000, "prestige": 78},
    {"id": "bds", "name": "Shifters",      "abbr": "SFT",  "country": "FR", "rating": 81, "budget": 3200000, "prestige": 74},
    {"id": "th",  "name": "Team Heretics", "abbr": "TH",   "country": "ES", "rating": 81, "budget": 3400000, "prestige": 77},
    {"id": "fnc", "name": "Fnatic",        "abbr": "FNC",  "country": "EU", "rating": 82, "budget": 4500000, "prestige": 94},
    {"id": "sk",  "name": "SK Gaming",     "abbr": "SK",   "country": "DE", "rating": 77, "budget": 3000000, "prestige": 75}
]

# Real LEC 2026 Rosters (Starters only)
REAL_ROSTERS = {
    "fnc": {
        "TOP":     {"name": "Empyros",   "full_name": "Panagiotis Tantis",        "nationality": "GR", "age": 20, "rating": 78, "potential": 85},
        "JUNGLE":  {"name": "Razork",    "full_name": "Iván Martín Díaz",         "nationality": "ES", "age": 25, "rating": 83, "potential": 88},
        "MID":     {"name": "Vladi",     "full_name": "Vladimiros Kourtidis",     "nationality": "GR", "age": 22, "rating": 83, "potential": 90},
        "ADC":     {"name": "Upset",     "full_name": "Elias Lipp",               "nationality": "DE", "age": 26, "rating": 83, "potential": 92},
        "SUPPORT": {"name": "Lospa",     "full_name": "Park Joon-hyeong",         "nationality": "KR", "age": 23, "rating": 77, "potential": 88}
    },
    "g2": {
        "TOP":     {"name": "BrokenBlade","full_name": "Sergen Çelik",            "nationality": "DE", "age": 25, "rating": 86, "potential": 91},
        "JUNGLE":  {"name": "SkewMond",  "full_name": "Rudy Semaan",              "nationality": "LB", "age": 23, "rating": 89, "potential": 95},
        "MID":     {"name": "Caps",      "full_name": "Rasmus Borregaard Winther","nationality": "DK", "age": 26, "rating": 90, "potential": 95},
        "ADC":     {"name": "Hans Sama", "full_name": "Steven Liv",               "nationality": "FR", "age": 26, "rating": 87, "potential": 93},
        "SUPPORT": {"name": "Labrov",    "full_name": "Labros Papoutsakis",       "nationality": "GR", "age": 24, "rating": 86, "potential": 89}
    },
    "gx": {
        "TOP":     {"name": "Lot",       "full_name": "Eren Yıldız",              "nationality": "TR", "age": 22, "rating": 83, "potential": 88},
        "JUNGLE":  {"name": "ISMA",      "full_name": "Ismaïl Boualem",           "nationality": "FR", "age": 22, "rating": 84, "potential": 88},
        "MID":     {"name": "Jackies",   "full_name": "Adam Jeřábek",             "nationality": "CZ", "age": 21, "rating": 83, "potential": 89},
        "ADC":     {"name": "Noah",      "full_name": "Oh Hyeon-taek",            "nationality": "KR", "age": 23, "rating": 85, "potential": 89},
        "SUPPORT": {"name": "Jun",       "full_name": "Yoon Se-jun",              "nationality": "KR", "age": 25, "rating": 86, "potential": 85}
    },
    "kc": {
        "TOP":     {"name": "Canna",     "full_name": "Kim Chang-dong",           "nationality": "KR", "age": 25, "rating": 88, "potential": 90},
        "JUNGLE":  {"name": "Yike",      "full_name": "Martin Sundelin",          "nationality": "SE", "age": 23, "rating": 89, "potential": 90},
        "MID":     {"name": "kyeahoo",   "full_name": "Kang Ye-hoo",              "nationality": "KR", "age": 20, "rating": 87, "potential": 94},
        "ADC":     {"name": "Caliste",   "full_name": "Caliste Henry-Hennebert", "nationality": "FR", "age": 22, "rating": 88, "potential": 93},
        "SUPPORT": {"name": "Busio",     "full_name": "Alan Cwalina",             "nationality": "PL", "age": 21, "rating": 89, "potential": 91}
    },
    "koi": {
        "TOP":     {"name": "Myrwn",     "full_name": "Alex Villarejo",           "nationality": "ES", "age": 22, "rating": 83, "potential": 89},
        "JUNGLE":  {"name": "Elyoya",    "full_name": "Javier Prades Batalla",    "nationality": "ES", "age": 25, "rating": 89, "potential": 92},
        "MID":     {"name": "jojopyun",  "full_name": "Joon Pyun",               "nationality": "CA", "age": 22, "rating": 88, "potential": 92},
        "ADC":     {"name": "Supa",      "full_name": "David Martínez García",    "nationality": "ES", "age": 23, "rating": 86, "potential": 90},
        "SUPPORT": {"name": "Alvaro",    "full_name": "Álvaro Fernández del Amo", "nationality": "ES", "age": 23, "rating": 85, "potential": 88}
    },
    "navi": {
        "TOP":     {"name": "Maynter",   "full_name": "Volodymyr Sorokin",        "nationality": "UA", "age": 21, "rating": 83, "potential": 89},
        "JUNGLE":  {"name": "Rhilech",   "full_name": "Enes Uçan",               "nationality": "TR", "age": 22, "rating": 85, "potential": 89},
        "MID":     {"name": "Poby",      "full_name": "Yun Sung-won",             "nationality": "KR", "age": 22, "rating": 83, "potential": 90},
        "ADC":     {"name": "SamD",      "full_name": "Lee Jae-hoon",             "nationality": "KR", "age": 23, "rating": 84, "potential": 91},
        "SUPPORT": {"name": "Parus",     "full_name": "Polat Çiçek",              "nationality": "TR", "age": 24, "rating": 83, "potential": 87}
    },
    "sk": {
        "TOP":     {"name": "Wunder",    "full_name": "Martin Hansen",            "nationality": "DK", "age": 26, "rating": 78, "potential": 83},
        "JUNGLE":  {"name": "Skeanz",    "full_name": "Duncan Marquet",           "nationality": "FR", "age": 24, "rating": 79, "potential": 84},
        "MID":     {"name": "Lider",     "full_name": "Adam Ilyasov",             "nationality": "RU", "age": 24, "rating": 75, "potential": 84},
        "ADC":     {"name": "Jopa",      "full_name": "Josip Čančar",             "nationality": "HR", "age": 22, "rating": 80, "potential": 88},
        "SUPPORT": {"name": "Mikyx",     "full_name": "Mihael Mehle",             "nationality": "SI", "age": 27, "rating": 84, "potential": 88}
    },
    "bds": {
        "TOP":     {"name": "Rooster",   "full_name": "Shin Yun-hwan",            "nationality": "KR", "age": 22, "rating": 82, "potential": 89},
        "JUNGLE":  {"name": "Boukada",   "full_name": "Mehdi Lahlou",             "nationality": "FR", "age": 21, "rating": 78, "potential": 90},
        "MID":     {"name": "nuc",       "full_name": "Ilias Bizriken",           "nationality": "MA", "age": 23, "rating": 83, "potential": 89},
        "ADC":     {"name": "Paduck",    "full_name": "Park Seok-hyeon",          "nationality": "KR", "age": 21, "rating": 82, "potential": 92},
        "SUPPORT": {"name": "Trymbi",    "full_name": "Adrian Trybus",            "nationality": "PL", "age": 25, "rating": 80, "potential": 86}
    },
    "th": {
        "TOP":     {"name": "Tracyn",    "full_name": "Sebastian Wojtoń",         "nationality": "PL", "age": 21, "rating": 81, "potential": 89},
        "JUNGLE":  {"name": "Sheo",      "full_name": "Théo Borile",              "nationality": "FR", "age": 24, "rating": 83, "potential": 88},
        "MID":     {"name": "Serin",     "full_name": "Tolga Ölmez",              "nationality": "TR", "age": 21, "rating": 81, "potential": 92},
        "ADC":     {"name": "Ice",       "full_name": "Yoon Sang-hoon",           "nationality": "KR", "age": 22, "rating": 81, "potential": 90},
        "SUPPORT": {"name": "Stend",     "full_name": "Paul Lardin",              "nationality": "DE", "age": 23, "rating": 80, "potential": 86}
    },
    "vit": {
        "TOP":     {"name": "Naak Nako", "full_name": "Kaan Okan",               "nationality": "TR", "age": 22, "rating": 85, "potential": 90},
        "JUNGLE":  {"name": "Lyncas",    "full_name": "Linas Nauncikas",          "nationality": "LT", "age": 22, "rating": 84, "potential": 90},
        "MID":     {"name": "Humanoid",  "full_name": "Marek Brázda",             "nationality": "CZ", "age": 26, "rating": 85, "potential": 90},
        "ADC":     {"name": "Carzzy",    "full_name": "Matyáš Orság",             "nationality": "CZ", "age": 24, "rating": 83, "potential": 90},
        "SUPPORT": {"name": "Fleshy",    "full_name": "Kadir Kemiksiz",           "nationality": "TR", "age": 22, "rating": 82, "potential": 89}
    },
    # ── LCK 2026 (from OraclesElixir CSV) ───────────────────────────────────
    "t1": {
        "TOP":     {"name": "Doran",      "full_name": "Choi Hyeon-joon",  "nationality": "KR", "age": 24, "rating": 88, "potential": 91},
        "JUNGLE":  {"name": "Oner",       "full_name": "Moon Hyeon-joon",  "nationality": "KR", "age": 23, "rating": 89, "potential": 92},
        "MID":     {"name": "Faker",      "full_name": "Lee Sang-hyeok",   "nationality": "KR", "age": 28, "rating": 96, "potential": 96},
        "ADC":     {"name": "Peyz",       "full_name": "Kim Su-hwan",      "nationality": "KR", "age": 22, "rating": 87, "potential": 92},
        "SUPPORT": {"name": "Keria",      "full_name": "Ryu Min-seok",     "nationality": "KR", "age": 24, "rating": 93, "potential": 94},
    },
    "geng": {
        "TOP":     {"name": "Kiin",       "full_name": "Kim Gi-in",        "nationality": "KR", "age": 26, "rating": 90, "potential": 91},
        "JUNGLE":  {"name": "Canyon",     "full_name": "Kim Geon-bu",      "nationality": "KR", "age": 25, "rating": 94, "potential": 94},
        "MID":     {"name": "Chovy",      "full_name": "Jeong Ji-hoon",    "nationality": "KR", "age": 25, "rating": 95, "potential": 95},
        "ADC":     {"name": "Ruler",      "full_name": "Park Jae-hyuk",    "nationality": "KR", "age": 26, "rating": 91, "potential": 91},
        "SUPPORT": {"name": "Duro",       "full_name": "Kim Min-seok",     "nationality": "KR", "age": 21, "rating": 85, "potential": 91},
    },
    "hle": {
        "TOP":     {"name": "Zeus",       "full_name": "Choi Woo-je",      "nationality": "KR", "age": 23, "rating": 90, "potential": 93},
        "JUNGLE":  {"name": "Kanavi",     "full_name": "Seo Jin-hyeok",    "nationality": "KR", "age": 24, "rating": 91, "potential": 92},
        "MID":     {"name": "Zeka",       "full_name": "Kim Geon-woo",     "nationality": "KR", "age": 23, "rating": 87, "potential": 91},
        "ADC":     {"name": "Gumayusi",   "full_name": "Lee Min-hyeong",   "nationality": "KR", "age": 24, "rating": 88, "potential": 91},
        "SUPPORT": {"name": "Delight",    "full_name": "Yoo Hwan-joong",   "nationality": "KR", "age": 23, "rating": 86, "potential": 90},
    },
    "kt": {
        "TOP":     {"name": "PerfecT",    "full_name": "Park Jun-seo",     "nationality": "KR", "age": 20, "rating": 82, "potential": 90},
        "JUNGLE":  {"name": "Cuzz",       "full_name": "Moon Woo-chan",     "nationality": "KR", "age": 27, "rating": 83, "potential": 83},
        "MID":     {"name": "Bdd",        "full_name": "Gwak Bo-seong",    "nationality": "KR", "age": 28, "rating": 86, "potential": 86},
        "ADC":     {"name": "Aiming",     "full_name": "Kim Ha-ram",       "nationality": "KR", "age": 25, "rating": 84, "potential": 86},
        "SUPPORT": {"name": "Ghost",      "full_name": "Jang Yong-jun",    "nationality": "KR", "age": 27, "rating": 83, "potential": 83},
    },
    "dk": {
        "TOP":     {"name": "Siwoo",      "full_name": "Noh Si-woo",       "nationality": "KR", "age": 20, "rating": 79, "potential": 88},
        "JUNGLE":  {"name": "Lucid",      "full_name": "Son Woo-hyeon",    "nationality": "KR", "age": 22, "rating": 82, "potential": 88},
        "MID":     {"name": "ShowMaker",  "full_name": "Heo Su",           "nationality": "KR", "age": 25, "rating": 90, "potential": 91},
        "ADC":     {"name": "Smash",      "full_name": "Lee Min-jun",      "nationality": "KR", "age": 21, "rating": 79, "potential": 87},
        "SUPPORT": {"name": "Career",     "full_name": "Han Woo-seok",     "nationality": "KR", "age": 24, "rating": 80, "potential": 85},
    },
    "kdrx": {
        "TOP":     {"name": "Rich",       "full_name": "Kim Dong-won",     "nationality": "KR", "age": 25, "rating": 82, "potential": 84},
        "JUNGLE":  {"name": "Willer",     "full_name": "Jung June-hwan",   "nationality": "KR", "age": 22, "rating": 79, "potential": 86},
        "MID":     {"name": "Ucal",       "full_name": "Son Woo-hyeon",    "nationality": "KR", "age": 24, "rating": 80, "potential": 84},
        "ADC":     {"name": "Jiwoo",      "full_name": "Kim Ji-woo",       "nationality": "KR", "age": 21, "rating": 77, "potential": 86},
        "SUPPORT": {"name": "Andil",      "full_name": "Ahn Sang-bum",     "nationality": "KR", "age": 22, "rating": 79, "potential": 85},
    },
    "ns": {
        "TOP":     {"name": "Kingen",     "full_name": "Hwang Seong-hoon", "nationality": "KR", "age": 26, "rating": 81, "potential": 84},
        "JUNGLE":  {"name": "Sponge",     "full_name": "Kim Sang-min",     "nationality": "KR", "age": 22, "rating": 78, "potential": 85},
        "MID":     {"name": "Scout",      "full_name": "Lee Ye-chan",       "nationality": "KR", "age": 27, "rating": 85, "potential": 85},
        "ADC":     {"name": "Taeyoon",    "full_name": "Kim Tae-yoon",     "nationality": "KR", "age": 21, "rating": 76, "potential": 85},
        "SUPPORT": {"name": "Lehends",    "full_name": "Son Si-woo",       "nationality": "KR", "age": 25, "rating": 86, "potential": 87},
    },
    "bnk": {
        "TOP":     {"name": "Clear",      "full_name": "Choi Woo-jin",     "nationality": "KR", "age": 22, "rating": 80, "potential": 87},
        "JUNGLE":  {"name": "Raptor",     "full_name": "Lee Dong-hyun",    "nationality": "KR", "age": 21, "rating": 79, "potential": 87},
        "MID":     {"name": "VicLa",      "full_name": "Kim Dong-min",     "nationality": "KR", "age": 24, "rating": 82, "potential": 85},
        "ADC":     {"name": "Diable",     "full_name": "Cho Hyun-jae",     "nationality": "KR", "age": 22, "rating": 79, "potential": 86},
        "SUPPORT": {"name": "Kellin",     "full_name": "Song Hyeon-seo",   "nationality": "KR", "age": 23, "rating": 81, "potential": 85},
    },
    "brion": {
        "TOP":     {"name": "Casting",    "full_name": "Kim Jong-min",     "nationality": "KR", "age": 21, "rating": 72, "potential": 84},
        "JUNGLE":  {"name": "GIDEON",     "full_name": "Hwang Gideon",     "nationality": "KR", "age": 22, "rating": 73, "potential": 83},
        "MID":     {"name": "Roamer",     "full_name": "Jung Dae-won",     "nationality": "KR", "age": 20, "rating": 71, "potential": 85},
        "ADC":     {"name": "Teddy",      "full_name": "Park Jin-seong",   "nationality": "KR", "age": 26, "rating": 79, "potential": 79},
        "SUPPORT": {"name": "Namgung",    "full_name": "Namgung Yeong",    "nationality": "KR", "age": 23, "rating": 72, "potential": 82},
    },
    "dns": {
        "TOP":     {"name": "DuDu",       "full_name": "Bae Hyeon-jun",    "nationality": "KR", "age": 23, "rating": 83, "potential": 88},
        "JUNGLE":  {"name": "Pyosik",     "full_name": "Hong Chang-hyeon", "nationality": "KR", "age": 24, "rating": 80, "potential": 84},
        "MID":     {"name": "Clozer",     "full_name": "Choi Jin-sol",     "nationality": "KR", "age": 22, "rating": 81, "potential": 88},
        "ADC":     {"name": "deokdam",    "full_name": "Kim Deok-dam",     "nationality": "KR", "age": 23, "rating": 79, "potential": 84},
        "SUPPORT": {"name": "Peter",      "full_name": "Oh Hyeon-seon",    "nationality": "KR", "age": 22, "rating": 76, "potential": 84},
    },
    # ── LPL 2026 (from OraclesElixir CSV) ───────────────────────────────────
    "blg": {
        "TOP":     {"name": "Bin",        "full_name": "Chen Ze-Bin",      "nationality": "CN", "age": 24, "rating": 92, "potential": 93},
        "JUNGLE":  {"name": "Xun",        "full_name": "Xiu Hong-Jun",     "nationality": "CN", "age": 23, "rating": 90, "potential": 92},
        "MID":     {"name": "Knight",     "full_name": "Zhuo Ding",        "nationality": "CN", "age": 24, "rating": 94, "potential": 94},
        "ADC":     {"name": "Viper",      "full_name": "Park Do-hyeon",    "nationality": "KR", "age": 25, "rating": 91, "potential": 91},
        "SUPPORT": {"name": "ON",         "full_name": "Park Hyeon-oh",    "nationality": "KR", "age": 24, "rating": 89, "potential": 90},
    },
    "lng": {
        "TOP":     {"name": "sheer",      "full_name": "Xie Shijun",       "nationality": "CN", "age": 21, "rating": 86, "potential": 91},
        "JUNGLE":  {"name": "Croco",      "full_name": "Park Jong-hun",    "nationality": "KR", "age": 23, "rating": 88, "potential": 90},
        "MID":     {"name": "BuLLDoG",    "full_name": "Yun Geon-min",     "nationality": "KR", "age": 22, "rating": 87, "potential": 91},
        "ADC":     {"name": "1xn",        "full_name": "Yang Bing-nan",    "nationality": "CN", "age": 20, "rating": 84, "potential": 90},
        "SUPPORT": {"name": "MISSING",    "full_name": "Chen Zifeng",      "nationality": "CN", "age": 24, "rating": 87, "potential": 88},
    },
    "al": {
        "TOP":     {"name": "Flandre",    "full_name": "Lin Rui-Xiang",    "nationality": "CN", "age": 26, "rating": 87, "potential": 88},
        "JUNGLE":  {"name": "Tarzan",     "full_name": "Lee Seung-yong",   "nationality": "KR", "age": 26, "rating": 89, "potential": 89},
        "MID":     {"name": "Shanks",     "full_name": "Zhang Min-Jie",    "nationality": "CN", "age": 23, "rating": 86, "potential": 89},
        "ADC":     {"name": "Hope",       "full_name": "Yan Rui-Jie",      "nationality": "CN", "age": 22, "rating": 85, "potential": 88},
        "SUPPORT": {"name": "Kael",       "full_name": "Jung Jin-hyeong",  "nationality": "KR", "age": 25, "rating": 84, "potential": 86},
    },
    "nip": {
        "TOP":     {"name": "HOYA",       "full_name": "Kim Kang-min",     "nationality": "KR", "age": 21, "rating": 82, "potential": 88},
        "JUNGLE":  {"name": "Guwon",      "full_name": "Kim Gu-won",       "nationality": "KR", "age": 22, "rating": 83, "potential": 87},
        "MID":     {"name": "Care",       "full_name": "Park Jung-soo",    "nationality": "KR", "age": 23, "rating": 83, "potential": 87},
        "ADC":     {"name": "Assum",      "full_name": "Gao Jia-Xin",     "nationality": "CN", "age": 21, "rating": 80, "potential": 86},
        "SUPPORT": {"name": "Zhuo",       "full_name": "Zhuo Yi",          "nationality": "CN", "age": 23, "rating": 81, "potential": 84},
    },
    "edg": {
        "TOP":     {"name": "Zdz",        "full_name": "Liu Zi-Dong",      "nationality": "CN", "age": 20, "rating": 80, "potential": 89},
        "JUNGLE":  {"name": "Xiaohao",    "full_name": "Zeng Xiao-Hao",   "nationality": "CN", "age": 22, "rating": 82, "potential": 87},
        "MID":     {"name": "Angel",      "full_name": "Jiang Ha-bin",     "nationality": "CN", "age": 23, "rating": 84, "potential": 88},
        "ADC":     {"name": "Leave",      "full_name": "Liu Zhi-Wen",     "nationality": "CN", "age": 21, "rating": 81, "potential": 88},
        "SUPPORT": {"name": "Parukia",    "full_name": "Won Seong-jin",    "nationality": "KR", "age": 23, "rating": 82, "potential": 86},
    },
    "jdg": {
        "TOP":     {"name": "Xiaoxu",     "full_name": "Sun Xiao-Xu",      "nationality": "CN", "age": 22, "rating": 81, "potential": 88},
        "JUNGLE":  {"name": "JunJia",     "full_name": "Li Jun-Jia",       "nationality": "CN", "age": 21, "rating": 80, "potential": 87},
        "MID":     {"name": "HongQ",      "full_name": "Yue Hong-Qi",      "nationality": "CN", "age": 22, "rating": 81, "potential": 88},
        "ADC":     {"name": "GALA",       "full_name": "Chen Wei",          "nationality": "CN", "age": 23, "rating": 85, "potential": 87},
        "SUPPORT": {"name": "Vampire",    "full_name": "Wang Zi-Hao",      "nationality": "CN", "age": 22, "rating": 80, "potential": 85},
    },
    "weibo": {
        "TOP":     {"name": "Zika",       "full_name": "Wu Di",            "nationality": "CN", "age": 23, "rating": 81, "potential": 86},
        "JUNGLE":  {"name": "Jiejie",     "full_name": "Lee Hyun-jun",     "nationality": "KR", "age": 24, "rating": 84, "potential": 86},
        "MID":     {"name": "Xiaohu",     "full_name": "Li Yuan-Hao",      "nationality": "CN", "age": 26, "rating": 83, "potential": 83},
        "ADC":     {"name": "Elk",        "full_name": "He Yu-Ze",         "nationality": "CN", "age": 23, "rating": 86, "potential": 88},
        "SUPPORT": {"name": "Erha",       "full_name": "Ye Xiao-An",      "nationality": "CN", "age": 21, "rating": 79, "potential": 86},
    },
    "tes": {
        "TOP":     {"name": "369",        "full_name": "Bai Jia-hao",      "nationality": "CN", "age": 25, "rating": 89, "potential": 90},
        "JUNGLE":  {"name": "naiyou",     "full_name": "Ye Nai-You",       "nationality": "CN", "age": 21, "rating": 82, "potential": 89},
        "MID":     {"name": "Creme",      "full_name": "Kim Dong-woo",     "nationality": "KR", "age": 22, "rating": 83, "potential": 89},
        "ADC":     {"name": "JiaQi",      "full_name": "Bai Jia-Qi",      "nationality": "CN", "age": 20, "rating": 80, "potential": 88},
        "SUPPORT": {"name": "fengyue",    "full_name": "Liu Feng-Yue",     "nationality": "CN", "age": 22, "rating": 80, "potential": 85},
    },
    "lgd": {
        "TOP":     {"name": "sasi",       "full_name": "Xiao Sa-Si",       "nationality": "CN", "age": 21, "rating": 75, "potential": 84},
        "JUNGLE":  {"name": "Heng",       "full_name": "Huang Heng",       "nationality": "CN", "age": 22, "rating": 76, "potential": 84},
        "MID":     {"name": "Tangyuan",   "full_name": "Tang Yuan",        "nationality": "CN", "age": 21, "rating": 75, "potential": 84},
        "ADC":     {"name": "Shaoye",     "full_name": "Xu Shao-Ye",      "nationality": "CN", "age": 20, "rating": 73, "potential": 85},
        "SUPPORT": {"name": "Ycx",        "full_name": "Yu Chen-Xing",     "nationality": "CN", "age": 21, "rating": 74, "potential": 83},
    },
    "we": {
        "TOP":     {"name": "Cube",       "full_name": "Chen Yue-Bao",     "nationality": "CN", "age": 23, "rating": 77, "potential": 83},
        "JUNGLE":  {"name": "Monki",      "full_name": "Cai Meng-Qi",      "nationality": "CN", "age": 22, "rating": 76, "potential": 84},
        "MID":     {"name": "Karis",      "full_name": "Kim Kil-ho",       "nationality": "KR", "age": 24, "rating": 78, "potential": 83},
        "ADC":     {"name": "About",      "full_name": "Liu Chen",          "nationality": "CN", "age": 21, "rating": 75, "potential": 84},
        "SUPPORT": {"name": "yaoyao",     "full_name": "Yao Jia-Hao",      "nationality": "CN", "age": 22, "rating": 77, "potential": 84},
    },
    "omg": {
        "TOP":     {"name": "Hery",       "full_name": "He Rui-Yang",      "nationality": "CN", "age": 21, "rating": 74, "potential": 85},
        "JUNGLE":  {"name": "re0",        "full_name": "Liu Zhen-Rui",     "nationality": "CN", "age": 20, "rating": 73, "potential": 86},
        "MID":     {"name": "haichao",    "full_name": "Wu Hai-Chao",      "nationality": "CN", "age": 21, "rating": 74, "potential": 86},
        "ADC":     {"name": "Starry",     "full_name": "Liu Xing-Hua",     "nationality": "CN", "age": 22, "rating": 75, "potential": 85},
        "SUPPORT": {"name": "Moham",      "full_name": "Mo Han",           "nationality": "CN", "age": 22, "rating": 74, "potential": 84},
    },
    "ig": {
        "TOP":     {"name": "Soboro",     "full_name": "Kim Min-soo",      "nationality": "KR", "age": 23, "rating": 73, "potential": 82},
        "JUNGLE":  {"name": "Wei",        "full_name": "Tang Wei-Ming",    "nationality": "CN", "age": 23, "rating": 74, "potential": 83},
        "MID":     {"name": "Rookie",     "full_name": "Song Eui-jin",     "nationality": "KR", "age": 28, "rating": 82, "potential": 82},
        "ADC":     {"name": "Photic",     "full_name": "Zheng Bao-Xuan",  "nationality": "CN", "age": 21, "rating": 71, "potential": 84},
        "SUPPORT": {"name": "Jwei",       "full_name": "Jiang Wei",        "nationality": "CN", "age": 22, "rating": 72, "potential": 82},
    },
    "up": {
        "TOP":     {"name": "Liangchen",  "full_name": "Guo Liang-Chen",   "nationality": "CN", "age": 20, "rating": 68, "potential": 83},
        "JUNGLE":  {"name": "Grizzly",    "full_name": "Nie Jia-Jun",      "nationality": "CN", "age": 21, "rating": 67, "potential": 82},
        "MID":     {"name": "Saber",      "full_name": "Han Yi",           "nationality": "CN", "age": 22, "rating": 69, "potential": 83},
        "ADC":     {"name": "Hena",       "full_name": "Huang He-Na",      "nationality": "CN", "age": 20, "rating": 66, "potential": 83},
        "SUPPORT": {"name": "Xiaoxia",    "full_name": "Liu Xiao-Xia",     "nationality": "CN", "age": 21, "rating": 67, "potential": 82},
    },
    "tt": {
        "TOP":     {"name": "Keshi",      "full_name": "Liu Ke-Shi",       "nationality": "CN", "age": 21, "rating": 63, "potential": 80},
        "JUNGLE":  {"name": "Junhao",     "full_name": "Zhang Jun-Hao",    "nationality": "CN", "age": 20, "rating": 62, "potential": 80},
        "MID":     {"name": "Heru",       "full_name": "Liu He-Ru",        "nationality": "CN", "age": 22, "rating": 63, "potential": 79},
        "ADC":     {"name": "Ryan3",      "full_name": "Zheng Kai",        "nationality": "CN", "age": 21, "rating": 62, "potential": 80},
        "SUPPORT": {"name": "Feather",    "full_name": "Fang Fei",         "nationality": "CN", "age": 22, "rating": 63, "potential": 79},
    },
    # ── LCS 2026 (from OraclesElixir CSV) ───────────────────────────────────
    "c9": {
        "TOP":     {"name": "Thanatos",   "full_name": "Marcus Aurelio",   "nationality": "BR", "age": 24, "rating": 82, "potential": 87},
        "JUNGLE":  {"name": "Blaber",     "full_name": "Robert Huang",     "nationality": "US", "age": 24, "rating": 85, "potential": 86},
        "MID":     {"name": "APA",        "full_name": "Ahmad Karimi",     "nationality": "US", "age": 22, "rating": 83, "potential": 89},
        "ADC":     {"name": "Zven",       "full_name": "Jesper Svenningsen","nationality": "DK","age": 28, "rating": 82, "potential": 82},
        "SUPPORT": {"name": "Vulcan",     "full_name": "Zaqueri Black",    "nationality": "US", "age": 26, "rating": 83, "potential": 84},
    },
    "lyon": {
        "TOP":     {"name": "Dhokla",     "full_name": "Omar Maly",        "nationality": "US", "age": 25, "rating": 80, "potential": 83},
        "JUNGLE":  {"name": "Inspired",   "full_name": "Kacper Sloma",     "nationality": "PL", "age": 24, "rating": 86, "potential": 88},
        "MID":     {"name": "Saint",      "full_name": "Kim Hyuk-jun",     "nationality": "KR", "age": 23, "rating": 83, "potential": 87},
        "ADC":     {"name": "Berserker",  "full_name": "Choi Jin-ho",      "nationality": "KR", "age": 23, "rating": 87, "potential": 89},
        "SUPPORT": {"name": "Isles",      "full_name": "Tyler Stover",     "nationality": "US", "age": 22, "rating": 79, "potential": 84},
    },
    "tl": {
        "TOP":     {"name": "Morgan",     "full_name": "Park Gi-in",       "nationality": "KR", "age": 26, "rating": 81, "potential": 83},
        "JUNGLE":  {"name": "Josedeodo",  "full_name": "Jose Gamboa",      "nationality": "CO", "age": 23, "rating": 82, "potential": 85},
        "MID":     {"name": "Quid",       "full_name": "Kevin Zhu",        "nationality": "US", "age": 21, "rating": 79, "potential": 87},
        "ADC":     {"name": "Yeon",       "full_name": "Jung Ji-in",       "nationality": "KR", "age": 23, "rating": 81, "potential": 86},
        "SUPPORT": {"name": "CoreJJ",     "full_name": "Jo Yong-in",       "nationality": "KR", "age": 30, "rating": 88, "potential": 86},
    },
    "sen": {
        "TOP":     {"name": "Impact",     "full_name": "Jung Eon-yeong",   "nationality": "KR", "age": 30, "rating": 80, "potential": 80},
        "JUNGLE":  {"name": "HamBak",     "full_name": "Kim Min-seok",     "nationality": "KR", "age": 22, "rating": 79, "potential": 86},
        "MID":     {"name": "DARKWINGS",  "full_name": "Jun Morera",       "nationality": "US", "age": 21, "rating": 77, "potential": 86},
        "ADC":     {"name": "Rahel",      "full_name": "Rahel Neda",       "nationality": "US", "age": 22, "rating": 77, "potential": 85},
        "SUPPORT": {"name": "huhi",       "full_name": "Choi Jae-hyun",    "nationality": "KR", "age": 28, "rating": 80, "potential": 80},
    },
    "dsg": {
        "TOP":     {"name": "Castle",     "full_name": "Cody Jaber",       "nationality": "US", "age": 23, "rating": 74, "potential": 83},
        "JUNGLE":  {"name": "KryRa",      "full_name": "Kai Braun",        "nationality": "DE", "age": 22, "rating": 75, "potential": 84},
        "MID":     {"name": "Callme",     "full_name": "Son Ho-song",      "nationality": "KR", "age": 25, "rating": 77, "potential": 82},
        "ADC":     {"name": "sajed",      "full_name": "Elie Khafif",      "nationality": "FR", "age": 22, "rating": 74, "potential": 84},
        "SUPPORT": {"name": "Lyonz",      "full_name": "Leon Gellert",     "nationality": "DE", "age": 24, "rating": 74, "potential": 82},
    },
    "fly": {
        "TOP":     {"name": "Gakgos",     "full_name": "Sergi Guillamón",  "nationality": "ES", "age": 23, "rating": 75, "potential": 83},
        "JUNGLE":  {"name": "Gryffinn",   "full_name": "Tyler Camarena",   "nationality": "US", "age": 22, "rating": 74, "potential": 83},
        "MID":     {"name": "Quad",       "full_name": "Quentin Sauné",    "nationality": "FR", "age": 22, "rating": 75, "potential": 83},
        "ADC":     {"name": "Massu",      "full_name": "Mads Agersø",      "nationality": "DK", "age": 22, "rating": 74, "potential": 83},
        "SUPPORT": {"name": "Cryogen",    "full_name": "William Berry",    "nationality": "US", "age": 22, "rating": 73, "potential": 82},
    },
    "dig": {
        "TOP":     {"name": "Photon",     "full_name": "Choi Hyun-jin",    "nationality": "KR", "age": 22, "rating": 73, "potential": 85},
        "JUNGLE":  {"name": "eXyu",       "full_name": "Mirko Jurković",   "nationality": "HR", "age": 23, "rating": 72, "potential": 83},
        "MID":     {"name": "Palafox",    "full_name": "Chris Palafox",    "nationality": "US", "age": 25, "rating": 75, "potential": 82},
        "ADC":     {"name": "FBI",        "full_name": "Victor Huang",     "nationality": "AU", "age": 26, "rating": 77, "potential": 80},
        "SUPPORT": {"name": "Ignar",      "full_name": "Kim Ye-jun",       "nationality": "KR", "age": 27, "rating": 76, "potential": 78},
    },
    "sr": {
        "TOP":     {"name": "Fudge",      "full_name": "Ibrahim Allami",   "nationality": "AU", "age": 24, "rating": 80, "potential": 85},
        "JUNGLE":  {"name": "Contractz",  "full_name": "Juan Arturo",      "nationality": "US", "age": 25, "rating": 75, "potential": 80},
        "MID":     {"name": "Zinie",      "full_name": "Noah Granquist",   "nationality": "SE", "age": 22, "rating": 72, "potential": 83},
        "ADC":     {"name": "Bvoy",       "full_name": "Berkay Kilic",     "nationality": "TR", "age": 23, "rating": 73, "potential": 82},
        "SUPPORT": {"name": "Ceos",       "full_name": "Mateusz Obłoza",   "nationality": "PL", "age": 23, "rating": 72, "potential": 82},
    },
    # ── CBLOL 2026 (from OraclesElixir CSV) ─────────────────────────────────
    "loud": {
        "TOP":     {"name": "xyno",       "full_name": "Alex Carneiro",    "nationality": "BR", "age": 22, "rating": 84, "potential": 88},
        "JUNGLE":  {"name": "YoungJae",   "full_name": "Kim Young-jae",    "nationality": "KR", "age": 22, "rating": 83, "potential": 87},
        "MID":     {"name": "Mago",       "full_name": "Gabriel Lopes",    "nationality": "BR", "age": 23, "rating": 85, "potential": 88},
        "ADC":     {"name": "Bull",       "full_name": "Gabriel Bulatoni", "nationality": "BR", "age": 21, "rating": 82, "potential": 87},
        "SUPPORT": {"name": "RedBert",    "full_name": "Lukas Rocha",      "nationality": "BR", "age": 23, "rating": 81, "potential": 85},
    },
    "furia": {
        "TOP":     {"name": "Guigo",      "full_name": "Guilherme Ruback", "nationality": "BR", "age": 24, "rating": 83, "potential": 87},
        "JUNGLE":  {"name": "Tatu",       "full_name": "Arthur Machado",   "nationality": "BR", "age": 23, "rating": 82, "potential": 86},
        "MID":     {"name": "Tutsz",      "full_name": "Tutsz Cunha",      "nationality": "BR", "age": 22, "rating": 83, "potential": 87},
        "ADC":     {"name": "Ayu",        "full_name": "Ayu Ferreira",     "nationality": "BR", "age": 21, "rating": 80, "potential": 86},
        "SUPPORT": {"name": "JoJo",       "full_name": "Joao Oliveira",    "nationality": "BR", "age": 22, "rating": 81, "potential": 85},
    },
    "red": {
        "TOP":     {"name": "fNb",        "full_name": "Gabriel Inacio",   "nationality": "BR", "age": 25, "rating": 82, "potential": 84},
        "JUNGLE":  {"name": "Curse",      "full_name": "Vitor Santos",     "nationality": "BR", "age": 22, "rating": 81, "potential": 86},
        "MID":     {"name": "Kaze",       "full_name": "Bernardo Gomes",   "nationality": "BR", "age": 23, "rating": 83, "potential": 87},
        "ADC":     {"name": "Rabelo",     "full_name": "Pedro Rabelo",     "nationality": "BR", "age": 22, "rating": 81, "potential": 85},
        "SUPPORT": {"name": "frosty",     "full_name": "Gabriel Nascimento","nationality": "BR","age": 22, "rating": 80, "potential": 84},
    },
    "les": {
        "TOP":     {"name": "Zest",       "full_name": "Jeong Won-suk",    "nationality": "KR", "age": 24, "rating": 81, "potential": 85},
        "JUNGLE":  {"name": "Drakehero",  "full_name": "Gilberto Queiroz", "nationality": "BR", "age": 22, "rating": 79, "potential": 85},
        "MID":     {"name": "Feisty",     "full_name": "Feisty Ribeiro",   "nationality": "BR", "age": 23, "rating": 80, "potential": 85},
        "ADC":     {"name": "Duduhh",     "full_name": "Eduardo Rocha",    "nationality": "BR", "age": 21, "rating": 78, "potential": 85},
        "SUPPORT": {"name": "Ackerman",   "full_name": "Nicolas Ackerman", "nationality": "BR", "age": 22, "rating": 79, "potential": 84},
    },
    "vks": {
        "TOP":     {"name": "Boal",       "full_name": "Boal da Silva",    "nationality": "BR", "age": 23, "rating": 76, "potential": 83},
        "JUNGLE":  {"name": "Disamis",    "full_name": "Disamis Santos",   "nationality": "BR", "age": 22, "rating": 75, "potential": 83},
        "MID":     {"name": "Mireu",      "full_name": "Ha Yong-hoon",     "nationality": "KR", "age": 24, "rating": 78, "potential": 84},
        "ADC":     {"name": "Morttheus",  "full_name": "Matheus Rocha",    "nationality": "BR", "age": 22, "rating": 75, "potential": 83},
        "SUPPORT": {"name": "Kaiwing",    "full_name": "Kang Kai-wing",    "nationality": "HK", "age": 25, "rating": 78, "potential": 82},
    },
    "lev": {
        "TOP":     {"name": "Devost",     "full_name": "Devost Morales",   "nationality": "CL", "age": 23, "rating": 74, "potential": 82},
        "JUNGLE":  {"name": "Booki",      "full_name": "Andres Booki",     "nationality": "CL", "age": 22, "rating": 73, "potential": 82},
        "MID":     {"name": "Enga",       "full_name": "Enga Castro",      "nationality": "CL", "age": 22, "rating": 74, "potential": 82},
        "ADC":     {"name": "ceo",        "full_name": "Mario Torres",     "nationality": "CL", "age": 21, "rating": 72, "potential": 82},
        "SUPPORT": {"name": "TopLop",     "full_name": "Topazio Lopes",    "nationality": "BR", "age": 23, "rating": 72, "potential": 81},
    },
    "fluxo": {
        "TOP":     {"name": "curty",      "full_name": "Curtio Pereira",   "nationality": "BR", "age": 22, "rating": 72, "potential": 83},
        "JUNGLE":  {"name": "Peach",      "full_name": "Ruan Peach",       "nationality": "BR", "age": 21, "rating": 71, "potential": 83},
        "MID":     {"name": "Hauz",       "full_name": "Hauz Carvalho",    "nationality": "BR", "age": 23, "rating": 72, "potential": 83},
        "ADC":     {"name": "BAO",        "full_name": "Bao Doan",         "nationality": "BR", "age": 22, "rating": 71, "potential": 82},
        "SUPPORT": {"name": "ProDelta",   "full_name": "ProDelta Gomes",   "nationality": "BR", "age": 22, "rating": 71, "potential": 81},
    },
    "pain": {
        "TOP":     {"name": "Robo",       "full_name": "Matheus Weber",    "nationality": "BR", "age": 25, "rating": 76, "potential": 83},
        "JUNGLE":  {"name": "CarioK",     "full_name": "Cario Karim",      "nationality": "BR", "age": 22, "rating": 72, "potential": 83},
        "MID":     {"name": "tinowns",    "full_name": "Thiago Sartori",   "nationality": "BR", "age": 27, "rating": 79, "potential": 80},
        "ADC":     {"name": "Trigger",    "full_name": "Rodrigo Sousa",    "nationality": "BR", "age": 22, "rating": 70, "potential": 82},
        "SUPPORT": {"name": "Kuri",       "full_name": "Kim Jeong-su",     "nationality": "KR", "age": 25, "rating": 73, "potential": 77},
    },
}

# ── Multi-League Team Definitions ─────────────────────────────────────────────

LCK_TEAMS = [
    {"id": "geng",  "name": "Gen.G",             "abbr": "GEN",  "country": "KR", "rating": 95, "budget": 6000000, "prestige": 97},
    {"id": "t1",    "name": "T1",                "abbr": "T1",   "country": "KR", "rating": 90, "budget": 6500000, "prestige": 99},
    {"id": "bnk",   "name": "BNK FEARX",         "abbr": "BNK",  "country": "KR", "rating": 83, "budget": 3200000, "prestige": 76},
    {"id": "dk",    "name": "Dplus Kia",         "abbr": "DK",   "country": "KR", "rating": 82, "budget": 4000000, "prestige": 87},
    {"id": "dns",   "name": "DN SOOPers",        "abbr": "DNS",  "country": "KR", "rating": 81, "budget": 3500000, "prestige": 79},
    {"id": "kt",    "name": "KT Rolster",        "abbr": "KT",   "country": "KR", "rating": 80, "budget": 4200000, "prestige": 90},
    {"id": "hle",   "name": "Hanwha Life",       "abbr": "HLE",  "country": "KR", "rating": 79, "budget": 4800000, "prestige": 88},
    {"id": "ns",    "name": "Nongshim RedForce", "abbr": "NS",   "country": "KR", "rating": 78, "budget": 3200000, "prestige": 77},
    {"id": "kdrx",  "name": "Kiwoom DRX",        "abbr": "DRX",  "country": "KR", "rating": 78, "budget": 3800000, "prestige": 84},
    {"id": "brion", "name": "HANJIN BRION",      "abbr": "BRN",  "country": "KR", "rating": 74, "budget": 2800000, "prestige": 72},
]

LPL_TEAMS = [
    {"id": "blg",   "name": "Bilibili Gaming",  "abbr": "BLG",  "country": "CN", "rating": 94, "budget": 6000000, "prestige": 94},
    {"id": "lng",   "name": "LNG Esports",      "abbr": "LNG",  "country": "CN", "rating": 91, "budget": 5000000, "prestige": 88},
    {"id": "al",    "name": "Anyone's Legend",  "abbr": "AL",   "country": "CN", "rating": 89, "budget": 4200000, "prestige": 82},
    {"id": "nip",   "name": "Ninjas in Pyjamas","abbr": "NIP",  "country": "CN", "rating": 84, "budget": 4000000, "prestige": 83},
    {"id": "edg",   "name": "EDward Gaming",    "abbr": "EDG",  "country": "CN", "rating": 83, "budget": 5200000, "prestige": 92},
    {"id": "jdg",   "name": "JD Gaming",        "abbr": "JDG",  "country": "CN", "rating": 82, "budget": 5500000, "prestige": 95},
    {"id": "weibo", "name": "Weibo Gaming",     "abbr": "WBG",  "country": "CN", "rating": 82, "budget": 4800000, "prestige": 90},
    {"id": "tes",   "name": "Top Esports",      "abbr": "TES",  "country": "CN", "rating": 81, "budget": 5000000, "prestige": 91},
    {"id": "lgd",   "name": "LGD Gaming",       "abbr": "LGD",  "country": "CN", "rating": 79, "budget": 3000000, "prestige": 78},
    {"id": "we",    "name": "Team WE",          "abbr": "WE",   "country": "CN", "rating": 79, "budget": 3200000, "prestige": 82},
    {"id": "omg",   "name": "Oh My God",        "abbr": "OMG",  "country": "CN", "rating": 77, "budget": 3500000, "prestige": 80},
    {"id": "ig",    "name": "Invictus Gaming",  "abbr": "IG",   "country": "CN", "rating": 74, "budget": 4500000, "prestige": 93},
    {"id": "up",    "name": "Ultra Prime",      "abbr": "UP",   "country": "CN", "rating": 70, "budget": 2800000, "prestige": 72},
    {"id": "tt",    "name": "ThunderTalk Gaming","abbr": "TT",  "country": "CN", "rating": 65, "budget": 2500000, "prestige": 68},
]

LCS_TEAMS = [
    {"id": "c9",   "name": "Cloud9",            "abbr": "C9",   "country": "US", "rating": 88, "budget": 5500000, "prestige": 93},
    {"id": "lyon", "name": "LYON",              "abbr": "LYN",  "country": "US", "rating": 86, "budget": 4000000, "prestige": 79},
    {"id": "tl",   "name": "Team Liquid",       "abbr": "TL",   "country": "US", "rating": 81, "budget": 4800000, "prestige": 90},
    {"id": "sen",  "name": "Sentinels",         "abbr": "SEN",  "country": "US", "rating": 78, "budget": 4200000, "prestige": 85},
    {"id": "dsg",  "name": "Disguised",         "abbr": "DSG",  "country": "US", "rating": 76, "budget": 3500000, "prestige": 76},
    {"id": "fly",  "name": "FlyQuest",          "abbr": "FLY",  "country": "US", "rating": 74, "budget": 3800000, "prestige": 82},
    {"id": "dig",  "name": "Dignitas",          "abbr": "DIG",  "country": "US", "rating": 71, "budget": 3000000, "prestige": 77},
    {"id": "sr",   "name": "Shopify Rebellion", "abbr": "SR",   "country": "US", "rating": 65, "budget": 3200000, "prestige": 74},
]

CBLOL_TEAMS = [
    {"id": "loud",  "name": "LOUD",             "abbr": "LOUD", "country": "BR", "rating": 88, "budget": 3000000, "prestige": 90},
    {"id": "furia", "name": "FURIA",            "abbr": "FUR",  "country": "BR", "rating": 87, "budget": 2800000, "prestige": 87},
    {"id": "red",   "name": "RED Canids",       "abbr": "RED",  "country": "BR", "rating": 86, "budget": 2500000, "prestige": 86},
    {"id": "les",   "name": "LÉS",              "abbr": "LÉS",  "country": "BR", "rating": 85, "budget": 2300000, "prestige": 82},
    {"id": "vks",   "name": "Vivo Keyd Stars",  "abbr": "VKS",  "country": "BR", "rating": 78, "budget": 2200000, "prestige": 80},
    {"id": "lev",   "name": "Leviatan",         "abbr": "LEV",  "country": "CL", "rating": 76, "budget": 2000000, "prestige": 77},
    {"id": "fluxo", "name": "Fluxo W7M",        "abbr": "FXO",  "country": "BR", "rating": 73, "budget": 1900000, "prestige": 75},
    {"id": "pain",  "name": "paiN Gaming",      "abbr": "PNG",  "country": "BR", "rating": 68, "budget": 2500000, "prestige": 88},
]

LEAGUES_DATA = {
    "LEC":   {"name": "LEC",   "full_name": "LoL EMEA Championship",                      "region": "Europe",       "teams": LEC_TEAMS},
    "LCK":   {"name": "LCK",   "full_name": "LoL Champions Korea",                        "region": "Korea",        "teams": LCK_TEAMS},
    "LPL":   {"name": "LPL",   "full_name": "LoL Pro League",                             "region": "China",        "teams": LPL_TEAMS},
    "LCS":   {"name": "LCS",   "full_name": "LoL Championship Series",                    "region": "North America","teams": LCS_TEAMS},
    "CBLOL": {"name": "CBLOL", "full_name": "Campeonato Brasileiro de League of Legends", "region": "Brazil",       "teams": CBLOL_TEAMS},
}

# ERL Players for Scouting - Real 2026 Rosters + CSV-derived data
ERL_LEAGUES = ["LFL", "PRM", "LVP SL", "NLC", "TCL", "EBL", "LCK CL",
               "LCKC", "NACL", "EM", "CD", "LRS", "DCup"]

# Hand-curated ERL players (LEC scouting pool) with scouting_for field

# Combined ERL pool: curated LEC players + CSV-derived data from all other leagues
ERL_PLAYERS =  _CSV_SCOUTING_PLAYERS

# Per-region newgen data: (nationality_code, [firstnames], [lastnames], [academy_teams])
_NEWGEN_REGIONS = {
    "LEC": {
        "nationalities": ["FR", "DE", "ES", "PL", "UK", "SE", "DK", "NL", "BE", "FI", "NO", "CZ", "RO", "PT", "IT", "HU", "GR", "TR"],
        "names": {
            "FR": (["Lucas", "Théo", "Hugo", "Nathan", "Tom", "Mathis", "Ethan", "Axel", "Baptiste", "Romain", "Maxime", "Julien", "Antoine", "Clément", "Rémi"],
                   ["Martin", "Bernard", "Leroy", "Dubois", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia"]),
            "DE": (["Leon", "Lukas", "Jonas", "Felix", "Paul", "Finn", "Tim", "Max", "Nico", "Elias", "Jan", "Ben", "Fabian", "Tobias", "Moritz"],
                   ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann", "Koch"]),
            "ES": (["Alejandro", "Daniel", "Pablo", "Álvaro", "Adrián", "Sergio", "Diego", "Rubén", "Miguel", "Javier", "Carlos", "Iñaki", "Pol", "Marc", "Unai"],
                   ["García", "Martínez", "López", "González", "Rodríguez", "Sánchez", "Pérez", "Fernández", "Romero", "Torres"]),
            "PL": (["Michał", "Jakub", "Piotr", "Krzysztof", "Łukasz", "Paweł", "Mateusz", "Kamil", "Bartosz", "Tomasz", "Marcin", "Filip", "Szymon", "Adam", "Karol"],
                   ["Kowalski", "Nowak", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak"]),
            "UK": (["James", "Jack", "Harry", "Oliver", "George", "Noah", "Charlie", "Alfie", "Freddie", "Archie", "Liam", "Ethan", "Logan", "Mason", "Dylan"],
                   ["Smith", "Jones", "Williams", "Taylor", "Brown", "Davies", "Evans", "Wilson", "Thomas", "Roberts"]),
            "SE": (["Erik", "Oscar", "Liam", "William", "Lucas", "Noah", "Elias", "Alexander", "Hugo", "Oliver", "Axel", "Filip", "Isak", "Emil", "Viktor"],
                   ["Johansson", "Eriksson", "Andersson", "Svensson", "Karlsson", "Nilsson", "Larsson", "Petersson", "Lindström", "Gustafsson"]),
            "DK": (["Noah", "William", "Oliver", "Emil", "Mikkel", "Mathias", "Frederik", "Christian", "Magnus", "Rasmus", "Victor", "Johan", "Tobias", "Mads", "Nicolai"],
                   ["Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sørensen", "Rasmussen", "Petersen"]),
            "NL": (["Lars", "Sander", "Tim", "Joris", "Stijn", "Daan", "Ruben", "Jesse", "Thijs", "Bram", "Luuk", "Jens", "Floris", "Milan", "Nils"],
                   ["de Jong", "Janssen", "de Vries", "van den Berg", "van Dijk", "Bakker", "Visser", "Smit", "Meijer", "Mulder"]),
            "BE": (["Mathieu", "Julien", "Nicolas", "Thomas", "Antoine", "Simon", "Pierre", "Romain", "Axel", "Robin", "Luca", "Kevin", "Arne", "Sven", "Warre"],
                   ["Peeters", "Janssens", "Maes", "Jacobs", "Claeys", "Willems", "Goossens", "Dubois", "Lambert", "Leclercq"]),
        },
        "default_names": (
            ["Alex", "Matteo", "Niko", "Luca", "Sami", "Kalle", "Rasmus", "Tuomas", "Ander", "Blaz", "Patrik", "Andrei", "Cosmin", "Stavros", "Cem"],
            ["Larsen", "Bauer", "Roux", "Costa", "Ionescu", "Kovacs", "Papadopoulos", "Yilmaz", "Ferreira", "Novak"]
        ),
        "teams": ["FNC Academy", "G2 Júnior", "KC Academy", "VIT Academy", "BDS Academy", "SK Prime", "GX Academy", "MAD Academy", "NIP Junior", "BIG Academy"],
    },
    "LCK": {
        "nationalities": ["KR"],
        "names": {
            "KR": (["MinJun", "JunYoung", "SeongMin", "DongHyun", "JaeHyun", "SangHyun", "WooJin", "HyunJun", "JunSeok", "YeongJun",
                    "SiWoo", "HanGyeol", "JunHo", "TaeYang", "SeoJun", "MinSeo", "JinHo", "SungMin", "DaeHyun", "ChangMin"],
                   ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Im", "Han", "Oh", "Seo", "Kwon", "Shin", "Lim"]),
        },
        "default_names": (
            ["MinJun", "JunYoung", "SeongMin"],
            ["Kim", "Lee", "Park"]
        ),
        "teams": ["T1 Academy", "Gen.G Academy", "KT Academy", "DRX Academy", "HLE Academy", "DK Academy", "FOX Academy", "BRO Academy"],
    },
    "LCS": {
        "nationalities": ["US", "CA", "US", "US", "CA"],  # weighted toward US
        "names": {
            "US": (["Tyler", "Brandon", "Cody", "Ryan", "Nathan", "Jake", "Austin", "Ethan", "Jordan", "Kyle", "Zach", "Spencer", "Derek", "Hunter", "Connor"],
                   ["Johnson", "Williams", "Brown", "Jones", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin"]),
            "CA": (["Liam", "Noah", "Mason", "Logan", "Lucas", "Ethan", "Oliver", "Aiden", "Jackson", "Carter", "Owen", "Caleb", "Dylan", "Ryan", "Tyler"],
                   ["Smith", "Brown", "Tremblay", "Martin", "Roy", "Wilson", "Taylor", "Thompson", "Campbell", "Anderson"]),
        },
        "default_names": (
            ["Tyler", "Brandon", "Cody", "Ryan", "Nathan"],
            ["Johnson", "Williams", "Brown", "Jones", "Davis"]
        ),
        "teams": ["C9 Academy", "TL Academy", "100 Academy", "FLY Academy", "EG Academy", "SEN Academy", "DSG Academy", "DIG Academy"],
    },
    "LPL": {
        "nationalities": ["CN"],
        "names": {
            "CN": (["WeiLong", "ZiHao", "HaoRan", "JunXuan", "YiMing", "BoWen", "ZhengYu", "HaoJun", "ZiYang", "TianYu",
                    "YuHao", "ZhiYuan", "PengYu", "MingHao", "JunHao", "XiaoLong", "ZhiLong", "YiXuan", "HaoYu", "PeiXuan"],
                   ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu"]),
        },
        "default_names": (
            ["WeiLong", "ZiHao", "HaoRan"],
            ["Wang", "Li", "Zhang"]
        ),
        "teams": ["BLG Academy", "JDG Academy", "EDG Academy", "NIP Academy", "OMG Academy", "WBG Academy", "AL Academy", "TES Academy"],
    },
    "CBLOL": {
        "nationalities": ["BR"],
        "names": {
            "BR": (["Gabriel", "Lucas", "Matheus", "Gustavo", "Pedro", "Rafael", "Felipe", "João", "Vitor", "Bruno",
                    "Leonardo", "Diego", "Caio", "Thiago", "Henrique", "Arthur", "Daniel", "André", "Eduardo", "Vinícius"],
                   ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
                    "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Sousa", "Fernandes", "Vieira", "Barbosa"]),
        },
        "default_names": (
            ["Gabriel", "Lucas", "Matheus"],
            ["Silva", "Santos", "Oliveira"]
        ),
        "teams": ["LOUD Academy", "paiN Academy", "FURIA Academy", "RED Academy", "Fluxo Academy", "KBM Academy", "Vivo Academy", "INTZ Academy"],
    },
}

def generate_newgen(league: str = "LEC"):
    """Generate a random newgen player with region-appropriate name and nationality."""
    region = _NEWGEN_REGIONS.get(league, _NEWGEN_REGIONS["LEC"])
    nationality = random.choice(region["nationalities"])
    name_data = region["names"].get(nationality, None)
    if name_data:
        first = random.choice(name_data[0])
        last  = random.choice(name_data[1])
    else:
        first = random.choice(region["default_names"][0])
        last  = random.choice(region["default_names"][1])
    # Use initials-style last name for Western regions (matching esports handle style)
    display_name = f"{first} {last[0]}." if league not in ("LCK", "LPL") else f"{first} {last}"

    position  = random.choice(["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"])
    age       = random.randint(16, 19)
    potential = random.randint(75, 95)
    rating    = max(55, potential - random.randint(15, 30))

    return {
        "name":        display_name,
        "position":    position,
        "nationality": nationality,
        "age":         age,
        "rating":      rating,
        "potential":   potential,
        "league":      "Academy",
        "team":        random.choice(region["teams"]),
    }

def generate_player(position: str, team_id: str, player_data: dict = None, is_starter: bool = True):
    """Generate a player with real or random stats"""
    if player_data:
        # Use real player data
        base_rating = player_data["rating"]
        # Check for real meta stats from gol.gg
        real_stats = PLAYER_META_STATS.get(player_data["name"], {})
        kda = real_stats.get("kda", round(random.uniform(2.5, 7.0), 2))
        _default_csm = round(random.uniform(0.5, 1.5), 1) if position == "SUPPORT" else round(random.uniform(7.5, 10.0), 1)
        cs_min = real_stats.get("csm", _default_csm)
        # Build champion pool: CSV data first, fallback to meta picks
        csv_pool = CSV_CHAMPION_POOLS.get(player_data["name"].lower(), [])
        if len(csv_pool) >= 3:
            champ_pool = csv_pool[:6]
        else:
            meta_pool = [c["name"] for c in get_meta_champions().get(position, []) if c["picks"] >= 3]
            if len(meta_pool) < 3:
                meta_pool = [c["name"] for c in get_meta_champions().get(position, [])]
            champ_pool = random.sample(meta_pool, min(5, len(meta_pool)))
        return {
            "id": str(uuid.uuid4()),
            "name": player_data["name"],
            "position": position,
            "team_id": team_id,
            "nationality": player_data["nationality"],
            "age": player_data["age"],
            "rating": base_rating,
            "potential": player_data["potential"],
            "mechanics": base_rating + random.randint(-5, 5),
            "game_sense": base_rating + random.randint(-5, 5),
            "teamwork": random.randint(70, 95),
            "consistency": random.randint(70, 95),
            "clutch": random.randint(60, 95),
            "kda": kda,
            "cs_min": cs_min,
            "kp": random.randint(60, 80),
            "moral": random.randint(70, 95),
            "fatigue": random.randint(0, 30),
            "salary": random.randint(80000, 400000),
            "contract_years": random.randint(1, 3),
            "champion_pool": champ_pool,
            "is_starter": is_starter,
            "transfer_value": int(base_rating * random.randint(15000, 25000))
        }
    else:
        # Fallback to random generation
        base_rating = random.randint(70, 85)
        nationality = random.choice(["EU", "KR", "FR", "DE", "ES", "PL"])
        return {
            "id": str(uuid.uuid4()),
            "name": f"Rookie_{random.randint(100, 999)}",
            "position": position,
            "team_id": team_id,
            "nationality": nationality,
            "age": random.randint(17, 22),
            "rating": base_rating,
            "potential": min(99, base_rating + random.randint(5, 15)),
            "mechanics": random.randint(65, 90),
            "game_sense": random.randint(65, 90),
            "teamwork": random.randint(65, 90),
            "consistency": random.randint(65, 90),
            "clutch": random.randint(55, 90),
            "kda": round(random.uniform(2.0, 6.0), 2),
            "cs_min": round(random.uniform(0.5, 1.5), 1) if position == "SUPPORT" else round(random.uniform(7.0, 9.5), 1),
            "kp": random.randint(55, 75),
            "moral": random.randint(65, 90),
            "fatigue": random.randint(0, 35),
            "salary": random.randint(50000, 200000),
            "contract_years": random.randint(1, 3),
            "champion_pool": random.sample(CHAMPIONS.get(position, ["Unknown"]), min(4, len(CHAMPIONS.get(position, ["Unknown"])))),
            "is_starter": is_starter,
            "transfer_value": random.randint(100000, 800000)
        }

def generate_team_roster(team_id: str):
    """Generate a full roster for a team using real players (starters only)"""
    positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
    roster = []
    
    if team_id in REAL_ROSTERS:
        # Use real roster data - only starters
        real_roster = REAL_ROSTERS[team_id]
        for pos in positions:
            if pos in real_roster:
                player_data = real_roster[pos]
                roster.append(generate_player(pos, team_id, player_data, is_starter=True))
    else:
        # Fallback to random generation
        for pos in positions:
            roster.append(generate_player(pos, team_id, None, is_starter=True))
    
    return roster

def generate_erl_player(erl_data: dict):
    """Generate an ERL/Academy player for scouting.

    Uses csv_kda / csv_cspm fields from CSV-derived entries to seed realistic
    stats; falls back to random ranges for hand-curated entries that lack them.
    """
    base = erl_data["rating"]
    # Seed KDA and CSPM from CSV data when available
    csv_kda  = erl_data.get("csv_kda")
    csv_cspm = erl_data.get("csv_cspm")
    _pos = erl_data.get("position", "")
    kda    = round(csv_kda  + random.uniform(-0.3, 0.3), 2) if csv_kda  else round(random.uniform(2.0, 5.5), 2)
    _csm_fallback = round(random.uniform(0.5, 1.5), 1) if _pos == "SUPPORT" else round(random.uniform(7.0, 9.0), 1)
    cs_min = round(csv_cspm + random.uniform(-0.3, 0.3), 1) if csv_cspm else _csm_fallback
    return {
        "id": str(uuid.uuid4()),
        "name": erl_data["name"],
        "position": erl_data["position"],
        "team_id": None,
        "nationality": erl_data["nationality"],
        "age": erl_data["age"],
        "rating": base,
        "potential": erl_data["potential"],
        "mechanics": base + random.randint(-8, 8),
        "game_sense": base + random.randint(-8, 8),
        "teamwork": random.randint(60, 85),
        "consistency": random.randint(55, 85),
        "clutch": random.randint(50, 85),
        "kda": kda,
        "cs_min": cs_min,
        "kp": random.randint(55, 75),
        "moral": random.randint(70, 95),
        "fatigue": random.randint(0, 20),
        "salary": random.randint(20000, 80000),
        "contract_years": random.randint(1, 2),
        "champion_pool": CSV_CHAMPION_POOLS.get(erl_data["name"].lower(), [])[:6] or random.sample(CHAMPIONS.get(erl_data["position"], ["Unknown"]), min(4, len(CHAMPIONS.get(erl_data["position"], ["Unknown"])))),
        "is_starter": True,
        "transfer_value": int(erl_data["potential"] * random.randint(8000, 15000)),
        "league": erl_data["league"],
        "current_team": erl_data["team"],
        "scouting_for": erl_data.get("scouting_for", "LEC"),
    }

# GAME_STATE importé depuis app_state.py (refactor étape 2)

def initialize_game(league: str = "LEC"):
    """Initialize all game data"""
    GAME_STATE["user_team"] = None
    GAME_STATE["league"] = league
    _rebuild_meta_lookup()  # Use league-specific champion meta
    GAME_STATE["current_week"] = 1
    GAME_STATE["current_split"] = 1
    GAME_STATE["season"] = 2026
    GAME_STATE["phase"] = "regular"
    GAME_STATE["playoffs_bracket"] = None
    GAME_STATE["history"] = []
    GAME_STATE["negotiations"] = []
    GAME_STATE["draft_state"] = {
        "step": 0,
        "phase": "ban1",
        "current_turn": "user",
        "user_bans": [],
        "enemy_bans": [],
        "user_picks": [],
        "enemy_picks": [],
        "banned_champions": [],
        "picked_champions": [],
        "user_picked_champions": [],
        "enemy_picked_champions": [],
        "fearless_excluded": [],
    }
    GAME_STATE["champion_stats"] = {}
    GAME_STATE["total_games_played"] = 0
    GAME_STATE["tactics"] = None
    GAME_STATE["inbox"] = []
    GAME_STATE["schedule"] = []
    GAME_STATE["teams"] = {}
    GAME_STATE["players"] = {}
    GAME_STATE["erl_players"] = {}

    league_teams = LEAGUES_DATA.get(league, LEAGUES_DATA["LEC"])["teams"]
    for team_data in league_teams:
        team = {**team_data, "wins": 0, "losses": 0, "roster": []}
        GAME_STATE["teams"][team["id"]] = team
        
        # Initialize ELO from static team rating (70-99 → 900-1190 ELO range)
        team["elo"] = initial_elo(team_data.get("rating", 80))
        team["elo_games"] = 0

        roster = generate_team_roster(team["id"])
        for player in roster:
            GAME_STATE["players"][player["id"]] = player
            team["roster"].append(player["id"])
            # Store initial_rating for performance evolution floor tracking
            player["initial_rating"] = player.get("rating", 80)
    
    # Generate ERL players for scouting
    for erl_data in ERL_PLAYERS:
        player = generate_erl_player(erl_data)
        GAME_STATE["erl_players"][player["id"]] = player
    
    # Generate additional newgens scoped to the active league
    active_league = GAME_STATE.get("league", "LEC")
    for _ in range(30):
        newgen_data = generate_newgen(active_league)
        newgen_data["scouting_for"] = active_league
        player = generate_erl_player(newgen_data)
        GAME_STATE["erl_players"][player["id"]] = player
    
    generate_schedule()
    GAME_STATE["initialized"] = True


def build_initial_state(league: str = "LEC") -> dict:
    """Build an isolated initial game state for `league`, without mutating
    the global `GAME_STATE` (callers that *want* to initialise solo can still
    call `initialize_game` directly).

    Implementation: swap the global dict in-place, run `initialize_game`,
    snapshot the result, then restore the previous contents. This reuses
    100% of the solo initialisation logic (roster generation, ERL pool,
    schedule) without duplicating it.

    Concurrency: holds `_state_thread_lock` to serialise against any other
    threadpool worker (e.g. concurrent `mp2_create` calls) and against async
    paths that bridge through `_swap_lock` -> the same thread lock.
    """
    with _state_thread_lock:
        # Snapshot current global state
        snapshot = dict(GAME_STATE)
        GAME_STATE.clear()
        try:
            initialize_game(league)
            isolated = dict(GAME_STATE)
            return isolated
        finally:
            # Restore previous contents exactly
            GAME_STATE.clear()
            GAME_STATE.update(snapshot)
            # Re-align META_LOOKUP with the restored league (solo may have been mid-game)
            if snapshot.get("league"):
                try:
                    _rebuild_meta_lookup()
                except Exception:
                    logger.exception("Failed to restore META_LOOKUP after build_initial_state")


# ── MP session swap helper ────────────────────────────────────────────────────
# Context manager that temporarily replaces the global GAME_STATE with a
# session's state for the duration of a request handler. This lets every
# solo endpoint (`/draft/action`, `/match/simulate`, `/advance-week`, ...)
# operate on an MP session without a single line of MP-specific logic.
#
# Thread-safety: FastAPI/uvicorn dev is single-worker + asyncio. We still
# guard the swap with a global asyncio.Lock so that two concurrent HTTP
# requests (e.g. one solo + one MP, or two different MP sessions) cannot
# interleave mutations on the same global dict.
import contextlib as _contextlib
import asyncio as _asyncio
import threading as _threading

# Async lock — serialises async coroutines that swap GAME_STATE.
_swap_lock = _asyncio.Lock()
# Threading lock — serialises sync paths (FastAPI runs `def` endpoints in a
# threadpool, where _swap_lock is invisible). All `GAME_STATE` mutations from
# both worlds must hold this lock; async paths take it after _swap_lock.
_state_thread_lock = _threading.RLock()


class _ThreadLockAsyncBridge:
    """Async context manager that acquires a `threading.Lock` (or RLock) from
    an async path. Uses a thread executor to avoid blocking the event loop.

    Lets async code that already holds `_swap_lock` ALSO serialise against
    sync threadpool workers that touch GAME_STATE.
    """

    def __init__(self, lock: "_threading.RLock | _threading.Lock") -> None:
        self._lock = lock

    async def __aenter__(self) -> None:
        # RLock ownership is thread-bound: whichever thread acquires must
        # also release. `_swap_lock` already serialises async callers, so
        # acquisition is normally uncontended and non-blocking on the loop
        # thread. Fall back to a short spin that yields control if another
        # thread-pool worker transiently holds it, rather than offloading to
        # `to_thread` (which would acquire in a worker and leave __aexit__
        # releasing from the loop thread — RuntimeError).
        while not self._lock.acquire(blocking=False):
            await _asyncio.sleep(0)

    async def __aexit__(self, exc_type, exc, tb) -> None:
        self._lock.release()


@_contextlib.asynccontextmanager
async def use_session_state(session_id: str | None):
    """Swap GAME_STATE to the session's state for the duration of the block.

    If session_id is None, yields immediately with the solo state in place.
    On exit, the original state is restored exactly and the session is
    marked dirty (autosave will flush it).
    """
    if not session_id:
        yield None
        return

    sess = _sessions.get_session(session_id)
    if sess is None:
        raise HTTPException(404, f"MP session {session_id} introuvable")

    async with _swap_lock, _ThreadLockAsyncBridge(_state_thread_lock):
        global _mp_swap_depth
        # Snapshot solo state
        solo_snapshot = dict(GAME_STATE)
        GAME_STATE.clear()
        GAME_STATE.update(sess.state)
        _mp_swap_depth += 1
        try:
            # Align META_LOOKUP with this session's league (best-effort)
            try:
                _rebuild_meta_lookup()
            except Exception:
                logger.exception("Failed to rebuild META_LOOKUP for session %s", session_id[:8])
            yield sess
            # Persist mutations back into the session dict object (so subscribers
            # of sess.state see the new values — same object reference, actually)
            sess.state.clear()
            sess.state.update(GAME_STATE)
            _sessions.mark_dirty(session_id)
        finally:
            _mp_swap_depth -= 1
            # Restore solo state exactly
            GAME_STATE.clear()
            GAME_STATE.update(solo_snapshot)
            if solo_snapshot.get("league"):
                try:
                    _rebuild_meta_lookup()
                except Exception:
                    logger.exception("Failed to restore META_LOOKUP after session %s", session_id[:8])


def generate_schedule():
    """Generate 9-week LEC-style schedule: each team plays exactly twice per week.

    Uses the circle/round-robin method for 10 teams → 9 rounds of 5 matches.
    Two rounds are packed per week (first half + reversed second half) → 9 weeks × 10 matches.
    """
    team_ids = list(GAME_STATE["teams"].keys())
    n = len(team_ids)  # 10

    # Circle method: fix teams[0], rotate the rest to generate 9 rounds
    fixed = team_ids[0]
    rotating = team_ids[1:]
    rounds_first_half = []
    for _ in range(n - 1):  # 9 rounds
        round_pairs = [(fixed, rotating[0])]
        for i in range(1, n // 2):
            round_pairs.append((rotating[i], rotating[n - 1 - i]))
        rounds_first_half.append(round_pairs)
        rotating = [rotating[-1]] + rotating[:-1]

    # Second half: same matchups with home/away swapped, shifted by 5 weeks
    # so no week pairs a team against the same opponent twice
    rounds_second_half = [[(t2, t1) for t1, t2 in r] for r in rounds_first_half]
    offset = (n - 1) // 2  # 4 for 10 teams → shift by 4 ensures no overlap
    rounds_second_half_shifted = rounds_second_half[offset:] + rounds_second_half[:offset]

    schedule = []
    for week in range(1, n):  # weeks 1-(n-1)
        # Game day 1: from first half round
        for t1, t2 in rounds_first_half[week - 1]:
            schedule.append({
                "id": str(uuid.uuid4()),
                "week": week,
                "day": 1,
                "team1": t1,
                "team2": t2,
                "played": False,
                "score1": 0,
                "score2": 0,
                "winner": None,
                "match_details": None
            })
        # Game day 2: from shifted second half (different opponents than game day 1)
        for t1, t2 in rounds_second_half_shifted[week - 1]:
            schedule.append({
                "id": str(uuid.uuid4()),
                "week": week,
                "day": 2,
                "team1": t1,
                "team2": t2,
                "played": False,
                "score1": 0,
                "score2": 0,
                "winner": None,
                "match_details": None
            })

    GAME_STATE["schedule"] = schedule

def calculate_team_power(team_id: str, draft_advantage: float = 0, apply_tactics: bool = False) -> float:
    """Calculate team power with position-weighted contributions and player form."""
    team = GAME_STATE["teams"].get(team_id)
    if team is None:
        logging.error(f"calculate_team_power: team_id introuvable: {team_id}")
        return 50.0
    starters_by_pos = {}
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid)
        if p and p.get("is_starter"):
            starters_by_pos[p["position"]] = p

    if not starters_by_pos:
        logging.warning(
            f"calculate_team_power: team '{team.get('name', team_id)}' n'a aucun starter — "
            f"roster de {len(team.get('roster', []))} joueurs. Power par défaut=50."
        )
        return 50.0

    # Position carry-weight (higher = more influence on game outcome)
    POS_WEIGHT = {"JUNGLE": 1.25, "MID": 1.20, "ADC": 1.15, "TOP": 0.95, "SUPPORT": 0.90}

    total_weight = 0.0
    weighted_power = 0.0

    for pos, p in starters_by_pos.items():
        w = POS_WEIGHT.get(pos, 1.0)

        # Base skill composite (mechanics + game_sense outweigh raw rating)
        skill = (p["mechanics"]   * SKILL_W_MECHANICS
               + p["game_sense"]  * SKILL_W_GAME_SENSE
               + p["rating"]      * SKILL_W_RATING
               + p["teamwork"]    * SKILL_W_TEAMWORK
               + p["consistency"] * SKILL_W_CONSISTENCY)

        # Form modifier: moral boosts, fatigue penalises — non-linear
        # form_bonus (0-6) from training adds up to +3% power
        form = 1.0 + (p["moral"] - 65) / 350.0 - (p["fatigue"] / 200.0) + p.get("form_bonus", 0) / 200.0
        form = max(0.75, min(1.20, form))

        # Clutch factor adds a small ceiling-breaker in key moments
        clutch_bonus = (p.get("clutch", 75) - 75) / 500.0  # ±0.04 range

        player_power = skill * form + clutch_bonus * 5
        weighted_power += player_power * w
        total_weight += w

    base = weighted_power / total_weight

    # ELO modifier: teams above/below league average get a small power boost/penalty.
    # Capped at ±8 so ELO supplements skill — it doesn't override a clear talent gap.
    all_teams = GAME_STATE.get("teams", {})
    league_avg = get_league_avg_elo(all_teams)
    team_elo = ensure_team_elo(GAME_STATE["teams"][team_id])
    elo_mod = elo_power_modifier(team_elo, league_avg)

    tactics_mod = 0.0
    if apply_tactics and GAME_STATE.get("tactics"):
        tactics_mod = calculate_tactics_modifier(GAME_STATE["tactics"])

    power = base + draft_advantage + elo_mod + tactics_mod

    return max(30, min(100, power))

def generate_auto_bans(n: int = 10) -> list:
    """Pick n champions as simulated bans using weighted random selection from meta pool."""
    meta = get_meta_champions()
    pool = []
    for champs in meta.values():
        pool.extend(champs)

    # Deduplicate by name
    seen_names = set()
    unique = []
    for c in pool:
        name = c.get("name")
        if name and name not in seen_names:
            seen_names.add(name)
            unique.append(c)

    if not unique:
        return []

    # Score each champion: higher score = more likely to be banned
    def ban_score(c):
        return (c.get("bans", 0) * 2) + c.get("picks", 0)

    scores = [max(ban_score(c), 1) for c in unique]
    total = sum(scores)
    weights = [s / total for s in scores]

    # Weighted random sample without replacement
    n = min(n, len(unique))
    indices = list(range(len(unique)))
    chosen = []
    remaining_weights = list(weights)
    remaining_indices = list(indices)

    for _ in range(n):
        if not remaining_indices:
            break
        w_sum = sum(remaining_weights)
        if w_sum <= 0:
            chosen.append(remaining_indices.pop(random.randrange(len(remaining_indices))))
            if chosen:
                remaining_weights.pop(len(remaining_indices))
            break
        r = random.random() * w_sum
        cumulative = 0.0
        pick_pos = len(remaining_indices) - 1
        for pos, w in enumerate(remaining_weights):
            cumulative += w
            if r <= cumulative:
                pick_pos = pos
                break
        chosen.append(remaining_indices[pick_pos])
        remaining_indices.pop(pick_pos)
        remaining_weights.pop(pick_pos)

    return [unique[i]["name"] for i in chosen]


def update_champ_stats(team1_stats: list, team2_stats: list, winner_id: str, team1_id: str, bans: list = None):
    """Accumulate pick/win/ban stats for champions in this game."""
    stats = GAME_STATE.setdefault("champion_stats", {})
    GAME_STATE["total_games_played"] = GAME_STATE.get("total_games_played", 0) + 1
    for p in team1_stats:
        champ = p.get("champion")
        if champ:
            c = stats.setdefault(champ, {"picks": 0, "wins": 0, "bans": 0, "positions": {}})
            c["picks"] += 1
            pos = p.get("position", "")
            if pos:
                c.setdefault("positions", {})[pos] = c["positions"].get(pos, 0) + 1
            if winner_id == team1_id:
                c["wins"] += 1
    for p in team2_stats:
        champ = p.get("champion")
        if champ:
            c = stats.setdefault(champ, {"picks": 0, "wins": 0, "bans": 0, "positions": {}})
            c["picks"] += 1
            pos = p.get("position", "")
            if pos:
                c.setdefault("positions", {})[pos] = c["positions"].get(pos, 0) + 1
            if winner_id != team1_id:
                c["wins"] += 1
    for ban in (bans or []):
        if ban:
            e = stats.setdefault(ban, {"picks": 0, "wins": 0, "bans": 0, "positions": {}})
            e["bans"] += 1


def update_player_from_performance(
    team_id: str,
    player_stats_list: list,
    won: bool,
    game_duration: float,
    opponent_id: str = None,
    week: int = None,
) -> None:
    """
    Apply small performance-based rating deltas after a game.

    Goals:
    - Outstanding performers (+7+ score) slowly approach their potential ceiling.
    - Underperformers (-4 score) slowly decline toward a floor.
    - Max change per game: ±0.3 (requires ~20 games to move 6 rating points).
    - Bounded above by player["potential"] × 0.9, below by player["rating"] - 5.

    Only mechanics and game_sense are updated (the two most skill-linked attrs).
    """
    team = GAME_STATE["teams"].get(team_id, {})
    roster = {GAME_STATE["players"][pid]["position"]: pid
              for pid in team.get("roster", [])
              if pid in GAME_STATE["players"]}

    for pstat in player_stats_list:
        pos = pstat.get("position", "")
        pid = roster.get(pos)
        if not pid:
            continue
        player = GAME_STATE["players"][pid]

        score = _player_performance_score(pstat, won, game_duration)

        # Map score 0–10 → delta -0.25 to +0.25
        # score 5 → 0 (neutral), score 8 → +0.15, score 2 → -0.15
        delta = (score - 5.0) * 0.05
        delta = max(-0.25, min(0.25, delta))

        potential  = player.get("potential", 90)
        init_rating = player.get("initial_rating", player.get("rating", 80))

        for attr in ("mechanics", "game_sense"):
            current = player.get(attr, 80)
            ceiling = potential * 0.9
            floor   = init_rating - 5
            new_val = current + delta
            player[attr] = round(max(floor, min(ceiling, new_val)), 2)

        # Track career performance for future display
        perf_history = player.setdefault("perf_history", [])
        perf_history.append(round(score, 2))
        if len(perf_history) > 20:
            perf_history.pop(0)
        player["avg_perf"] = round(sum(perf_history) / len(perf_history), 2)

        # Track detailed match history (champion, opponent, result, KDA)
        k = pstat.get("kills", 0) or 0
        d = pstat.get("deaths", 0) or 0
        a = pstat.get("assists", 0) or 0
        kda_val = round((k + a) / max(d, 1), 2)
        opp_abbr = (GAME_STATE["teams"].get(opponent_id, {}).get("abbr") or opponent_id) if opponent_id else None
        match_entry = {
            "score": round(score, 2),
            "won": won,
            "champion": pstat.get("champion"),
            "opponent": opp_abbr,
            "kda": kda_val,
            "week": week,
        }
        match_history = player.setdefault("match_history", [])
        match_history.append(match_entry)
        if len(match_history) > 20:
            match_history.pop(0)


def apply_match_result_updates(
    winner_id: str,
    loser_id: str,
    match_result: dict,
    winner_stats: list,
    loser_stats: list,
    is_playoffs: bool = False,
    week: int = None,
) -> dict:
    """
    Central point for all post-match state updates:
      1. ELO update for winner/loser teams
      2. Player performance evolution for both teams
      3. Returns ELO change summary for logging

    Called from every match simulation site (regular season, week sim,
    full-season sim, playoffs) to keep ELO logic in one place.
    """
    winner_team = GAME_STATE["teams"].get(winner_id, {})
    loser_team  = GAME_STATE["teams"].get(loser_id,  {})

    # Extract match quality signals for K-factor
    phases     = match_result.get("phases", [])
    gold_diff  = phases[-1].get("gold_diff", 0) if phases else 0
    pw         = match_result.get("phase_wins", {})
    winner_num = 1 if match_result.get("winner") == 1 else 2
    phase_wins_winner = pw.get(winner_num, 2)
    duration = match_result.get("duration", 30)

    elo_summary = apply_match_elo(
        winner_team, loser_team,
        gold_diff, phase_wins_winner,
        is_playoffs=is_playoffs,
    )

    # ── Track per-match ELO history for the user team ─────────────────────
    user_team_id = GAME_STATE.get("user_team")
    if user_team_id and user_team_id in (winner_id, loser_id):
        is_winner = (user_team_id == winner_id)
        opp_id = loser_id if is_winner else winner_id
        opp_team = GAME_STATE["teams"].get(opp_id, {})
        elo_before = elo_summary["winner_elo_before"] if is_winner else elo_summary["loser_elo_before"]
        elo_after  = elo_summary["winner_elo_after"]  if is_winner else elo_summary["loser_elo_after"]
        delta      = elo_summary["winner_delta"]      if is_winner else elo_summary["loser_delta"]
        match_elo_entry = {
            "season": GAME_STATE.get("season", 2026),
            "split_number": GAME_STATE.get("current_split", 1),
            "split_label": (
                f"{GAME_STATE.get('league', 'LEC')} "
                f"{'Spring' if GAME_STATE.get('current_split', 1) == 1 else 'Summer'} "
                f"{GAME_STATE.get('season', 2026)}"
            ),
            "week": week,
            "opponent_abbr": opp_team.get("abbr"),
            "opponent_id": opp_id,
            "won": is_winner,
            "is_playoffs": is_playoffs,
            "elo_before": round(elo_before, 1),
            "elo_after": round(elo_after, 1),
            "delta": round(delta, 1),
        }
        user_elo_log = GAME_STATE.setdefault("user_elo_log", [])
        user_elo_log.append(match_elo_entry)
        # Cap defensively to avoid runaway growth (200 matchs ≈ ~10 splits réguliers)
        if len(user_elo_log) > 500:
            del user_elo_log[: len(user_elo_log) - 500]

    # Player performance evolution
    update_player_from_performance(winner_id, winner_stats, True,  duration, opponent_id=loser_id,  week=week)
    update_player_from_performance(loser_id,  loser_stats,  False, duration, opponent_id=winner_id, week=week)

    # Post-match training reset: form_bonus decays, training slot reopens + auto-plan
    user_team_id = GAME_STATE.get("user_team")
    budget_fallback_players = []
    for tid in (winner_id, loser_id):
        team = GAME_STATE["teams"].get(tid, {})
        for pid in team.get("roster", []):
            p = GAME_STATE["players"].get(pid)
            if p:
                p["form_bonus"] = max(0, p.get("form_bonus", 0) - 1)
                p["training_done_this_week"] = False
                # Auto-apply recurring plan for user's team
                if tid == user_team_id and p.get("training_plan"):
                    intended = p["training_plan"]
                    applied = _execute_training_plan(p, team)
                    if applied == "rest" and intended != "rest":
                        budget_fallback_players.append(p.get("name", "Joueur"))

    # Notify user if budget fallback occurred for any player
    if budget_fallback_players:
        names = ", ".join(budget_fallback_players)
        _add_inbox_message(
            "board",
            "Manager Financier",
            "Budget insuffisant — entraînement réduit",
            f"Budget insuffisant cette semaine pour {names}. "
            f"Leur programme a été remplacé par du repos. "
            f"Rechargez votre budget pour reprendre les sessions prévues.",
            week,
        )

    return elo_summary


def generate_player_stats(
    team_id: str,
    won: bool,
    game_duration: int,
    team_kills: int,
    opp_kills: int,
    draft_picks: list = None,
    excluded: set = None,
) -> list:
    """Wrapper: delegates to simulation.generate_player_stats with GAME_STATE data."""
    from simulation import generate_player_stats as _gen_player_stats
    return _gen_player_stats(
        GAME_STATE["teams"],
        GAME_STATE["players"],
        team_id, won, game_duration, team_kills, opp_kills,
        get_meta_champions,
        draft_picks=draft_picks,
        excluded=excluded,
    )


# API Endpoints

@api_router.get("/")
async def root():
    return {"message": "LEC Manager API v1.0"}

@api_router.post("/game/init")
async def init_game():
    """Initialize a new game"""
    initialize_game()
    save_state()
    return {"success": True, "message": "Game initialized"}

# ── Save slot endpoints ───────────────────────────────────────────────────────

@api_router.get("/saves")
async def list_saves():
    """Return info about all 3 save slots."""
    slots = []
    for i in range(1, 4):
        path = get_save_path(i)
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                team_id = data.get("user_team")
                team = data.get("teams", {}).get(team_id, {}) if team_id else {}
                # Fallback: look up static league data if team not found in save
                if not team and team_id:
                    for league_data in LEAGUES_DATA.values():
                        for t in league_data["teams"]:
                            if t["id"] == team_id:
                                team = t
                                break
                        if team:
                            break
                slots.append({
                    "slot": i,
                    "exists": True,
                    "user_team": team_id,
                    "team_name": team.get("name"),
                    "team_abbr": team.get("abbr"),
                    "wins": team.get("wins", 0),
                    "losses": team.get("losses", 0),
                    "week": data.get("current_week", 1),
                    "split": data.get("current_split", 1),
                    "phase": data.get("phase", "regular"),
                    "league": data.get("league", "LEC"),
                })
            except Exception as e:
                logging.warning(f"Failed to read save slot {i}: {e}")
                slots.append({"slot": i, "exists": False})
        else:
            slots.append({"slot": i, "exists": False})
    return slots

@api_router.post("/saves/{slot}/load")
async def load_save_slot(slot: int):
    """Load a specific save slot into active memory."""
    if slot not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Slot invalide (1-3)")
    path = get_save_path(slot)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sauvegarde introuvable")
    try:
        state.active_slot = slot
        if not load_state():
            raise HTTPException(status_code=500, detail="Erreur lors du chargement")
        _write_active_slot_file(slot)
        return {
            "success": True,
            "slot": slot,
            "user_team": GAME_STATE["user_team"],
            "current_week": GAME_STATE["current_week"],
            "initialized": GAME_STATE["initialized"],
            "league": GAME_STATE.get("league", "LEC"),
            "phase": GAME_STATE.get("phase", "regular"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {e}")

@api_router.post("/saves/{slot}/new")
async def new_game_slot(slot: int, body: Optional[NewGameRequest] = None):
    """Start a new game in a specific slot."""
    if body is None:
        body = NewGameRequest()
    if slot not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Slot invalide (1-3)")
    if body.league not in LEAGUES_DATA:
        raise HTTPException(status_code=400, detail=f"Ligue invalide: {body.league}")
    state.active_slot = slot
    initialize_game(body.league)
    save_state()
    _write_active_slot_file(slot)
    return {"success": True, "slot": slot, "league": body.league}

@api_router.get("/leagues")
async def get_leagues():
    """Return available leagues."""
    return [
        {"id": k, "name": v["name"], "full_name": v["full_name"], "region": v["region"], "team_count": len(v["teams"])}
        for k, v in LEAGUES_DATA.items()
    ]

@api_router.delete("/saves/{slot}")
async def delete_save_slot(slot: int):
    """Delete a save slot."""
    if slot not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Slot invalide (1-3)")
    path = get_save_path(slot)
    if path.exists():
        path.unlink()
    if state.active_slot == slot:
        state.active_slot = None
        GAME_STATE["initialized"] = False
        try:
            (ROOT_DIR / "active_slot.txt").unlink(missing_ok=True)
        except Exception as e:
            logging.warning(f"Failed to remove active_slot.txt: {e}")
    return {"success": True}

@api_router.get("/game/state")
async def get_game_state():
    """Get current game state"""
    if not GAME_STATE["initialized"]:
        if not load_state():
            ensure_initialized()
    
    return {
        "initialized": GAME_STATE["initialized"],
        "user_team": GAME_STATE["user_team"],
        "current_week": GAME_STATE["current_week"],
        "current_split": GAME_STATE["current_split"],
        "season": GAME_STATE["season"],
        "phase": GAME_STATE["phase"]
    }

@api_router.get("/teams")
async def get_teams():
    """Get all teams"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    return list(GAME_STATE["teams"].values())

@api_router.get("/teams/{team_id}")
async def get_team(team_id: str):
    """Get specific team with roster"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    
    if team_id not in GAME_STATE["teams"]:
        raise HTTPException(status_code=404, detail="Team not found")
    
    team = GAME_STATE["teams"][team_id]
    roster = [GAME_STATE["players"][pid] for pid in team["roster"]]

    # Compute per-team champion stats from match history
    pick_map = {}  # {champ: {picks, wins}}
    ban_map  = {}  # {champ: {blue, red}}  blue = team was team1, red = team was team2

    for match in GAME_STATE.get("schedule", []):
        if not match.get("played"):
            continue
        details = match.get("match_details") or {}
        is_t1 = match["team1"] == team_id
        is_t2 = match["team2"] == team_id
        if not is_t1 and not is_t2:
            continue
        won = match.get("winner") == team_id
        my_stats = details.get("team1_stats", []) if is_t1 else details.get("team2_stats", [])
        for p in my_stats:
            champ = p.get("champion")
            if champ:
                e = pick_map.setdefault(champ, {"picks": 0, "wins": 0})
                e["picks"] += 1
                if won:
                    e["wins"] += 1
        bans = details.get("bans") or []
        # Convention: first 5 bans = blue side (team1), last 5 = red side (team2)
        blue_bans = set(bans[:5])
        red_bans  = set(bans[5:])
        if is_t1:
            for champ in blue_bans:
                ban_map.setdefault(champ, {"blue": 0, "red": 0})["blue"] += 1
        else:
            for champ in red_bans:
                ban_map.setdefault(champ, {"blue": 0, "red": 0})["red"] += 1

    picks_list = sorted(
        [{"name": k, "picks": v["picks"], "wins": v["wins"],
          "wr": round(v["wins"] / v["picks"] * 100) if v["picks"] else 0}
         for k, v in pick_map.items()],
        key=lambda x: x["picks"], reverse=True
    )[:12]

    bans_list = sorted(
        [{"name": k, "blue": v["blue"], "red": v["red"], "total": v["blue"] + v["red"]}
         for k, v in ban_map.items()],
        key=lambda x: x["total"], reverse=True
    )[:10]

    return {**team, "players": roster, "champion_stats": {"picks": picks_list, "bans": bans_list}}

@api_router.post("/teams/select/{team_id}")
async def select_team(team_id: str, request: Request):
    """Select user's team.

    Solo mode: writes `user_team` on the global GAME_STATE.
    MP mode: reserves the team for the calling player (rejects if already
    taken) via `sessions.assign_team`, and also mirrors onto GAME_STATE so
    solo-code reading `user_team` during this request works.
    """
    if team_id not in GAME_STATE["teams"]:
        raise HTTPException(status_code=404, detail="Team not found")

    sid = request.query_params.get("session_id")
    token = request.query_params.get("mp_token")
    # Reject the ambiguous case where session_id is set but mp_token is not:
    # otherwise we'd fall through to the solo branch and write user_team /
    # current_week=0 / phase=preseason directly into the shared session state.
    if sid and not token:
        raise HTTPException(401, "mp_token required when session_id is provided")
    if sid and token:
        sess = _sessions.get_session(sid)
        if sess is None:
            raise HTTPException(404, f"MP session {sid} introuvable")
        try:
            _sessions.assign_team(sess, token, team_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        # In MP the shared state transitions to "regular" as soon as at least
        # one player has picked. Individual teams still live per-player in
        # session.players. current_week stays 0 until season actually starts.
        if GAME_STATE.get("phase", "team_pick") in ("team_pick", "preseason"):
            GAME_STATE["phase"] = "preseason"
        # Advance session-level phase so the UI can react.
        if sess.phase == "team_pick":
            # Only flip to "running" when every joined player has a team.
            if all(tid is not None for tid in sess.players.values()):
                sess.phase = "running"
                sess._dirty = True
        GAME_STATE["user_team"] = team_id
        save_state()
        return {"success": True, "team": GAME_STATE["teams"][team_id]}

    GAME_STATE["user_team"] = team_id
    GAME_STATE["current_week"] = 0
    GAME_STATE["phase"] = "preseason"
    save_state()
    return {"success": True, "team": GAME_STATE["teams"][team_id]}

@api_router.get("/players")
async def get_all_players():
    """Get all players"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    return list(GAME_STATE["players"].values())

@api_router.get("/players/{player_id}")
async def get_player(player_id: str):
    """Get specific player"""
    if player_id not in GAME_STATE["players"]:
        raise HTTPException(status_code=404, detail="Player not found")
    return GAME_STATE["players"][player_id]

@api_router.get("/scouting/erl")
async def get_erl_players():
    """Get ERL/Academy players for scouting, filtered to the active league's pool."""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    active_league = GAME_STATE.get("league", "LEC")
    return [
        p for p in GAME_STATE["erl_players"].values()
        if p.get("scouting_for", "LEC") == active_league
    ]

@api_router.get("/scouting/all")
async def get_all_scouting_players():
    """Get all scoutable players across every region (ERL pool, all leagues)."""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    active_league = GAME_STATE.get("league", "LEC")
    players = []
    for p in GAME_STATE["erl_players"].values():
        scout_for = p.get("scouting_for", "LEC")
        # International players cost more to sign (2× transfer value)
        cost_multiplier = 1.0 if scout_for == active_league else 2.0
        players.append({**p, "international": scout_for != active_league, "cost_multiplier": cost_multiplier})
    return players

@api_router.post("/scouting/sign")
async def sign_erl_player(request: SignERLPlayerRequest):
    """Sign an ERL player to your team"""
    if not GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="No team selected")
    
    player = GAME_STATE["erl_players"].get(request.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    
    user_team = GAME_STATE["teams"][GAME_STATE["user_team"]]
    transfer_fee = player["transfer_value"]
    
    if transfer_fee > user_team["budget"]:
        raise HTTPException(status_code=400, detail="Insufficient budget")
    
    # Transfer the player
    player["team_id"] = GAME_STATE["user_team"]
    player["salary"] = request.offered_salary
    player["contract_years"] = 2
    player.pop("league", None)
    player.pop("current_team", None)
    
    # Move from ERL to regular players
    GAME_STATE["players"][player["id"]] = player
    del GAME_STATE["erl_players"][request.player_id]
    
    user_team["roster"].append(player["id"])
    user_team["budget"] -= transfer_fee
    save_state()
    return {
        "success": True,
        "message": f"{player['name']} a rejoint votre équipe!",
        "player": player,
        "new_budget": user_team["budget"]
    }

@api_router.get("/schedule")
async def get_schedule():
    """Get match schedule"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    return GAME_STATE["schedule"]

@api_router.get("/standings")
async def get_standings():
    """Get current standings"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    
    teams = list(GAME_STATE["teams"].values())
    # Ensure ELO is initialized for any team loaded from an old save
    for t in teams:
        ensure_team_elo(t)
    teams.sort(key=lambda t: (t["wins"], t["wins"] - t["losses"]), reverse=True)

    league_avg = get_league_avg_elo({t["id"]: t for t in teams})
    standings = []
    for i, team in enumerate(teams):
        total_games = team["wins"] + team["losses"]
        standings.append({
            **team,
            "rank": i + 1,
            "win_rate": round(team["wins"] / total_games * 100, 1) if total_games > 0 else 0,
            "qualified": i < _playoffs_qualifier_count(),
            "elo": round(team.get("elo", initial_elo(team.get("rating", 80))), 0),
            "elo_games": team.get("elo_games", 0),
        })

    return standings

def _build_champ_stats_response(raw: dict, total: int, split_label: str = "Split en cours"):
    result = []
    for name, s in raw.items():
        picks = s.get("picks", 0)
        wins  = s.get("wins", 0)
        bans  = s.get("bans", 0)
        positions = s.get("positions", {})
        main_role = max(positions, key=positions.get) if positions else META_LOOKUP.get(name, {}).get("position", "")
        result.append({
            "name":       name,
            "picks":      picks,
            "wins":       wins,
            "bans":       bans,
            "main_role":  main_role,
            "pick_rate":  round(picks / total * 100, 1) if total > 0 else 0,
            "ban_rate":   round(bans  / total * 100, 1) if total > 0 else 0,
            "win_rate":   round(wins  / picks * 100, 1) if picks > 0 else 0,
            "presence":   min(100.0, round((picks + bans) / total * 100, 1)) if total > 0 else 0,
        })
    result.sort(key=lambda x: -(x["picks"] + x["bans"]))
    return {"total_games": total, "split_label": split_label, "champions": result}

@api_router.get("/stats/champions")
async def get_champion_stats(split: str = "current"):
    """Get champion pick/ban/win stats. split=current|last|0|1|2... (history index, 0=most recent)"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()

    if split == "current":
        total = GAME_STATE.get("total_games_played", 0)
        raw = GAME_STATE.get("champion_stats", {})
        label = "Split en cours"
        current_id = get_current_split_id()
        if current_id:
            user_league = GAME_STATE.get("league", "LEC")
            split_number = GAME_STATE.get("current_split", 1)
            season = GAME_STATE.get("season", 2026)
            split_name = "Spring" if split_number == 1 else "Summer"
            label = f"{user_league} {split_name} {season}"
        return _build_champ_stats_response(raw, total, label)

    # Historical splits — from history entries that have champion_stats
    history = [h for h in GAME_STATE.get("history", []) if "champion_stats" in h]
    if split == "last":
        idx = -1
    else:
        try:
            idx = -(int(split) + 1)  # 0 = most recent, 1 = second most recent, etc.
        except (ValueError, TypeError):
            idx = -1

    if not history:
        return {"total_games": 0, "split_label": "Aucun historique", "champions": []}

    try:
        entry = history[idx]
    except IndexError:
        entry = history[-1]

    return _build_champ_stats_response(
        entry.get("champion_stats", {}),
        entry.get("total_games_played", 0),
        entry.get("split_label", "Split précédent"),
    )

@api_router.get("/stats/splits")
async def get_stats_splits():
    """List all splits with champion stats available."""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    splits = []
    # Current split
    current_id = get_current_split_id()
    if current_id:
        user_league = GAME_STATE.get("league", "LEC")
        split_number = GAME_STATE.get("current_split", 1)
        season = GAME_STATE.get("season", 2026)
        split_name = "Spring" if split_number == 1 else "Summer"
        current_label = f"{user_league} {split_name} {season}"
    else:
        current_label = "Split en cours"
    splits.append({
        "key": "current",
        "label": current_label,
        "total_games": GAME_STATE.get("total_games_played", 0),
        "is_current": True,
    })
    # Historical splits (most recent first)
    history = [h for h in reversed(GAME_STATE.get("history", [])) if "champion_stats" in h]
    for i, entry in enumerate(history):
        splits.append({
            "key": str(i),
            "label": entry.get("split_label", f"Split {i+1}"),
            "total_games": entry.get("total_games_played", 0),
            "is_current": False,
        })
    return splits

def _playoffs_qualifier_count() -> int:
    """Number of teams that qualify for playoffs based on current league."""
    league = GAME_STATE.get("league", "LEC")
    return 10 if league == "LPL" else 6

def _playoffs_ub_count() -> int:
    """Number of teams that start in the Upper Bracket."""
    league = GAME_STATE.get("league", "LEC")
    return 6 if league == "LPL" else 4

# ============ PLAYOFFS SYSTEM ============
# Default format (LEC/LCK/LCS/CBLOL): 6-team double elimination, all Bo5
# Seeds 1-4 → Upper Bracket; Seeds 5-6 → Lower Bracket
#
# LPL format: 10-team double elimination, all Bo5
# Seeds 1-6 → Upper Bracket (seeds 1-2 bye); Seeds 7-10 → Lower Bracket entry
# UB: ub_r1 (3v6, 4v5) → ub_r2 (1vW, 2vW) → ub_final
# LB: lb_r1 (7v10, 8v9) concurrent w/ ub_r1
#     lb_r2 (UBR1L vs LBR1W) concurrent w/ ub_r2
#     lb_r3 (UBR2L vs LBR2W) concurrent w/ ub_final
#     lb_sf → lb_final → grand_final

def _make_playoff_match(round_name: str, match_number: int, team1: str, team2: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
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
        "fearless_used": [],   # champions played in this series (fearless rule)
    }


def _get_fearless_used(match: dict) -> set:
    """Return all champions played in previous games of this playoff series.
    Fearless rule: a champion played by either team cannot be picked by either team again."""
    used: set = set()
    for game in match.get("games", []):
        for stat in game.get("team1_stats", []):
            champ = stat.get("champion")
            if champ:
                used.add(champ)
        for stat in game.get("team2_stats", []):
            champ = stat.get("champion")
            if champ:
                used.add(champ)
    return used

def _match_loser(match: dict) -> str:
    return match["team2"] if match["winner"] == match["team1"] else match["team1"]

def start_playoffs():
    """Initialize playoffs bracket (6-team default, 10-team for LPL)."""
    teams = list(GAME_STATE["teams"].values())
    # Tiebreaker: wins (desc), losses (asc), head-to-head wins (desc), then stable team id
    h2h = GAME_STATE.get("head_to_head", {})
    def _sort_key(t):
        tid = t["id"]
        h2h_wins = sum(1 for opp_id, record in h2h.get(tid, {}).items() if record.get("wins", 0) > record.get("losses", 0))
        return (-t.get("wins", 0), t.get("losses", 0), -h2h_wins, tid)
    teams.sort(key=_sort_key)
    n = _playoffs_qualifier_count()
    qualified = [t["id"] for t in teams[:n]]

    if GAME_STATE.get("league") == "LPL":
        return _start_playoffs_lpl(qualified)

    # Default 6-team double-elim (LEC/LCK/LCS/CBLOL)
    GAME_STATE["phase"] = "playoffs"
    GAME_STATE["playoffs_bracket"] = {
        "format": "standard",
        "qualified_teams": qualified,
        "active_rounds": ["ub_r1"],
        "matches": [
            _make_playoff_match("ub_r1", 1, qualified[0], qualified[3]),  # #1 vs #4
            _make_playoff_match("ub_r1", 2, qualified[1], qualified[2]),  # #2 vs #3
        ],
        "champion": None,
        "ub_r1_losers": [],
        "ub_final_winner": None,
        "ub_final_loser": None,
        "lb_r1_winner": None,
        "lb_r2_winner": None,
        "lb_r3_winner": None,
    }
    return GAME_STATE["playoffs_bracket"]

def _start_playoffs_lpl(qualified: list):
    """Initialize LPL 10-team double-elimination playoffs bracket."""
    # q[0..5] → UB (seeds 1-6); q[6..9] → LB entry (seeds 7-10)
    # UB R1: #3(q[2]) vs #6(q[5]), #4(q[3]) vs #5(q[4]) — seeds 1,2 bye
    # LB R1 (concurrent): #7(q[6]) vs #10(q[9]), #8(q[7]) vs #9(q[8])
    GAME_STATE["phase"] = "playoffs"
    GAME_STATE["playoffs_bracket"] = {
        "format": "lpl",
        "qualified_teams": qualified,
        "active_rounds": ["ub_r1", "lb_r1"],
        "matches": [
            _make_playoff_match("ub_r1", 1, qualified[2], qualified[5]),  # #3 vs #6
            _make_playoff_match("ub_r1", 2, qualified[3], qualified[4]),  # #4 vs #5
            _make_playoff_match("lb_r1", 1, qualified[6], qualified[9]),  # #7 vs #10
            _make_playoff_match("lb_r1", 2, qualified[7], qualified[8]),  # #8 vs #9
        ],
        "champion": None,
        "ub_r1_winners": [],
        "ub_r1_losers": [],
        "ub_r2_winners": [],
        "ub_r2_losers": [],
        "ub_final_winner": None,
        "ub_final_loser": None,
        "lb_r1_winners": [],
        "lb_r2_winners": [],
        "lb_r3_winners": [],
        "lb_sf_winner": None,
    }
    return GAME_STATE["playoffs_bracket"]

def advance_playoffs():
    """Advance playoffs when all active rounds are complete."""
    bracket = GAME_STATE["playoffs_bracket"]
    if bracket.get("format") == "lpl":
        return _advance_playoffs_lpl(bracket)

    active_rounds = bracket["active_rounds"]
    qualified = bracket["qualified_teams"]

    active_matches = [m for m in bracket["matches"] if m["round"] in active_rounds]
    if not all(m["completed"] for m in active_matches):
        return

    def get_m(rnd):
        return next(m for m in active_matches if m["round"] == rnd)

    if active_rounds == ["ub_r1"]:
        m1, m2 = sorted(
            [m for m in active_matches if m["round"] == "ub_r1"],
            key=lambda m: m["match_number"]
        )
        bracket["ub_r1_losers"] = [_match_loser(m1), _match_loser(m2)]
        bracket["active_rounds"] = ["ub_final", "lb_r1"]
        bracket["matches"] += [
            _make_playoff_match("ub_final", 1, m1["winner"], m2["winner"]),
            _make_playoff_match("lb_r1",    1, qualified[4], qualified[5]),
        ]

    elif set(active_rounds) == {"ub_final", "lb_r1"}:
        ubf = get_m("ub_final")
        lb1 = get_m("lb_r1")
        bracket["ub_final_winner"] = ubf["winner"]
        bracket["ub_final_loser"]  = _match_loser(ubf)
        bracket["lb_r1_winner"]    = lb1["winner"]
        bracket["active_rounds"]   = ["lb_r2"]
        bracket["matches"].append(
            _make_playoff_match("lb_r2", 1, bracket["lb_r1_winner"], bracket["ub_r1_losers"][0])
        )

    elif active_rounds == ["lb_r2"]:
        lb2 = active_matches[0]
        bracket["lb_r2_winner"]  = lb2["winner"]
        bracket["active_rounds"] = ["lb_r3"]
        bracket["matches"].append(
            _make_playoff_match("lb_r3", 1, bracket["lb_r2_winner"], bracket["ub_r1_losers"][1])
        )

    elif active_rounds == ["lb_r3"]:
        lb3 = active_matches[0]
        bracket["lb_r3_winner"]  = lb3["winner"]
        bracket["active_rounds"] = ["lb_final"]
        bracket["matches"].append(
            _make_playoff_match("lb_final", 1, bracket["lb_r3_winner"], bracket["ub_final_loser"])
        )

    elif active_rounds == ["lb_final"]:
        lbf = active_matches[0]
        bracket["active_rounds"] = ["grand_final"]
        bracket["matches"].append(
            _make_playoff_match("grand_final", 1, bracket["ub_final_winner"], lbf["winner"])
        )

    elif active_rounds == ["grand_final"]:
        gf = active_matches[0]
        bracket["champion"]      = gf["winner"]
        bracket["active_rounds"] = []
        GAME_STATE["phase"]      = "offseason"

    return bracket

def _advance_playoffs_lpl(bracket: dict):
    """Advance LPL 10-team double-elimination bracket."""
    active_rounds = bracket["active_rounds"]
    qualified = bracket["qualified_teams"]

    active_matches = [m for m in bracket["matches"] if m["round"] in active_rounds]
    if not all(m["completed"] for m in active_matches):
        return bracket

    def sorted_ms(rnd):
        return sorted([m for m in active_matches if m["round"] == rnd], key=lambda m: m["match_number"])

    if set(active_rounds) == {"ub_r1", "lb_r1"}:
        ubr1 = sorted_ms("ub_r1")  # [#3v#6, #4v#5]
        lbr1 = sorted_ms("lb_r1")  # [#7v#10, #8v#9]
        bracket["ub_r1_winners"] = [m["winner"] for m in ubr1]
        bracket["ub_r1_losers"]  = [_match_loser(m) for m in ubr1]
        bracket["lb_r1_winners"] = [m["winner"] for m in lbr1]
        # UB R2: #1 vs W(#4v#5), #2 vs W(#3v#6)
        # LB R2: L(#3v#6) vs W(#8v#9), L(#4v#5) vs W(#7v#10)
        bracket["active_rounds"] = ["ub_r2", "lb_r2"]
        bracket["matches"] += [
            _make_playoff_match("ub_r2", 1, qualified[0], bracket["ub_r1_winners"][1]),  # #1 vs W(#4v#5)
            _make_playoff_match("ub_r2", 2, qualified[1], bracket["ub_r1_winners"][0]),  # #2 vs W(#3v#6)
            _make_playoff_match("lb_r2", 1, bracket["ub_r1_losers"][0], bracket["lb_r1_winners"][1]),
            _make_playoff_match("lb_r2", 2, bracket["ub_r1_losers"][1], bracket["lb_r1_winners"][0]),
        ]

    elif set(active_rounds) == {"ub_r2", "lb_r2"}:
        ubr2 = sorted_ms("ub_r2")
        lbr2 = sorted_ms("lb_r2")
        bracket["ub_r2_winners"] = [m["winner"] for m in ubr2]
        bracket["ub_r2_losers"]  = [_match_loser(m) for m in ubr2]
        bracket["lb_r2_winners"] = [m["winner"] for m in lbr2]
        # UB Final, LB R3: UBR2L vs LBR2W
        bracket["active_rounds"] = ["ub_final", "lb_r3"]
        bracket["matches"] += [
            _make_playoff_match("ub_final", 1, bracket["ub_r2_winners"][0], bracket["ub_r2_winners"][1]),
            _make_playoff_match("lb_r3", 1, bracket["ub_r2_losers"][0], bracket["lb_r2_winners"][1]),
            _make_playoff_match("lb_r3", 2, bracket["ub_r2_losers"][1], bracket["lb_r2_winners"][0]),
        ]

    elif set(active_rounds) == {"ub_final", "lb_r3"}:
        ubf  = next(m for m in active_matches if m["round"] == "ub_final")
        lbr3 = sorted_ms("lb_r3")
        bracket["ub_final_winner"] = ubf["winner"]
        bracket["ub_final_loser"]  = _match_loser(ubf)
        bracket["lb_r3_winners"]   = [m["winner"] for m in lbr3]
        bracket["active_rounds"]   = ["lb_sf"]
        bracket["matches"].append(
            _make_playoff_match("lb_sf", 1, bracket["lb_r3_winners"][0], bracket["lb_r3_winners"][1])
        )

    elif active_rounds == ["lb_sf"]:
        lbsf = active_matches[0]
        bracket["lb_sf_winner"]  = lbsf["winner"]
        bracket["active_rounds"] = ["lb_final"]
        bracket["matches"].append(
            _make_playoff_match("lb_final", 1, bracket["lb_sf_winner"], bracket["ub_final_loser"])
        )

    elif active_rounds == ["lb_final"]:
        lbf = active_matches[0]
        bracket["active_rounds"] = ["grand_final"]
        bracket["matches"].append(
            _make_playoff_match("grand_final", 1, bracket["ub_final_winner"], lbf["winner"])
        )

    elif active_rounds == ["grand_final"]:
        gf = active_matches[0]
        bracket["champion"]      = gf["winner"]
        bracket["active_rounds"] = []
        GAME_STATE["phase"]      = "offseason"

    return bracket

@api_router.get("/playoffs")
async def get_playoffs():
    """Get playoffs bracket and status."""
    if not GAME_STATE["initialized"]:
        ensure_initialized()

    if GAME_STATE["phase"] not in ["playoffs", "offseason"]:
        return {
            "active": False,
            "phase": GAME_STATE["phase"],
            "message": "Les playoffs n'ont pas encore commencé. Terminez la saison régulière (9 semaines)."
        }

    bracket = GAME_STATE["playoffs_bracket"]

    enriched_matches = []
    for match in bracket["matches"]:
        t1 = GAME_STATE["teams"].get(match["team1"], {})
        t2 = GAME_STATE["teams"].get(match["team2"], {})
        enriched_matches.append({
            **match,
            "team1_data": {"id": match["team1"], "name": t1.get("name"), "abbr": t1.get("abbr")},
            "team2_data": {"id": match["team2"], "name": t2.get("name"), "abbr": t2.get("abbr")},
        })

    champion_data = None
    if bracket.get("champion"):
        champ = GAME_STATE["teams"].get(bracket["champion"], {})
        champion_data = {"id": bracket["champion"], "name": champ.get("name"), "abbr": champ.get("abbr")}

    fmt = bracket.get("format", "standard")
    ub_count = 6 if fmt == "lpl" else 4

    return {
        "active": True,
        "phase": GAME_STATE["phase"],
        "format": fmt,
        "ub_count": ub_count,
        "active_rounds": bracket["active_rounds"],
        "qualified_teams": [
            {"id": tid, "name": GAME_STATE["teams"][tid]["name"],
             "abbr": GAME_STATE["teams"][tid]["abbr"], "seed": i + 1,
             "bracket": "UB" if i < ub_count else "LB"}
            for i, tid in enumerate(bracket["qualified_teams"])
        ],
        "matches": enriched_matches,
        "champion": champion_data,
    }

def _check_advance_after_match(bracket, match):
    """Trigger advance_playoffs if all matches in active rounds are now complete."""
    active_matches = [m for m in bracket["matches"] if m["round"] in bracket["active_rounds"]]
    if all(m["completed"] for m in active_matches):
        advance_playoffs()

@api_router.post("/playoffs/play")
async def play_playoffs_game(request: PlayoffsGameRequest):
    """Play a single game in a playoffs series."""
    if GAME_STATE["phase"] != "playoffs":
        raise HTTPException(status_code=400, detail="Les playoffs ne sont pas actifs")

    bracket = GAME_STATE["playoffs_bracket"]
    match = next((m for m in bracket["matches"] if m["id"] == request.match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Match non trouvé")
    if match["completed"]:
        raise HTTPException(status_code=400, detail="Cette série est déjà terminée")

    # Fearless: champions already played in this series cannot be picked
    fearless_used = _get_fearless_used(match)

    user_adv = 0.0
    if request.user_draft and GAME_STATE["user_team"] in [match["team1"], match["team2"]]:
        opponent_id = match["team2"] if match["team1"] == GAME_STATE["user_team"] else match["team1"]
        # Validate fearless rule on user picks
        for pick in (request.user_draft or {}).get("picks", []):
            champ = pick.get("champion", "")
            if champ and champ in fearless_used:
                raise HTTPException(status_code=400, detail=f"{champ} est interdit par la règle Fearless")
        user_adv = calculate_draft_advantage(request.user_draft, GAME_STATE["user_team"], opponent_id)

    t1p = calculate_team_power(match["team1"], user_adv if match["team1"] == GAME_STATE["user_team"] else 0, apply_tactics=match["team1"] == GAME_STATE["user_team"])
    t2p = calculate_team_power(match["team2"], user_adv if match["team2"] == GAME_STATE["user_team"] else 0, apply_tactics=match["team2"] == GAME_STATE["user_team"])
    result = simulate_match_phases(t1p, t2p)
    k1, k2 = generate_kill_totals(result["duration"], result["winner"] == 1)

    # Extract user draft picks for their side; AI side excludes fearless champs
    user_team = GAME_STATE["user_team"]
    is_t1_user = match["team1"] == user_team
    user_draft_picks  = (request.user_draft or {}).get("picks", [])       if request.user_draft else []
    enemy_draft_picks = (request.user_draft or {}).get("enemy_picks", []) if request.user_draft else []

    pg_t1 = generate_player_stats(
        match["team1"], result["winner"] == 1, result["duration"], k1, k2,
        draft_picks=user_draft_picks if is_t1_user else enemy_draft_picks,
        excluded=fearless_used,
    )
    t1_champs = {s["champion"] for s in pg_t1 if s.get("champion")}
    pg_t2 = generate_player_stats(
        match["team2"], result["winner"] == 2, result["duration"], k2, k1,
        draft_picks=user_draft_picks if not is_t1_user else enemy_draft_picks,
        excluded=fearless_used | t1_champs,
    )
    game_winner = match["team1"] if result["winner"] == 1 else match["team2"]
    game_result = {
        "game_number": len(match["games"]) + 1,
        "winner":      game_winner,
        "duration":    result["duration"],
        "team1_stats": pg_t1,
        "team2_stats": pg_t2,
        "phases": result["phases"],
        "events": result["events"],
    }
    ub = (request.user_draft or {}).get("bans", [])
    update_champ_stats(pg_t1, pg_t2, game_winner, match["team1"], ub)
    match["games"].append(game_result)

    # ELO + player evolution for this playoff game
    g_winner_id = game_winner
    g_loser_id  = match["team2"] if g_winner_id == match["team1"] else match["team1"]
    gw_stats = pg_t1 if g_winner_id == match["team1"] else pg_t2
    gl_stats = pg_t2 if g_winner_id == match["team1"] else pg_t1
    apply_match_result_updates(g_winner_id, g_loser_id, result, gw_stats, gl_stats, is_playoffs=True)

    # Update fearless_used list on the match for frontend display
    match["fearless_used"] = sorted(_get_fearless_used(match))

    if game_result["winner"] == match["team1"]:
        match["team1_wins"] += 1
    else:
        match["team2_wins"] += 1

    wins_needed = (match["best_of"] // 2) + 1
    if match["team1_wins"] >= wins_needed:
        match["winner"] = match["team1"]; match["completed"] = True
    elif match["team2_wins"] >= wins_needed:
        match["winner"] = match["team2"]; match["completed"] = True

    _check_advance_after_match(bracket, match)
    save_state()
    return {
        "game":             game_result,
        "series_score":     {"team1": match["team1_wins"], "team2": match["team2_wins"]},
        "series_completed": match["completed"],
        "series_winner":    match.get("winner"),
        "fearless_used":    match["fearless_used"],
        "active_rounds":    bracket["active_rounds"],
        "champion":         bracket.get("champion"),
    }

@api_router.post("/playoffs/simulate-match")
async def simulate_playoffs_match(request: PlayoffsGameRequest):
    """Simulate entire playoffs series (AI vs AI)."""
    if GAME_STATE["phase"] != "playoffs":
        raise HTTPException(status_code=400, detail="Les playoffs ne sont pas actifs")

    bracket = GAME_STATE["playoffs_bracket"]
    match = next((m for m in bracket["matches"] if m["id"] == request.match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Match non trouvé")
    if match["completed"]:
        raise HTTPException(status_code=400, detail="Cette série est déjà terminée")
    if GAME_STATE["user_team"] in [match["team1"], match["team2"]]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas simuler votre propre match")

    wins_needed = (match["best_of"] // 2) + 1
    while match["team1_wins"] < wins_needed and match["team2_wins"] < wins_needed:
        # Fearless: exclude all champions played in previous games of this series
        fearless_used = _get_fearless_used(match)

        t1p = calculate_team_power(match["team1"])
        t2p = calculate_team_power(match["team2"])
        result = simulate_match_phases(t1p, t2p)
        k1, k2 = generate_kill_totals(result["duration"], result["winner"] == 1)
        # Generate bans first so picked champions never overlap with banned ones
        game_bans = generate_auto_bans()
        excluded_set = fearless_used | set(game_bans)
        t1_stats = generate_player_stats(match["team1"], result["winner"] == 1, result["duration"], k1, k2, excluded=excluded_set)
        t1_champs_fs = {s["champion"] for s in t1_stats if s.get("champion")}
        game_result = {
            "game_number": len(match["games"]) + 1,
            "winner":      match["team1"] if result["winner"] == 1 else match["team2"],
            "duration":    result["duration"],
            "team1_stats": t1_stats,
            "team2_stats": generate_player_stats(match["team2"], result["winner"] == 2, result["duration"], k2, k1, excluded=excluded_set | t1_champs_fs),
            "phases": result["phases"],
            "events": result["events"],
        }
        update_champ_stats(game_result["team1_stats"], game_result["team2_stats"], game_result["winner"], match["team1"], game_bans)
        match["games"].append(game_result)
        pg_winner_id = game_result["winner"]
        pg_loser_id  = match["team2"] if pg_winner_id == match["team1"] else match["team1"]
        pgw_stats = game_result["team1_stats"] if pg_winner_id == match["team1"] else game_result["team2_stats"]
        pgl_stats = game_result["team2_stats"] if pg_winner_id == match["team1"] else game_result["team1_stats"]
        apply_match_result_updates(pg_winner_id, pg_loser_id, result, pgw_stats, pgl_stats, is_playoffs=True)
        if game_result["winner"] == match["team1"]:
            match["team1_wins"] += 1
        else:
            match["team2_wins"] += 1

    match["winner"] = match["team1"] if match["team1_wins"] >= wins_needed else match["team2"]
    match["completed"] = True
    match["fearless_used"] = sorted(_get_fearless_used(match))
    _check_advance_after_match(bracket, match)
    save_state()
    return {
        "series_score":     {"team1": match["team1_wins"], "team2": match["team2_wins"]},
        "series_completed": match["completed"],
        "series_winner":    match["winner"],
        "fearless_used":    match["fearless_used"],
        "active_rounds":    bracket["active_rounds"],
        "champion":         bracket.get("champion"),
    }

@api_router.post("/playoffs/start")
async def force_start_playoffs():
    """Start playoffs (called automatically after regular season, or manually)."""
    if GAME_STATE["phase"] == "playoffs":
        return {"success": False, "message": "Les playoffs sont déjà en cours"}
    start_playoffs()
    save_state()
    return {"success": True}

@api_router.post("/season/simulate")
async def simulate_full_season():
    """Simulate all remaining regular season matches (including user's) then start playoffs."""
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    if GAME_STATE["phase"] != "regular":
        raise HTTPException(status_code=400, detail="La saison régulière est déjà terminée")

    remaining = [m for m in GAME_STATE["schedule"] if not m["played"]]
    for match in remaining:
        t1p = calculate_team_power(match["team1"])
        t2p = calculate_team_power(match["team2"])
        result = simulate_match_phases(t1p, t2p)
        k1, k2 = generate_kill_totals(result["duration"], result["winner"] == 1)
        match["played"] = True
        match["score1"] = 1 if result["winner"] == 1 else 0
        match["score2"] = 1 if result["winner"] == 2 else 0
        match["winner"] = match["team1"] if result["winner"] == 1 else match["team2"]
        winner_id = match["winner"]
        loser_id  = match["team2"] if winner_id == match["team1"] else match["team1"]
        GAME_STATE["teams"][winner_id]["wins"]   += 1
        GAME_STATE["teams"][loser_id]["losses"]  += 1
        auto_bans = generate_auto_bans()
        bans_set = set(auto_bans)
        st1 = generate_player_stats(match["team1"], result["winner"] == 1, result["duration"], k1, k2, excluded=bans_set)
        st2 = generate_player_stats(match["team2"], result["winner"] == 2, result["duration"], k2, k1, excluded=bans_set | {s["champion"] for s in st1 if s.get("champion")})
        match["match_details"] = {**result, "team1_stats": st1, "team2_stats": st2, "bans": auto_bans}
        update_champ_stats(st1, st2, match["winner"], match["team1"], auto_bans)
        sw_stats = st1 if winner_id == match["team1"] else st2
        sl_stats = st2 if winner_id == match["team1"] else st1
        apply_match_result_updates(winner_id, loser_id, result, sw_stats, sl_stats)

    GAME_STATE["current_week"] = 10
    start_playoffs()
    save_state()
    return {"success": True, "message": f"{len(remaining)} matchs simulés. Playoffs lancés!"}

# ============ END PLAYOFFS SYSTEM ============

@api_router.post("/match/simulate")
async def simulate_match(request: SimulateMatchRequest, http_request: Request):
    """Simulate a specific match"""
    if GAME_STATE.get("phase") == "preseason":
        raise HTTPException(status_code=400, detail="Lancez la saison depuis la page Négociations avant de jouer des matchs")
    match = next((m for m in GAME_STATE["schedule"] if m["id"] == request.match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if match["played"]:
        raise HTTPException(status_code=400, detail="Match already played")
    
    # Calculate draft advantage for BOTH sides — in MP PvP both teams are
    # human-controlled, so side 2 must also benefit from its own picks/bans.
    # In solo, only user_team ever has a draft; the opponent gets 0 as before.
    user_team = GAME_STATE["user_team"]
    mp_humans = set(GAME_STATE.get("_mp_user_team_ids") or [])
    draft_state = GAME_STATE.get("draft_state") or {}
    body_draft = request.user_draft or None

    def _draft_adv_for(team_id: str) -> float:
        """Pick the draft payload relevant to `team_id` and compute its advantage."""
        opponent_id = match["team2"] if match["team1"] == team_id else match["team1"]
        # Prefer the request body when the caller IS this team's user.
        if body_draft and team_id == user_team:
            return calculate_draft_advantage(body_draft, team_id, opponent_id)
        # MP PvP: reconciled draft_state stores side-1 as user_*, side-2 as enemy_*.
        side1 = draft_state.get("_mp_side1_team")
        side2 = draft_state.get("_mp_side2_team")
        if team_id in mp_humans and side1 and side2:
            if team_id == side1:
                payload = {
                    "picks": draft_state.get("user_picks", []),
                    "bans":  draft_state.get("user_bans",  []),
                    "enemy_picks": draft_state.get("enemy_picks", []),
                    "enemy_bans":  draft_state.get("enemy_bans",  []),
                }
            elif team_id == side2:
                payload = {
                    "picks": draft_state.get("enemy_picks", []),
                    "bans":  draft_state.get("enemy_bans",  []),
                    "enemy_picks": draft_state.get("user_picks", []),
                    "enemy_bans":  draft_state.get("user_bans",  []),
                }
            else:
                return 0.0
            return calculate_draft_advantage(payload, team_id, opponent_id)
        return 0.0

    team1_adv = _draft_adv_for(match["team1"]) if match["team1"] in (mp_humans | {user_team}) else 0.0
    team2_adv = _draft_adv_for(match["team2"]) if match["team2"] in (mp_humans | {user_team}) else 0.0

    team1_power = calculate_team_power(match["team1"],
                                       team1_adv,
                                       apply_tactics=match["team1"] == user_team or match["team1"] in mp_humans)
    team2_power = calculate_team_power(match["team2"],
                                       team2_adv,
                                       apply_tactics=match["team2"] == user_team or match["team2"] in mp_humans)

    result = simulate_match_phases(team1_power, team2_power)

    match["played"] = True
    match["score1"] = 1 if result["winner"] == 1 else 0
    match["score2"] = 1 if result["winner"] == 2 else 0
    match["winner"] = match["team1"] if result["winner"] == 1 else match["team2"]

    # Update team records
    winner_id = match["winner"]
    loser_id = match["team2"] if winner_id == match["team1"] else match["team1"]
    GAME_STATE["teams"][winner_id]["wins"] += 1
    GAME_STATE["teams"][loser_id]["losses"] += 1

    # Resolve draft picks for champion assignments (needed before ELO update call below)
    user_team = GAME_STATE["user_team"]
    draft = GAME_STATE.get("draft_state") or {}
    user_picks  = (request.user_draft or {}).get("picks", [])       or draft.get("user_picks", [])
    enemy_picks = (request.user_draft or {}).get("enemy_picks", []) or draft.get("enemy_picks", [])

    def picks_for(team_id):
        if team_id == user_team:
            return user_picks
        # enemy is the other team in this match
        opp_id = match["team2"] if match["team1"] == user_team else match["team1"]
        if team_id == opp_id:
            return enemy_picks
        return []

    # Generate detailed match info — generate team1 first, then exclude its champions from team2
    k1, k2 = generate_kill_totals(result["duration"], result["winner"] == 1)
    team1_stats = generate_player_stats(match["team1"], result["winner"] == 1, result["duration"], k1, k2, picks_for(match["team1"]))
    team1_champs = {p["champion"] for p in team1_stats if p.get("champion")}
    team2_picks = picks_for(match["team2"])
    # Inject team1 champs as already-used so team2 doesn't duplicate them
    team2_stats = generate_player_stats(match["team2"], result["winner"] == 2, result["duration"], k2, k1, team2_picks, excluded=team1_champs)
    user_bans  = (request.user_draft or {}).get("bans", [])
    enemy_bans = (GAME_STATE.get("draft_state") or {}).get("enemy_bans", [])
    all_bans   = user_bans + enemy_bans

    # Dense event feed + per-minute gold snapshots for the animated timeline
    detailed_events, gold_timeline = generate_detailed_events(
        phases=result.get("phases", []),
        team1_stats=team1_stats,
        team2_stats=team2_stats,
        duration=result.get("duration", 30),
        winner=result.get("winner", 1),
        base_events=result.get("events", []),
    )
    result = {**result, "events": detailed_events, "gold_timeline": gold_timeline}

    match["match_details"] = {**result, "team1_stats": team1_stats, "team2_stats": team2_stats, "bans": all_bans}
    update_champ_stats(team1_stats, team2_stats, winner_id, match["team1"], all_bans)

    # ELO update + player performance evolution
    w_stats = team1_stats if winner_id == match["team1"] else team2_stats
    l_stats = team2_stats if winner_id == match["team1"] else team1_stats
    apply_match_result_updates(winner_id, loser_id, result, w_stats, l_stats, week=match.get("week"))
    _generate_match_inbox_messages(winner_id, loser_id, result, w_stats=w_stats, l_stats=l_stats, week=match.get("week"))

    # Simulate other matches of the same week AND same day only.
    # On ne simule plus les 2 jours d'un coup : le joueur fait son match du jour 1,
    # les autres équipes jouent leur jour 1, puis le joueur enchaîne sur le jour 2.
    # En mode MP, on exclut TOUS les matchs qui impliquent n'importe quelle
    # équipe choisie par un joueur de la session — sinon le joueur A qui simule
    # son match auto-simulerait aussi le match de B (et B se retrouverait avec
    # un résultat imposé sans avoir joué sa draft).
    current_week = match["week"]
    current_day = match.get("day")
    # Fallback sauvegardes pré-"day" : déduire le jour depuis les matchs joués de la semaine.
    if current_day is None:
        week_played = sum(1 for m in GAME_STATE["schedule"]
                          if m["week"] == current_week and m["played"]
                          and GAME_STATE["user_team"] in (m["team1"], m["team2"]))
        current_day = 1 if week_played == 0 else 2
    other_results = []
    mp_player_teams: set = set()
    _sid = http_request.query_params.get("session_id")
    if _sid:
        _sess = _sessions.get_session(_sid)
        if _sess is not None:
            mp_player_teams = {tid for tid in _sess.players.values() if tid}
    # Toujours inclure user_team (cas solo + filet pour le caller MP)
    mp_player_teams.add(GAME_STATE["user_team"])

    for other_match in GAME_STATE["schedule"]:
        if other_match["week"] != current_week or other_match["played"]:
            continue
        # Ne simule que les matchs du même game day
        if other_match.get("day", current_day) != current_day:
            continue
        if mp_player_teams & {other_match["team1"], other_match["team2"]}:
            continue
        t1_power = calculate_team_power(other_match["team1"])
        t2_power = calculate_team_power(other_match["team2"])
        other_result = simulate_match_phases(t1_power, t2_power)
        other_match["played"] = True
        other_match["score1"] = 1 if other_result["winner"] == 1 else 0
        other_match["score2"] = 1 if other_result["winner"] == 2 else 0
        other_match["winner"] = other_match["team1"] if other_result["winner"] == 1 else other_match["team2"]
        w_id = other_match["winner"]
        l_id = other_match["team2"] if w_id == other_match["team1"] else other_match["team1"]
        GAME_STATE["teams"][w_id]["wins"] += 1
        GAME_STATE["teams"][l_id]["losses"] += 1
        ok1, ok2 = generate_kill_totals(other_result["duration"], other_result["winner"] == 1)
        other_bans = generate_auto_bans()
        other_bans_set = set(other_bans)
        ot1_stats = generate_player_stats(other_match["team1"], other_result["winner"] == 1, other_result["duration"], ok1, ok2, excluded=other_bans_set)
        ot2_stats = generate_player_stats(other_match["team2"], other_result["winner"] == 2, other_result["duration"], ok2, ok1, excluded=other_bans_set | {s["champion"] for s in ot1_stats if s.get("champion")})
        other_match["match_details"] = {**other_result, "team1_stats": ot1_stats, "team2_stats": ot2_stats, "bans": other_bans}
        update_champ_stats(ot1_stats, ot2_stats, other_match["winner"], other_match["team1"], other_bans)
        ow_stats = ot1_stats if w_id == other_match["team1"] else ot2_stats
        ol_stats = ot2_stats if w_id == other_match["team1"] else ot1_stats
        apply_match_result_updates(w_id, l_id, other_result, ow_stats, ol_stats, week=other_match.get("week"))
        other_results.append(other_match)

    # Advance week if all matches are now played
    week_incomplete = any(m for m in GAME_STATE["schedule"] if m["week"] == current_week and not m["played"])
    if not week_incomplete:
        GAME_STATE["current_week"] += 1
        if GAME_STATE["phase"] == "regular":
            _simulate_intl_week(current_week)
        if GAME_STATE["current_week"] > 9 and GAME_STATE["phase"] == "regular":
            start_playoffs()
        elif GAME_STATE["phase"] == "regular":
            new_week = GAME_STATE["current_week"]
            _generate_weekly_board_message(new_week)
            # Youth scouting report at weeks 3 and 7
            if new_week in (3, 7):
                _generate_youth_scouting_report(new_week)

    GAME_STATE["draft_state"] = {
        "step": 0,
        "phase": "ban1",
        "current_turn": "user",
        "user_bans": [],
        "enemy_bans": [],
        "user_picks": [],
        "enemy_picks": [],
        "banned_champions": [],
        "picked_champions": [],
        "user_picked_champions": [],
        "enemy_picked_champions": [],
        "fearless_excluded": [],
    }  # B5: clear draft state after match completion
    save_state()
    return {**match, "other_results": other_results, "week_complete": not week_incomplete, "current_week": GAME_STATE["current_week"], "phase": GAME_STATE["phase"]}

@api_router.post("/week/simulate")
async def simulate_week():
    """Simulate all matches in current week"""
    if not GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="No team selected")
    if GAME_STATE.get("phase") == "preseason":
        raise HTTPException(status_code=400, detail="Lancez la saison depuis la page Négociations avant de jouer des matchs")
    
    current_week = GAME_STATE["current_week"]
    week_matches = [m for m in GAME_STATE["schedule"] if m["week"] == current_week and not m["played"]]
    
    results = []
    for match in week_matches:
        # Skip user matches - they should be played manually
        if GAME_STATE["user_team"] in [match["team1"], match["team2"]]:
            continue
        
        team1_power = calculate_team_power(match["team1"])
        team2_power = calculate_team_power(match["team2"])
        result = simulate_match_phases(team1_power, team2_power)
        
        match["played"] = True
        match["score1"] = 1 if result["winner"] == 1 else 0
        match["score2"] = 1 if result["winner"] == 2 else 0
        match["winner"] = match["team1"] if result["winner"] == 1 else match["team2"]
        
        winner_id = match["winner"]
        loser_id = match["team2"] if winner_id == match["team1"] else match["team1"]
        GAME_STATE["teams"][winner_id]["wins"] += 1
        GAME_STATE["teams"][loser_id]["losses"] += 1

        wk1, wk2 = generate_kill_totals(result["duration"], result["winner"] == 1)
        week_bans = generate_auto_bans()
        week_bans_set = set(week_bans)
        wt1_stats = generate_player_stats(match["team1"], result["winner"] == 1, result["duration"], wk1, wk2, excluded=week_bans_set)
        wt2_stats = generate_player_stats(match["team2"], result["winner"] == 2, result["duration"], wk2, wk1, excluded=week_bans_set | {s["champion"] for s in wt1_stats if s.get("champion")})
        match["match_details"] = {**result, "team1_stats": wt1_stats, "team2_stats": wt2_stats, "bans": week_bans}
        update_champ_stats(wt1_stats, wt2_stats, match["winner"], match["team1"], week_bans)
        ww_stats = wt1_stats if winner_id == match["team1"] else wt2_stats
        wl_stats = wt2_stats if winner_id == match["team1"] else wt1_stats
        apply_match_result_updates(winner_id, loser_id, result, ww_stats, wl_stats, week=match.get("week"))
        results.append(match)
    
    # Check if week is complete
    week_incomplete = any(m for m in GAME_STATE["schedule"] if m["week"] == current_week and not m["played"])
    if not week_incomplete:
        GAME_STATE["current_week"] += 1
        if GAME_STATE["phase"] == "regular":
            _simulate_intl_week(current_week)
        # Check if regular season is over (9 weeks) - Start playoffs
        if GAME_STATE["current_week"] > 9 and GAME_STATE["phase"] == "regular":
            start_playoffs()
    
    save_state()
    return {"results": results, "week_complete": not week_incomplete, "current_week": GAME_STATE["current_week"], "phase": GAME_STATE["phase"]}

# Negotiations

@api_router.get("/negotiations/available")
async def get_available_players():
    """Get players available for negotiation (from other teams)"""
    if not GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="No team selected")
    if GAME_STATE.get("phase") != "preseason":
        raise HTTPException(status_code=403, detail="Negotiations are only open during preseason/offseason")
    
    # Seed price per (player_id, season, split) so it stays stable across refreshes
    season = GAME_STATE.get("season", 2026)
    split_num = GAME_STATE.get("current_split", 1)

    available = []
    for player in GAME_STATE["players"].values():
        if player["team_id"] != GAME_STATE["user_team"]:
            team = GAME_STATE["teams"][player["team_id"]]
            price_seed = hash((player["id"], season, split_num)) & 0xFFFFFFFF
            price_rng = random.Random(price_seed)
            asking_price = int(player["transfer_value"] * price_rng.uniform(1.0, 1.5))
            available.append({
                **player,
                "team_name": team["name"],
                "team_abbr": team["abbr"],
                "asking_price": asking_price,
            })

    return available


def _find_coherent_replacement(sold_player: dict, team_id: str) -> dict:
    """Find a coherent replacement for a sold player.

    Priority order:
    1. ERL pool — same position, rating closest to sold player
    2. League free agents — non-starter players from other teams, same position, closest rating
    3. Generated newgen — same position, rating calibrated to sold player's level
    """
    pos = sold_player.get("position", "MID")
    sold_rating = sold_player.get("rating", 75)
    active_league = GAME_STATE.get("league", "LEC")
    user_team_id = GAME_STATE.get("user_team")

    def proximity_score(p):
        rating_diff = abs(p.get("rating", 70) - sold_rating)
        pot_bonus = -2 if p.get("potential", 0) >= 80 else 0
        return rating_diff + pot_bonus

    # 1 — ERL pool
    erl_candidates = [
        p for p in GAME_STATE.get("erl_players", {}).values()
        if p.get("position") == pos
    ]
    if erl_candidates:
        erl_candidates.sort(key=proximity_score)
        best = erl_candidates[0]
        new_pid = str(uuid.uuid4())
        replacement = {
            **best,
            "id": new_pid,
            "team_id": team_id,
            "is_starter": True,
            "avg_perf": None,
            "match_history": [],
        }
        if best["id"] in GAME_STATE["erl_players"]:
            del GAME_STATE["erl_players"][best["id"]]
        return replacement

    # 2 — Non-starter players from other AI teams in the league (free agent market)
    league_candidates = [
        p for p in GAME_STATE.get("players", {}).values()
        if p.get("position") == pos
        and not p.get("is_starter", True)
        and p.get("team_id") != team_id
        and p.get("team_id") != user_team_id
    ]
    if league_candidates:
        league_candidates.sort(key=proximity_score)
        best = league_candidates[0]
        old_team = GAME_STATE["teams"].get(best["team_id"])
        if old_team and best["id"] in old_team.get("roster", []):
            old_team["roster"].remove(best["id"])
        best["team_id"] = team_id
        best["is_starter"] = True
        best["avg_perf"] = None
        best["match_history"] = []
        return best

    # 3 — Calibrated newgen fallback
    replacement_data = generate_newgen(active_league)
    replacement_data["position"] = pos
    target_rating = max(55, min(92, sold_rating + random.randint(-10, 5)))
    replacement_data["rating"] = target_rating
    replacement_data["potential"] = max(target_rating, target_rating + random.randint(0, 10))
    replacement_data["scouting_for"] = active_league
    replacement = generate_erl_player(replacement_data)
    replacement["team_id"] = team_id
    replacement["is_starter"] = True
    replacement["avg_perf"] = None
    replacement["match_history"] = []
    return replacement


def _is_human_team(team_id: str) -> bool:
    """True if this team is controlled by a human user in the current session."""
    humans = GAME_STATE.get("_mp_user_team_ids") or []
    return bool(team_id) and team_id in humans


def _execute_transfer(player: dict, buyer_team_id: str, offered_amount: int,
                      contract_years: int, swap_player_id: str | None) -> tuple[dict, str | None]:
    """Move player to buyer_team, pay seller, handle swap + replacement.

    Returns (transferred_player, swapped_out_name). Assumes validation done.
    """
    old_team_id = player["team_id"]
    old_team = GAME_STATE["teams"][old_team_id]
    buyer_team = GAME_STATE["teams"][buyer_team_id]

    old_team["roster"].remove(player["id"])
    old_team["budget"] += offered_amount

    player["team_id"] = buyer_team_id
    player["salary"] = int(offered_amount * TRANSFER_SALARY_PCT)
    player["contract_years"] = contract_years
    player["is_starter"] = True

    buyer_team["roster"].append(player["id"])
    buyer_team["budget"] -= offered_amount

    swapped_out_name = None
    if swap_player_id:
        swap_target = GAME_STATE["players"].get(swap_player_id)
        if swap_target and swap_target["team_id"] == buyer_team_id:
            swap_target["is_starter"] = False
            swapped_out_name = swap_target.get("name")

    # Replacement only when the seller is an AI team. Humans manage their own roster.
    if not _is_human_team(old_team_id):
        replacement = _find_coherent_replacement(player, old_team_id)
        GAME_STATE["players"][replacement["id"]] = replacement
        old_team["roster"].append(replacement["id"])

    GAME_STATE.setdefault("mercato_recap", []).append({
        "player": player["name"],
        "position": player["position"],
        "rating": player["rating"],
        "amount": offered_amount,
        "buyer": buyer_team_id,
        "seller": old_team.get("abbr", old_team_id),
    })
    return player, swapped_out_name


def _find_pending(pid: str) -> dict | None:
    for n in GAME_STATE.get("pending_negotiations", []):
        if n.get("id") == pid:
            return n
    return None


def _remove_pending(pid: str) -> None:
    GAME_STATE["pending_negotiations"] = [
        n for n in GAME_STATE.get("pending_negotiations", [])
        if n.get("id") != pid
    ]


@api_router.post("/negotiations/offer")
async def make_offer(offer: NegotiationOffer):
    """Make a transfer offer for a player.

    If the target belongs to another human user (multi), creates a pending
    negotiation + inbox message and returns pending=True without transferring.
    Otherwise falls back to the AI decision flow (solo or IA target in multi).
    """
    if not GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="No team selected")
    if GAME_STATE.get("phase") != "preseason":
        raise HTTPException(status_code=403, detail="Negotiations are only open during preseason/offseason")

    player = GAME_STATE["players"].get(offer.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    if player["team_id"] == GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="Player already on your team")

    user_team = GAME_STATE["teams"][GAME_STATE["user_team"]]
    if offer.offered_amount > user_team["budget"]:
        raise HTTPException(status_code=400, detail="Insufficient budget")

    target_team_id = player["team_id"]
    target_team = GAME_STATE["teams"][target_team_id]

    # Human-vs-human: create pending offer and notify via inbox.
    # Counter-offer acceptances from a human target still take this path
    # — the accept endpoint is what finalises the transfer.
    if _is_human_team(target_team_id) and not offer.is_counter_offer:
        pending = {
            "id": str(uuid.uuid4()),
            "status": "pending",
            "direction": "incoming",  # from the target's perspective
            "from_team_id": GAME_STATE["user_team"],
            "to_team_id": target_team_id,
            "player_id": player["id"],
            "player_name": player["name"],
            "player_position": player["position"],
            "player_rating": player["rating"],
            "offered_amount": offer.offered_amount,
            "contract_years": offer.contract_years,
            "swap_player_id": offer.player_to_swap_id,
            "counter_amount": None,
            "created_week": GAME_STATE.get("current_week", 0),
            "created_season": GAME_STATE.get("season"),
            "created_split": GAME_STATE.get("current_split"),
        }
        GAME_STATE.setdefault("pending_negotiations", []).append(pending)
        _add_inbox_message(
            msg_type="transfer_offer",
            sender=user_team.get("name", "Autre équipe"),
            subject=f"Offre pour {player['name']}",
            body=(
                f"{user_team.get('name', '?')} propose {offer.offered_amount:,}€ "
                f"sur {offer.contract_years} an(s) pour {player['name']} "
                f"({player['position']}, {player['rating']})."
            ),
        )
        save_state()
        return {
            "success": True,
            "accepted": False,
            "pending": True,
            "negotiation_id": pending["id"],
            "message": f"Offre envoyée à {target_team.get('name', '?')}. En attente de réponse.",
        }

    # AI decision based on offer vs player value
    base_value = player["transfer_value"]
    offer_ratio = offer.offered_amount / base_value
    
    # Factors affecting acceptance
    acceptance_chance = TRANSFER_ACCEPT_BASE
    if offer_ratio >= TRANSFER_ACCEPT_RATIO_HIGH:
        acceptance_chance = 0.9
    elif offer_ratio >= TRANSFER_ACCEPT_RATIO_MID:
        acceptance_chance = 0.7
    elif offer_ratio >= TRANSFER_ACCEPT_RATIO_FAIR:
        acceptance_chance = 0.5
    elif offer_ratio >= TRANSFER_ACCEPT_RATIO_LOW:
        acceptance_chance = 0.2
    
    # Player importance affects willingness to sell
    if player["is_starter"]:
        acceptance_chance *= 0.7
    if player["rating"] > 85:
        acceptance_chance *= 0.6

    # Counter-offer acceptances are always honoured — the club named its price
    accepted = True if offer.is_counter_offer else random.random() < acceptance_chance
    
    if accepted:
        player, swapped_out_name = _execute_transfer(
            player=player,
            buyer_team_id=GAME_STATE["user_team"],
            offered_amount=offer.offered_amount,
            contract_years=offer.contract_years,
            swap_player_id=offer.player_to_swap_id,
        )
        save_state()
        msg = f"{player['name']} a rejoint votre équipe !"
        if swapped_out_name:
            msg += f" {swapped_out_name} passe remplaçant."
        return {
            "success": True,
            "accepted": True,
            "message": msg,
            "player": player,
            "new_budget": user_team["budget"]
        }
    else:
        # Counter offer or rejection
        if offer_ratio < 0.7:
            return {
                "success": True,
                "accepted": False,
                "message": f"Offer rejected. {GAME_STATE['teams'][player['team_id']]['name']} finds this offer insulting.",
                "counter_offer": None
            }
        else:
            counter_amount = int(base_value * random.uniform(1.2, 1.6))
            return {
                "success": True,
                "accepted": False,
                "message": f"Offer rejected, but they're open to negotiation.",
                "counter_offer": {
                    "amount": counter_amount,
                    "message": f"We would consider {counter_amount:,} for {player['name']}"
                }
            }


# ── User-to-user pending negotiations ────────────────────────────────────────

def _pending_view(n: dict) -> dict:
    """Enrich a pending negotiation with team names for the client."""
    from_team = GAME_STATE["teams"].get(n.get("from_team_id"), {})
    to_team = GAME_STATE["teams"].get(n.get("to_team_id"), {})
    player = GAME_STATE["players"].get(n.get("player_id"), {})
    return {
        **n,
        "from_team_name": from_team.get("name"),
        "from_team_abbr": from_team.get("abbr"),
        "to_team_name": to_team.get("name"),
        "to_team_abbr": to_team.get("abbr"),
        "player_still_available": bool(player) and player.get("team_id") == n.get("to_team_id"),
    }


@api_router.get("/negotiations/pending")
async def list_pending_negotiations():
    """Pending offers for the current user's team (incoming + outgoing)."""
    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        raise HTTPException(status_code=400, detail="No team selected")

    pendings = GAME_STATE.get("pending_negotiations", [])
    incoming = [_pending_view(n) for n in pendings if n.get("to_team_id") == user_team_id]
    outgoing = [_pending_view(n) for n in pendings if n.get("from_team_id") == user_team_id]
    return {"incoming": incoming, "outgoing": outgoing}


@api_router.post("/negotiations/{negotiation_id}/accept")
async def accept_pending_negotiation(negotiation_id: str):
    """Target user accepts an incoming offer → transfer executes now."""
    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        raise HTTPException(status_code=400, detail="No team selected")

    neg = _find_pending(negotiation_id)
    if not neg:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if neg.get("to_team_id") != user_team_id:
        raise HTTPException(status_code=403, detail="Cette offre ne vous est pas destinée")

    player = GAME_STATE["players"].get(neg["player_id"])
    if not player or player.get("team_id") != user_team_id:
        _remove_pending(negotiation_id)
        raise HTTPException(status_code=409, detail="Le joueur n'est plus dans votre effectif")

    buyer_team_id = neg["from_team_id"]
    buyer_team = GAME_STATE["teams"].get(buyer_team_id)
    if not buyer_team:
        _remove_pending(negotiation_id)
        raise HTTPException(status_code=409, detail="Équipe acheteuse introuvable")

    offered = int(neg.get("offered_amount", 0))
    if offered > buyer_team.get("budget", 0):
        _remove_pending(negotiation_id)
        _add_inbox_message(
            msg_type="transfer_offer",
            sender=GAME_STATE["teams"][user_team_id].get("name", "?"),
            subject=f"Offre annulée pour {player['name']}",
            body=f"L'acheteur n'a plus le budget nécessaire. Offre annulée.",
        )
        save_state()
        raise HTTPException(status_code=409, detail="L'acheteur n'a plus le budget nécessaire")

    player, _swapped = _execute_transfer(
        player=player,
        buyer_team_id=buyer_team_id,
        offered_amount=offered,
        contract_years=int(neg.get("contract_years", 2)),
        swap_player_id=neg.get("swap_player_id"),
    )
    _remove_pending(negotiation_id)

    seller_name = GAME_STATE["teams"][user_team_id].get("name", "?")
    _add_inbox_message(
        msg_type="transfer_offer",
        sender=seller_name,
        subject=f"{player['name']} — transfert accepté",
        body=f"{seller_name} accepte votre offre de {offered:,}€ pour {player['name']}.",
    )
    save_state()
    return {"success": True, "accepted": True, "player": player}


@api_router.post("/negotiations/{negotiation_id}/reject")
async def reject_pending_negotiation(negotiation_id: str):
    """Target user rejects — offer disappears, no money moves (none was held)."""
    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        raise HTTPException(status_code=400, detail="No team selected")

    neg = _find_pending(negotiation_id)
    if not neg:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if neg.get("to_team_id") != user_team_id:
        raise HTTPException(status_code=403, detail="Cette offre ne vous est pas destinée")

    seller_name = GAME_STATE["teams"][user_team_id].get("name", "?")
    player_name = neg.get("player_name", "?")
    _remove_pending(negotiation_id)
    _add_inbox_message(
        msg_type="transfer_offer",
        sender=seller_name,
        subject=f"Offre refusée pour {player_name}",
        body=f"{seller_name} refuse votre offre pour {player_name}.",
    )
    save_state()
    return {"success": True, "accepted": False}


@api_router.post("/negotiations/{negotiation_id}/counter")
async def counter_pending_negotiation(negotiation_id: str, body: CounterOfferBody):
    """Target user proposes a new price. The offer flips direction:
    now the original buyer sees it as 'incoming' and can accept/reject.
    """
    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        raise HTTPException(status_code=400, detail="No team selected")

    neg = _find_pending(negotiation_id)
    if not neg:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if neg.get("to_team_id") != user_team_id:
        raise HTTPException(status_code=403, detail="Cette offre ne vous est pas destinée")

    # Flip: seller becomes the sender, buyer becomes the recipient.
    original_buyer = neg["from_team_id"]
    original_seller = neg["to_team_id"]
    neg["from_team_id"] = original_seller
    neg["to_team_id"] = original_buyer
    neg["offered_amount"] = int(body.counter_amount)
    neg["counter_amount"] = int(body.counter_amount)
    neg["status"] = "countered"

    seller_name = GAME_STATE["teams"][original_seller].get("name", "?")
    _add_inbox_message(
        msg_type="transfer_offer",
        sender=seller_name,
        subject=f"Contre-offre pour {neg.get('player_name', '?')}",
        body=(
            f"{seller_name} propose {body.counter_amount:,}€ pour "
            f"{neg.get('player_name', '?')}."
        ),
    )
    save_state()
    return {"success": True, "negotiation": _pending_view(neg)}


@api_router.post("/negotiations/{negotiation_id}/withdraw")
async def withdraw_pending_negotiation(negotiation_id: str):
    """Sender cancels their own outgoing offer before the target responds."""
    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        raise HTTPException(status_code=400, detail="No team selected")

    neg = _find_pending(negotiation_id)
    if not neg:
        raise HTTPException(status_code=404, detail="Offre introuvable")
    if neg.get("from_team_id") != user_team_id:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut retirer l'offre")

    _remove_pending(negotiation_id)
    save_state()
    return {"success": True}


# Draft System

@api_router.get("/draft/champions")
async def get_draft_champions(league: str | None = None):
    """Get all available champions for draft with meta stats.

    If `league` is provided, returns that league's baseline meta (useful for
    multiplayer sessions on a different league than the active solo save).
    """
    if league:
        return LEAGUE_META_CHAMPIONS.get(league, LEAGUE_META_CHAMPIONS.get("LEC", META_CHAMPIONS))
    _sync_state_if_stale()
    return get_meta_champions()


@api_router.get("/meta/stats")
async def get_meta_stats():
    """Get meta statistics from LEC 2026 Versus Season"""
    return {
        "tournament": "LEC 2026 Versus Season",
        "total_games": TOTAL_GAMES,
        "draft_mode": "Fearless Draft",
        "avg_game_duration": "33:33",
        "avg_kills_per_game": 28,
        "top_kda_players": PLAYER_META_STATS,
        "champions_by_position": {
            pos: [
                {
                    "name": c["name"],
                    "picks": c["picks"],
                    "bans": c["bans"],
                    "winrate": c["winrate"],
                    "tier": c["tier"],
                    "presence": round((c["picks"] + c["bans"]) / TOTAL_GAMES * 100, 1)
                }
                for c in champs
            ]
            for pos, champs in get_meta_champions().items()
        }
    }


def _compute_draft_suggestions(
    action_type: str,
    step: int,
    my_picks: list,
    enemy_picks: list,
    unavailable: set,
    needed: list,
    opp_id: str | None,
) -> list:
    """Shared suggestion logic — usable by solo and MP drafts."""
    opp_pool     = _get_team_champ_pool(opp_id) if opp_id else set()

    if action_type == "ban":
        enemy_needed = set(needed)
        opp_pool_by_pos = _get_team_champ_pool_by_pos(opp_id) if opp_id else {}

        candidates = []
        for name, meta in META_LOOKUP.items():
            if name in unavailable:
                continue
            tier     = meta.get("tier", "C")
            presence = meta.get("presence", 0.0)
            wr       = meta.get("winrate", 50.0)
            weight   = presence * 0.4 + wr * 0.2
            weight  += {"S": 18, "A": 9, "B": 3, "C": 0}.get(tier, 0)
            in_pool  = name in opp_pool

            pool_pos = next((pos for pos, champs in opp_pool_by_pos.items() if name in champs), None)
            fills_needed = pool_pos in enemy_needed if pool_pos else False

            if fills_needed:
                weight += 12
            if fills_needed and in_pool:
                weight += 18
            elif in_pool:
                weight += 12

            parts = []
            if tier == "S": parts.append("S-tier")
            if in_pool and pool_pos:
                parts.append(f"pool {pool_pos} adverse")
            elif in_pool:
                parts.append("dans le pool adverse")
            if wr > 58: parts.append(f"{wr:.0f}% WR")
            candidates.append({
                "champion": name, "position": pool_pos or meta.get("position", ""),
                "score": round(weight, 1),
                "reason": " · ".join(parts) or "Forte présence méta",
            })
        candidates.sort(key=lambda x: -x["score"])
        return candidates[:5]

    # pick
    candidates = []
    for pos in needed:
        for champ in get_meta_champions().get(pos, []):
            name = champ["name"]
            if name in unavailable:
                continue
            score      = delta_analyzer(name, pos, my_picks, enemy_picks, needed, step)
            comp_gain  = comp_score(my_picks + [{"champion": name, "position": pos}]) - comp_score(my_picks)
            countered  = COUNTER_MAP.get(name, set()) & {p.get("champion","") for p in enemy_picks if isinstance(p, dict)}
            tier       = META_LOOKUP.get(name, {}).get("tier", "C")
            parts      = []
            if tier == "S":      parts.append("S-tier")
            if countered:        parts.append(f"Counter {', '.join(countered)}")
            if comp_gain > 6:    parts.append("Renforce la compo")
            my_names = {p.get("champion","") for p in my_picks if isinstance(p, dict)}
            syn_champs = {nm for pair, _ in SYNERGY_PAIRS
                          for nm in pair if name in pair
                          and (pair - {name}).issubset(my_names)}
            if syn_champs:
                parts.append(f"Synergie {', '.join(syn_champs)}")
            candidates.append({
                "champion": name, "position": pos,
                "score": round(score, 1), "comp_gain": round(comp_gain, 1),
                "reason": " · ".join(parts) or "Bon pick",
            })
    candidates.sort(key=lambda x: -x["score"])
    return candidates[:6]


@api_router.get("/draft/suggest")
async def draft_suggest(request: Request):
    """
    Return top suggestions for the current user draft turn with Delta-Analyzer explanation.
    Includes comp_gain, counter targets, and reason label.

    En mode MP versus (shared draft) on reconstruit un `draft_state` virtuel à
    partir de `session.mp_draft` côté caller (token → side), car le draft
    partagé n'écrit `GAME_STATE["draft_state"]` qu'à la fin.
    """
    draft = GAME_STATE.get("draft_state")

    # MP-shared draft override: if a versus draft is in progress, synthesize
    # the solo-shape draft from the caller's point of view.
    sid = request.query_params.get("session_id")
    token = request.query_params.get("mp_token")
    mp_draft = None
    if sid:
        sess = _sessions.get_session(sid)
        if sess is not None and sess.mp_draft and not sess.mp_draft.get("completed"):
            mp_draft = sess.mp_draft

    if mp_draft:
        my_side = mp_draft.get("side", {}).get(token)
        if my_side is None:
            return {"suggestions": [], "action": None}
        opp_side = 2 if my_side == 1 else 1
        ms, os_ = str(my_side), str(opp_side)
        user_bans = list(mp_draft["bans"].get(ms, []))
        enemy_bans = list(mp_draft["bans"].get(os_, []))
        user_picks = [dict(p) for p in mp_draft["picks"].get(ms, [])]
        enemy_picks = [dict(p) for p in mp_draft["picks"].get(os_, [])]
        draft = {
            "step": mp_draft["step"],
            "user_bans": user_bans,
            "enemy_bans": enemy_bans,
            "user_picks": user_picks,
            "enemy_picks": enemy_picks,
            "banned_champions": user_bans + enemy_bans,
            "picked_champions": [p["champion"] for p in user_picks]
                               + [p["champion"] for p in enemy_picks],
            "user_picked_champions": [p["champion"] for p in user_picks],
            "enemy_picked_champions": [p["champion"] for p in enemy_picks],
            "fearless_excluded": list(mp_draft.get("fearless_excluded", [])),
        }

    if not draft:
        raise HTTPException(status_code=400, detail="No draft in progress")

    step = draft["step"]
    if step >= len(DRAFT_SEQUENCE):
        return {"suggestions": [], "action": None}

    # En mode MP, l'acteur courant dépend du side du caller (pas de la séquence
    # brute qui alterne user/enemy à partir de side 1).
    if mp_draft:
        seq = mp_draft.get("sequence", [])
        if step >= len(seq):
            return {"suggestions": [], "action": None}
        action_type, current_side = seq[step]
        my_side = mp_draft.get("side", {}).get(token)
        if current_side != my_side:
            return {"suggestions": [], "action": "enemy_turn"}
    else:
        actor, action_type = DRAFT_SEQUENCE[step]
        if actor != "user":
            return {"suggestions": [], "action": "enemy_turn"}

    fearless     = set(draft.get("fearless_excluded", []))
    unavailable  = set(draft["banned_champions"] + draft["picked_champions"]) | fearless
    my_picks     = draft["user_picks"]
    enemy_picks  = draft["enemy_picks"]
    opp_id       = _get_current_opponent_id()
    opp_pool     = _get_team_champ_pool(opp_id) if opp_id else set()

    if action_type == "ban":
        # Positions the enemy still needs to fill
        enemy_needed = set(_needed_positions(draft, "enemy"))
        # Per-position pool of the opponent: {pos: {champ, ...}}
        opp_pool_by_pos = _get_team_champ_pool_by_pos(opp_id) if opp_id else {}

        candidates = []
        for name, meta in META_LOOKUP.items():
            if name in unavailable:
                continue
            tier     = meta.get("tier", "C")
            presence = meta.get("presence", 0.0)
            wr       = meta.get("winrate", 50.0)
            weight   = presence * 0.4 + wr * 0.2
            weight  += {"S": 18, "A": 9, "B": 3, "C": 0}.get(tier, 0)
            in_pool  = name in opp_pool

            # Find which player position actually has this champion in their pool
            pool_pos = next((pos for pos, champs in opp_pool_by_pos.items() if name in champs), None)
            fills_needed = pool_pos in enemy_needed if pool_pos else False

            # Bonus if champion fills a role the enemy still needs
            if fills_needed:
                weight += 12
            if fills_needed and in_pool:
                weight += 18
            elif in_pool:
                weight += 12

            # Reason label using the actual player's position, not meta position
            parts = []
            if tier == "S": parts.append("S-tier")
            if in_pool and pool_pos:
                if fills_needed:
                    parts.append(f"pool {pool_pos} adverse")
                else:
                    parts.append(f"pool {pool_pos} adverse")
            elif in_pool:
                parts.append("dans le pool adverse")
            if wr > 58: parts.append(f"{wr:.0f}% WR")
            candidates.append({
                "champion": name, "position": pool_pos or meta.get("position", ""),
                "score": round(weight, 1),
                "reason": " · ".join(parts) or "Forte présence méta",
            })
        candidates.sort(key=lambda x: -x["score"])
        return {"action": "ban", "step": step, "suggestions": candidates[:5]}

    else:  # pick
        needed = _needed_positions(draft, "user")
        candidates = []
        for pos in needed:
            for champ in get_meta_champions().get(pos, []):
                name = champ["name"]
                if name in unavailable:
                    continue
                score      = delta_analyzer(name, pos, my_picks, enemy_picks, needed, step)
                comp_gain  = comp_score(my_picks + [{"champion": name, "position": pos}]) - comp_score(my_picks)
                countered  = COUNTER_MAP.get(name, set()) & {p.get("champion","") for p in enemy_picks}
                tier       = META_LOOKUP.get(name, {}).get("tier", "C")
                parts      = []
                if tier == "S":      parts.append("S-tier")
                if countered:        parts.append(f"Counter {', '.join(countered)}")
                if comp_gain > 6:    parts.append("Renforce la compo")
                syn_champs = {nm for pair, _ in SYNERGY_PAIRS
                              for nm in pair if name in pair
                              and (pair - {name}).issubset({p.get("champion","") for p in my_picks})}
                if syn_champs:
                    parts.append(f"Synergie {', '.join(syn_champs)}")
                candidates.append({
                    "champion": name, "position": pos,
                    "score": round(score, 1), "comp_gain": round(comp_gain, 1),
                    "reason": " · ".join(parts) or "Bon pick",
                })
        candidates.sort(key=lambda x: -x["score"])
        return {"action": "pick", "step": step, "suggestions": candidates[:6]}


@api_router.post("/draft/action")
async def draft_action(action: DraftAction):
    """Perform a draft action following the official LoL draft sequence."""
    if not GAME_STATE["draft_state"]:
        raise HTTPException(status_code=400, detail="No draft in progress")

    draft = GAME_STATE["draft_state"]
    step = draft["step"]

    if step >= len(DRAFT_SEQUENCE):
        raise HTTPException(status_code=400, detail="Draft already complete")

    actor, action_type = DRAFT_SEQUENCE[step]
    if actor != "user":
        raise HTTPException(status_code=400, detail="Not your turn")

    if action.champion in draft["banned_champions"] or action.champion in draft["picked_champions"]:
        raise HTTPException(status_code=400, detail="Champion not available")
    # Fearless rule: block picks (bans of fearless champs are wasteful but allowed)
    if action_type == "pick" and action.champion in draft.get("fearless_excluded", []):
        raise HTTPException(status_code=400, detail=f"{action.champion} est interdit par la règle Fearless (déjà joué dans cette série)")

    # Apply user action
    _draft_apply(draft, "user", action_type, action.champion, action.position)
    step += 1
    draft["step"] = step

    # Auto-process all consecutive enemy turns
    while step < len(DRAFT_SEQUENCE) and DRAFT_SEQUENCE[step][0] == "enemy":
        _, enemy_action_type = DRAFT_SEQUENCE[step]
        if enemy_action_type == "ban":
            champ = _ai_select_ban(draft, get_meta_champions)
            if champ:
                _draft_apply(draft, "enemy", "ban", champ)
        else:
            champ, pos = _ai_select_pick(draft, _needed_positions(draft, "enemy"), get_meta_champions)
            if champ:
                _draft_apply(draft, "enemy", "pick", champ, pos)
        step += 1
        draft["step"] = step

    draft["phase"] = _draft_phase_name(draft)
    draft["current_turn"] = DRAFT_SEQUENCE[step][0] if step < len(DRAFT_SEQUENCE) else None

    return draft

# Training

@api_router.post("/training/apply")
async def apply_training(request: TrainingRequest):
    """Apply training to a player — FM-style: 1 session/week, temp form_bonus + slow dev_xp"""
    player = GAME_STATE["players"].get(request.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if player["team_id"] != GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="Not your player")
    if player.get("training_done_this_week"):
        raise HTTPException(status_code=400, detail="Ce joueur a déjà été entraîné cette semaine")

    # Effects: only fatigue/moral change immediately + form_bonus (temp) + dev_xp (slow progression)
    # form_bonus: 0-6, used in match calculation, decays -1 after each match
    # dev_xp_*: accumulate → every DEV_XP_THRESHOLD points = +0.3 permanent stat (max +2 per split)
    DEV_XP_THRESHOLD = 10

    TRAINING_CONFIG = {
        "scrims": {
            "fatigue": +10, "moral": -3,
            "form_bonus": 2,
            "dev": {"mechanics": 2, "teamwork": 1},
            "label": "Scrims"
        },
        "vod_review": {
            "fatigue": +4, "moral": +3,
            "form_bonus": 1,
            "dev": {"game_sense": 3, "consistency": 1},
            "label": "VOD Review"
        },
        "bootcamp": {
            "fatigue": +18, "moral": -8,
            "form_bonus": 3,
            "dev": {"mechanics": 2, "game_sense": 2},
            "label": "Bootcamp"
        },
        "rest": {
            "fatigue": -25, "moral": +12,
            "form_bonus": 1,
            "dev": {},
            "label": "Repos"
        },
    }

    cfg = TRAINING_CONFIG.get(request.training_type)
    if not cfg:
        raise HTTPException(status_code=400, detail="Type d'entraînement inconnu")

    # Apply fatigue & moral
    player["fatigue"] = max(0, min(100, player.get("fatigue", 30) + cfg["fatigue"]))
    player["moral"]   = max(0, min(100, player.get("moral",   75) + cfg["moral"]))

    # Apply form_bonus (additive, capped at 6)
    player["form_bonus"] = min(6, player.get("form_bonus", 0) + cfg["form_bonus"])

    # Accumulate dev_xp — gains go directly to rating (never recompute from sub-stats)
    stat_gains = {}
    max_training_gain_per_split = 2.0
    for stat, xp_gain in cfg["dev"].items():
        xp_key = f"dev_xp_{stat}"
        player[xp_key] = player.get(xp_key, 0) + xp_gain
        while player[xp_key] >= DEV_XP_THRESHOLD:
            player[xp_key] -= DEV_XP_THRESHOLD
            gain_key = f"training_gain_{stat}"
            total_gain = player.get(gain_key, 0.0)
            if total_gain < max_training_gain_per_split:
                actual = min(0.3, max_training_gain_per_split - total_gain)
                # Apply gain directly to rating (capped by potential)
                pot_cap = int(player.get("potential", 90) * 0.95)
                player["rating"] = min(pot_cap, player.get("rating", 75) + 1)
                player[gain_key] = round(total_gain + actual, 2)
                stat_gains[stat] = round(actual, 2)
    # rating stays as-is — no recalculation from sub-stats

    # Lock training for this week
    player["training_done_this_week"] = True

    save_state()
    return {
        "success": True,
        "player": player,
        "form_bonus_added": cfg["form_bonus"],
        "stat_gains": stat_gains,
        "effects_summary": {
            "fatigue": cfg["fatigue"],
            "moral": cfg["moral"],
            "form_bonus": cfg["form_bonus"],
        }
    }



@api_router.post("/training/set-plan")
async def set_training_plan(request: TrainingPlanRequest):
    """Set a recurring training plan for a player. Applied automatically after each match."""
    player = GAME_STATE["players"].get(request.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if player["team_id"] != GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="Not your player")

    valid = {"scrims", "vod_review", "bootcamp", "rest", ""}
    if request.training_type not in valid:
        raise HTTPException(status_code=400, detail="Type invalide")

    player["training_plan"] = request.training_type or None

    # Immediately apply if slot still available this week
    applied = False
    if request.training_type:
        user_team = GAME_STATE["teams"].get(GAME_STATE["user_team"], {})
        applied = _execute_training_plan(player, user_team)

    save_state()
    return {"success": True, "player": player, "applied_now": applied}


@api_router.post("/training/set-team-plan")
async def set_team_training_plan(request: TeamTrainingPlanRequest):
    """Set the same training plan for all 5 starters of the user's team."""
    valid = {"scrims", "vod_review", "bootcamp", "rest", ""}
    if request.training_type not in valid:
        raise HTTPException(status_code=400, detail="Type invalide")

    user_team_id = GAME_STATE.get("user_team")
    user_team = GAME_STATE["teams"].get(user_team_id, {})
    starters = [
        p for p in GAME_STATE["players"].values()
        if p.get("team_id") == user_team_id and p.get("is_starter")
    ]

    applied_count = 0
    downgraded_to_rest = 0
    for player in starters:
        player["training_plan"] = request.training_type or None
        if request.training_type:
            result = _execute_training_plan(player, user_team)
            if result:
                applied_count += 1
                if request.training_type != "rest" and result == "rest":
                    downgraded_to_rest += 1

    save_state()
    return {
        "success": True,
        "applied_count": applied_count,
        "total_starters": len(starters),
        "downgraded_to_rest": downgraded_to_rest,
    }


# Roster Management

@api_router.post("/roster/swap")
async def swap_roster(request: RosterSwapRequest):
    """Swap starter/sub status between two players"""
    player1 = GAME_STATE["players"].get(request.player1_id)
    player2 = GAME_STATE["players"].get(request.player2_id)
    
    if not player1 or not player2:
        raise HTTPException(status_code=404, detail="Player not found")
    
    if player1["team_id"] != GAME_STATE["user_team"] or player2["team_id"] != GAME_STATE["user_team"]:
        raise HTTPException(status_code=400, detail="Not your players")
    
    if player1["position"] != player2["position"]:
        raise HTTPException(status_code=400, detail="Players must have same position")
    
    player1["is_starter"], player2["is_starter"] = player2["is_starter"], player1["is_starter"]
    save_state()
    return {"success": True, "player1": player1, "player2": player2}

# ============ SPLIT CONTINUITY ============

# LEC splits data — real rosters per split
LEC_SPLITS = {
    "spring_2025": {
        "label": "LEC Spring 2025",
        "season": 2025,
        "split_number": 1,
        "teams": ["fnc","g2","gx","kc","koi","rge","sk","bds","th","vit"],
        "rosters": {
            "fnc": {"TOP":"Oscarinin","JUNGLE":"Razork","MID":"Humanoid","ADC":"Upset","SUPPORT":"Mikyx"},
            "g2":  {"TOP":"BrokenBlade","JUNGLE":"SkewMond","MID":"Caps","ADC":"Hans Sama","SUPPORT":"Labrov"},
            "gx":  {"TOP":"Lot","JUNGLE":"Closer","MID":"Jackies","ADC":"Noah","SUPPORT":"Jun"},
            "kc":  {"TOP":"Canna","JUNGLE":"Yike","MID":"Vladi","ADC":"Caliste","SUPPORT":"Targamas"},
            "koi": {"TOP":"Myrwn","JUNGLE":"Elyoya","MID":"jojopyun","ADC":"Supa","SUPPORT":"Alvaro"},
            "rge": {"TOP":"Adam","JUNGLE":"Malrang","MID":"Larssen","ADC":"Patrik","SUPPORT":"Execute"},
            "sk":  {"TOP":"JNX","JUNGLE":"Isma","MID":"Reeker","ADC":"Rahel","SUPPORT":"Loopy"},
            "bds": {"TOP":"Irrelevant","JUNGLE":"113","MID":"nuc","ADC":"Ice","SUPPORT":"Parus"},
            "th":  {"TOP":"Carlsen","JUNGLE":"Sheo","MID":"Kamiloo","ADC":"Flakked","SUPPORT":"Stend"},
            "vit": {"TOP":"Naak Nako","JUNGLE":"Lyncas","MID":"Czajek","ADC":"Carzzy","SUPPORT":"Hylissang"},
        }
    },
    "summer_2025": {
        "label": "LEC Summer 2025",
        "season": 2025,
        "split_number": 2,
        "teams": ["fnc","g2","gx","kc","koi","navi","sk","bds","th","vit"],
        "rosters": {
            "fnc": {"TOP":"Oscarinin","JUNGLE":"Razork","MID":"Poby","ADC":"Upset","SUPPORT":"Mikyx"},
            "g2":  {"TOP":"BrokenBlade","JUNGLE":"SkewMond","MID":"Caps","ADC":"Hans Sama","SUPPORT":"Labrov"},
            "gx":  {"TOP":"Lot","JUNGLE":"Isma","MID":"Jackies","ADC":"Noah","SUPPORT":"Jun"},
            "kc":  {"TOP":"Canna","JUNGLE":"Yike","MID":"Vladi","ADC":"Caliste","SUPPORT":"Targamas"},
            "koi": {"TOP":"Myrwn","JUNGLE":"Elyoya","MID":"jojopyun","ADC":"Supa","SUPPORT":"Alvaro"},
            "navi":{"TOP":"Irrelevant","JUNGLE":"Malrang","MID":"Larssen","ADC":"SamD","SUPPORT":"Parus"},
            "sk":  {"TOP":"DnDn","JUNGLE":"Skeanz","MID":"Abbedagge","ADC":"Keduii","SUPPORT":"Loopy"},
            "bds": {"TOP":"Rooster","JUNGLE":"Boukada","MID":"nuc","ADC":"Ice","SUPPORT":"Parus"},
            "th":  {"TOP":"Carlsen","JUNGLE":"Sheo","MID":"Kamiloo","ADC":"Flakked","SUPPORT":"Stend"},
            "vit": {"TOP":"Naak Nako","JUNGLE":"Lyncas","MID":"Humanoid","ADC":"Carzzy","SUPPORT":"Hylissang"},
        }
    },
    "spring_2026": {
        "label": "LEC Spring 2026",
        "season": 2026,
        "split_number": 1,
        "teams": ["fnc","g2","gx","kc","koi","navi","shft","sk","th","vit"],
        "rosters": {
            "fnc": {"TOP":"Empyros","JUNGLE":"Razork","MID":"Vladi","ADC":"Upset","SUPPORT":"Lospa"},
            "g2":  {"TOP":"BrokenBlade","JUNGLE":"SkewMond","MID":"Caps","ADC":"Hans Sama","SUPPORT":"Labrov"},
            "gx":  {"TOP":"Lot","JUNGLE":"Isma","MID":"Jackies","ADC":"Noah","SUPPORT":"Jun"},
            "kc":  {"TOP":"Canna","JUNGLE":"Yike","MID":"kyeahoo","ADC":"Caliste","SUPPORT":"Busio"},
            "koi": {"TOP":"Myrwn","JUNGLE":"Elyoya","MID":"Jojopyun","ADC":"Supa","SUPPORT":"Alvaro"},
            "navi":{"TOP":"Maynter","JUNGLE":"Rhilech","MID":"Poby","ADC":"Hans SamD","SUPPORT":"Parus"},
            "shft":{"TOP":"Rooster","JUNGLE":"Boukada","MID":"nuc","ADC":"Paduck","SUPPORT":"Trymbi"},
            "sk":  {"TOP":"Wunder","JUNGLE":"Skeanz","MID":"Lider","ADC":"Jopa","SUPPORT":"Mikyx"},
            "th":  {"TOP":"Tracyn","JUNGLE":"Sheo","MID":"Serin","ADC":"Ice","SUPPORT":"Stend"},
            "vit": {"TOP":"Naak Nako","JUNGLE":"Lyncas","MID":"Humanoid","ADC":"Carzzy","SUPPORT":"Fleshy"},
        }
    },
}

SPLIT_ORDER = ["spring_2025", "summer_2025", "spring_2026"]

def get_current_split_id():
    """Get current split id from game state"""
    season = GAME_STATE.get("season", 2026)
    split_num = GAME_STATE.get("current_split", 1)
    if season == 2025 and split_num == 1: return "spring_2025"
    if season == 2025 and split_num == 2: return "summer_2025"
    if season == 2026 and split_num == 1: return "spring_2026"
    # Beyond known splits — return last known
    return SPLIT_ORDER[-1]

def get_next_split_id():
    current = get_current_split_id()
    idx = SPLIT_ORDER.index(current) if current in SPLIT_ORDER else len(SPLIT_ORDER)-1
    if idx + 1 < len(SPLIT_ORDER):
        return SPLIT_ORDER[idx + 1]
    # Generate procedurally
    return None

def generate_next_split_label(current_split_id: str) -> dict:
    """Generate label/metadata for splits beyond the hardcoded 3"""
    # Determine what comes after spring_2026
    # Pattern: summer_2026 → spring_2027 → summer_2027...
    active_league = GAME_STATE.get("league", "LEC")
    league_splits_key = f"{active_league}_SPLITS"
    league_splits = globals().get(league_splits_key, LEC_SPLITS)
    last = league_splits.get(current_split_id, league_splits.get("spring_2026", LEC_SPLITS["spring_2026"]))
    season = last["season"]
    split_num = last["split_number"]
    user_league = active_league

    if split_num == 1:
        return {"label": f"{user_league} Summer {season}", "season": season, "split_number": 2}
    else:
        return {"label": f"{user_league} Spring {season + 1}", "season": season + 1, "split_number": 1}

def get_roster_changes_preview(user_team_id: str, next_split_data: dict) -> list:
    """Compare current user roster to next split roster and return diff"""
    changes = []
    if not next_split_data:
        return changes
    
    next_rosters = next_split_data.get("rosters", {})
    next_team_roster = next_rosters.get(user_team_id)
    if not next_team_roster:
        return [{"type": "info", "message": "Votre équipe n'est pas dans le prochain split. Choisissez une nouvelle équipe."}]
    
    # Get current user players
    user_team = GAME_STATE["teams"].get(user_team_id, {})
    current_players = {}
    for pid in user_team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        if p:
            current_players[p["position"]] = p["name"]
    
    for pos, new_name in next_team_roster.items():
        current_name = current_players.get(pos, "?")
        if current_name == new_name:
            changes.append({"position": pos, "type": "stay", "player": new_name})
        else:
            changes.append({"position": pos, "type": "change", "out": current_name, "in": new_name})
    
    return changes

def _simulate_league_champion(league_name: str, season: int, split_number: int) -> dict | None:
    """Return the champion (1st place) for a given league.

    Priority:
    1. intl_standings (already simulated this season) — consistent with MSI/Worlds bracket
    2. Deterministic random fallback based on team ratings
    """
    import random as _rng
    teams = LEAGUES_DATA.get(league_name, {}).get("teams", [])
    if not teams:
        return None

    # Use intl_standings if available — keeps split-end overlay consistent with MSI/Worlds seeds
    intl_table = GAME_STATE.get("intl_standings", {}).get(league_name)
    if intl_table:
        sorted_table = sorted(intl_table, key=lambda x: (-x["wins"], x["losses"]))
        if sorted_table:
            abbr_map = {t.get("abbr", "").upper(): t for t in teams}
            top_team = abbr_map.get(sorted_table[0]["team"].upper())
            if top_team:
                return {"id": top_team["id"], "name": top_team["name"], "abbr": top_team["abbr"]}

    # Fallback: deterministic random weighted by rating
    seed = hash((league_name, season, split_number)) & 0xFFFFFFFF
    rnd = _rng.Random(seed)
    weights = [t.get("rating", 50) ** 2 for t in teams]
    chosen = rnd.choices(teams, weights=weights, k=1)[0]
    return {"id": chosen["id"], "name": chosen["name"], "abbr": chosen["abbr"]}


@api_router.get("/split/status")
async def get_split_status():
    """Get current split info and whether offseason/end-of-split has been reached"""
    if not GAME_STATE["initialized"]:
        ensure_initialized()

    active_league = GAME_STATE.get("league", "LEC")
    league_splits_key = f"{active_league}_SPLITS"
    league_splits = globals().get(league_splits_key, LEC_SPLITS)

    current_id = get_current_split_id()
    current_data = league_splits.get(current_id, {})
    next_id = get_next_split_id()
    next_data = league_splits.get(next_id) if next_id else None

    # Build next split label even if procedural
    if not next_data:
        next_meta = generate_next_split_label(current_id)
        next_label = next_meta["label"]
    else:
        next_label = next_data["label"]

    # Roster changes preview
    user_team_id = GAME_STATE.get("user_team")
    roster_changes = []
    if user_team_id and next_data:
        roster_changes = get_roster_changes_preview(user_team_id, next_data)

    # Champion (user's league)
    champion_id = None
    champion_name = None
    if GAME_STATE.get("playoffs_bracket") and GAME_STATE["playoffs_bracket"].get("champion"):
        champion_id = GAME_STATE["playoffs_bracket"]["champion"]
        champ_team = GAME_STATE["teams"].get(champion_id, {})
        champion_name = champ_team.get("name")

    # Multi-region results — deterministic simulation for other leagues
    user_league = GAME_STATE.get("league", "LEC")
    season = GAME_STATE.get("season", 2026)
    split_number = GAME_STATE.get("current_split", 1)

    other_regions = {}
    for league_name in ["LEC", "LCK", "LPL", "LCS", "CBLOL"]:
        if league_name == user_league:
            other_regions[league_name] = {
                "league": league_name,
                "champion": {"id": champion_id, "name": champion_name, "abbr": GAME_STATE["teams"].get(champion_id, {}).get("abbr", "")} if champion_id else None,
                "is_user_league": True,
            }
        else:
            other_regions[league_name] = {
                "league": league_name,
                "champion": _simulate_league_champion(league_name, season, split_number),
                "is_user_league": False,
            }

    # International tournament result (if completed)
    international_result = None
    intl = GAME_STATE.get("international")
    if intl and intl.get("completed") and intl.get("winner"):
        winner_id = intl["winner"]
        winner_info = None
        for ld in LEAGUES_DATA.values():
            for t in ld["teams"]:
                if t["id"] == winner_id:
                    winner_info = {"id": t["id"], "name": t["name"], "abbr": t["abbr"]}
                    break
            if winner_info:
                break
        international_result = {
            "type": intl.get("type", "international"),
            "name": intl.get("name", "International"),
            "winner": winner_info,
        }

    # Replace "LEC" in labels with the actual user's league
    split_name = "Spring" if split_number == 1 else "Summer"
    current_label = f"{user_league} {split_name} {season}"
    next_season = season if split_number == 1 else season + 1
    next_split_name = "Summer" if split_number == 1 else "Spring"
    computed_next_label = f"{user_league} {next_split_name} {next_season}"

    return {
        "current_split": {
            "id": current_id,
            "label": current_label,
            "season": season,
            "split_number": split_number,
        },
        "next_split": {
            "id": next_id,
            "label": computed_next_label,
            "available": next_id is not None or True,  # always continuable
        },
        "phase": GAME_STATE["phase"],
        "is_offseason": GAME_STATE["phase"] == "offseason",
        "champion": {"id": champion_id, "name": champion_name} if champion_id else None,
        "history": GAME_STATE.get("history", []),
        "roster_changes_preview": roster_changes,
        "other_regions": other_regions,
        "international_result": international_result,
        "league": user_league,
    }

def simulate_offseason_transfers():
    """AI teams make coherent transfers during preseason.

    Each AI team identifies underperforming players and replaces them with
    better options from the ERL pool (upgrade or high-potential pick).
    """
    user_team_id = GAME_STATE.get("user_team")
    # In MP every player-controlled team must be preserved — not just the
    # primary user_team. `_mp_user_team_ids` is populated by the session
    # middleware / ready-run bridge; falls back to the solo single-team set.
    mp_human_team_ids = GAME_STATE.get("_mp_user_team_ids") or []
    protected_team_ids = set(mp_human_team_ids)
    if user_team_id:
        protected_team_ids.add(user_team_id)
    transfers_done = []

    ai_teams = [t for t in GAME_STATE["teams"].values() if t["id"] not in protected_team_ids]
    random.shuffle(ai_teams)

    # Work with a local copy of available ERL pool to avoid double-spending
    available_erl = dict(GAME_STATE.get("erl_players", {}))

    for team in ai_teams:
        team_players = [
            GAME_STATE["players"][pid]
            for pid in team.get("roster", [])
            if pid in GAME_STATE["players"]
        ]
        if not team_players:
            continue

        team_avg_rating = sum(p.get("rating", 70) for p in team_players) / max(len(team_players), 1)

        def player_weakness(p):
            avg_perf = p.get("avg_perf") or 0
            rating = p.get("rating", 70)
            has_perf = avg_perf > 0
            perf_score = avg_perf if has_perf else (rating / 20)
            return perf_score

        sorted_players = sorted(team_players, key=player_weakness)

        transfers_this_team = 0
        max_transfers = random.randint(1, 2)

        for player in sorted_players:
            if transfers_this_team >= max_transfers:
                break

            avg_perf = player.get("avg_perf") or 0
            rating = player.get("rating", 70)
            has_perf_data = avg_perf > 0

            # Determine if player is underperforming
            is_underperforming = (
                (has_perf_data and avg_perf < 5.0) or
                (not has_perf_data and rating < team_avg_rating - 8) or
                rating < 60
            )
            if not is_underperforming:
                break  # Rest of the team is fine

            pos = player["position"]

            # Find ERL candidates for this position that are an upgrade
            candidates = [
                p for p in available_erl.values()
                if p["position"] == pos and (
                    p["rating"] > rating + 3 or
                    (p.get("potential", 0) >= 85 and p["rating"] >= rating - 5)
                )
            ]
            if not candidates:
                continue

            # Pick best candidate (rating + potential bonus)
            candidates.sort(
                key=lambda p: p["rating"] + (p.get("potential", 0) / 12 if p.get("potential", 0) >= 85 else 0),
                reverse=True
            )
            best = candidates[0]

            # Execute transfer: new player joins AI team
            new_pid = str(uuid.uuid4())
            new_player = {
                **best,
                "id": new_pid,
                "team_id": team["id"],
                "is_starter": True,
                "avg_perf": None,
                "match_history": [],
            }

            # Update roster list
            roster = team.get("roster", [])
            old_pid = player["id"]
            if old_pid in roster:
                roster[roster.index(old_pid)] = new_pid
            else:
                roster.append(new_pid)

            GAME_STATE["players"][new_pid] = new_player
            if old_pid in GAME_STATE["players"]:
                del GAME_STATE["players"][old_pid]

            # Remove from available ERL pools
            if best["id"] in available_erl:
                del available_erl[best["id"]]
            if best["id"] in GAME_STATE.get("erl_players", {}):
                del GAME_STATE["erl_players"][best["id"]]

            transfers_done.append({
                "team": team["name"],
                "team_abbr": team.get("abbr", ""),
                "out": player["name"],
                "in": best["name"],
                "position": pos,
                "rating_change": best["rating"] - rating,
            })

            # Track for transfer recap inbox message
            GAME_STATE.setdefault("mercato_recap", []).append({
                "player": best["name"],
                "position": pos,
                "rating": best["rating"],
                "amount": 0,
                "buyer": team["id"],
                "seller": "ERL",
            })

            transfers_this_team += 1

    return transfers_done


# ── International standings ───────────────────────────────────────────────────

INTL_LEAGUES_DATA = {
    # Team abbreviations MUST match LEAGUES_DATA abbr fields exactly
    "LCK": {
        "flag": "🇰🇷",
        "teams": ["GEN", "T1", "BNK", "DK", "DNS", "KT", "HLE", "NS", "DRX", "BRN"],
    },
    "LPL": {
        "flag": "🇨🇳",
        "teams": ["BLG", "LNG", "AL", "NIP", "EDG", "JDG", "WBG", "TES", "LGD", "WE"],
    },
    "LCS": {
        "flag": "🇺🇸",
        "teams": ["C9", "LYN", "TL", "SEN", "DSG", "FLY", "DIG", "SR"],
    },
    "CBLOL": {
        "flag": "🇧🇷",
        "teams": ["LOUD", "FUR", "RED", "LÉS", "VKS", "LEV", "FXO", "PNG"],
    },
    "LEC": {
        "flag": "🇪🇺",
        "teams": ["G2", "KC", "NAVI", "VIT", "KOI", "GX", "SFT", "TH", "FNC", "SK"],
    },
}


def _init_intl_standings():
    """Initialize or reset international standings for all non-user leagues."""
    user_league = GAME_STATE.get("league", "LEC")
    standings = {}
    for league_id, data in INTL_LEAGUES_DATA.items():
        if league_id == user_league:
            continue  # user's league is tracked natively
        standings[league_id] = [
            {"team": t, "wins": 0, "losses": 0} for t in data["teams"]
        ]
    GAME_STATE["intl_standings"] = standings


def _simulate_intl_week(week: int):
    """Simulate one week of matches for every international league and send inbox message."""
    if "intl_standings" not in GAME_STATE or not GAME_STATE["intl_standings"]:
        _init_intl_standings()

    user_league = GAME_STATE.get("league", "LEC")
    blocks = []

    for league_id, table in GAME_STATE["intl_standings"].items():
        data = INTL_LEAGUES_DATA.get(league_id, {})
        flag = data.get("flag", "🌍")

        # Simulate 5 best-of-1 matches (10 teams, each plays once)
        teams = list(range(len(table)))
        random.shuffle(teams)
        pairs = [(teams[i], teams[i + 1]) for i in range(0, len(teams) - 1, 2)]
        for a, b in pairs:
            # Slight skill-based weight so standings diverge realistically
            wa = table[a]["wins"] + 1
            wb = table[b]["wins"] + 1
            winner = a if random.random() < wa / (wa + wb) else b
            loser  = b if winner == a else a
            table[winner]["wins"]  += 1
            table[loser]["losses"] += 1

        # Sort by wins desc, then losses asc
        prev_leader = table[0]["team"] if table else None
        table.sort(key=lambda x: (-x["wins"], x["losses"]))
        new_leader  = table[0]["team"] if table else None

        top5 = table[:5]
        lines = [f"{flag} {league_id}"]
        for i, row in enumerate(top5):
            medal = ["🥇", "🥈", "🥉", "4.", "5."][i]
            lines.append(f"  {medal} {row['team']:<8} {row['wins']}V-{row['losses']}D")

        # Narrative highlight
        if new_leader and prev_leader and new_leader != prev_leader:
            lines.append(f"  ⚡ {new_leader} prend la tête — {prev_leader} détrôné.")
        elif new_leader and table[0]["wins"] >= 4:
            lines.append(f"  🔥 {new_leader} en grande forme ({table[0]['wins']}V-{table[0]['losses']}D).")
        elif len(table) >= 2 and table[0]["wins"] == table[1]["wins"]:
            lines.append(f"  ⚖️ {table[0]['team']} et {table[1]['team']} à égalité en tête.")

        blocks.append("\n".join(lines))

    if not blocks:
        return

    body = "\n\n".join(blocks)
    _add_inbox_message(
        "international",
        "Scout International",
        f"Classements internationaux — Semaine {week}",
        body,
        week,
    )


# ── Youth scouting report ─────────────────────────────────────────────────────

_POS_ICON = {"TOP": "🛡️", "JUNGLE": "🌲", "MID": "⚡", "ADC": "🏹", "SUPPORT": "💊"}


def _generate_youth_scouting_report(week: int):
    """Periodic scouting report highlighting top young prospects from the ERL pool."""
    user_id = GAME_STATE.get("user_team")
    if not user_id:
        return
    user_league = GAME_STATE.get("league", "LEC")
    erl = GAME_STATE.get("erl_players", {})
    if not erl:
        return

    # Select top prospects: young (≤22), high potential, not already on user roster
    user_roster_ids = set(GAME_STATE["teams"].get(user_id, {}).get("roster", []))
    prospects = [
        p for p in erl.values()
        if p.get("age", 99) <= 22
        and p.get("potential", 0) >= 75
        and p["id"] not in user_roster_ids
    ]
    if not prospects:
        prospects = [p for p in erl.values() if p.get("age", 99) <= 23 and p["id"] not in user_roster_ids]
    if not prospects:
        return

    # Sort by potential desc, pick top 5
    prospects.sort(key=lambda p: (-p.get("potential", 0), p.get("age", 99)))
    top = prospects[:5]

    lines = [f"Rapport de scouting — Semaine {week}", ""]
    lines.append("Les talents suivants méritent votre attention pour le prochain mercato :\n")
    for p in top:
        icon = _POS_ICON.get(p.get("position", "MID"), "⭐")
        nat  = p.get("nationality", "")
        age  = p.get("age", "?")
        rat  = p.get("rating", "?")
        pot  = p.get("potential", "?")
        team = p.get("current_team") or p.get("league") or "Free Agent"
        pos  = p.get("position", "?")
        lines.append(
            f"{icon} {p.get('name','?')} ({nat}, {age} ans) — {pos}\n"
            f"   Rating {rat} · Potentiel {pot} · {team}"
        )

    # Flavour notes
    notes = [
        "\nCes joueurs sont disponibles via la fenêtre de transferts en offseason.",
        "\nSuivez leur progression — certains pourraient franchir un palier dès le prochain split.",
        "\nNote : les transferts sur ces profils seront plus accessibles financièrement que des joueurs établis.",
    ]
    lines.append(random.choice(notes))

    body = "\n".join(lines)
    _add_inbox_message("board", "Cellule de Recrutement", f"Rapport jeunes talents — Semaine {week}", body, week)


# ── Transfer recap ────────────────────────────────────────────────────────────

def _generate_transfer_recap_message():
    """Build an inbox message summarising all mercato transfers (user + AI)."""
    recap = GAME_STATE.pop("mercato_recap", [])
    user_id   = GAME_STATE.get("user_team")
    user_abbr = GAME_STATE["teams"].get(user_id, {}).get("abbr", "Vous")
    split_label = (
        f"{GAME_STATE.get('league','LEC')} "
        f"{'Spring' if GAME_STATE.get('current_split',1)==1 else 'Summer'} "
        f"{GAME_STATE.get('season', 2026)}"
    )

    user_moves = [r for r in recap if r.get("buyer") == user_id]
    ai_moves   = [r for r in recap if r.get("buyer") != user_id]

    lines = []

    # ── User transfers ──────────────────────────────────────────────────────
    if user_moves:
        total_spent = sum(m.get("amount", 0) for m in user_moves)
        lines.append(f"🔵 VOS TRANSFERTS ({len(user_moves)} recrutement(s))")
        for m in user_moves:
            icon = _POS_ICON.get(m.get("position", ""), "🎮")
            lines.append(
                f"  {icon} {m['player']} ({m['position']}, note {m['rating']}) "
                f"← {m.get('seller','?')}  |  {m['amount']:,} €"
            )
        budget_after = GAME_STATE["teams"].get(user_id, {}).get("budget", 0)
        lines.append(f"\n  💰 Total dépensé : {total_spent:,} €  |  Budget restant : {budget_after:,} €")
        lines.append("")
    else:
        lines.append("🔵 VOS TRANSFERTS")
        lines.append("  Aucun transfert réalisé cette offseason.")
        lines.append("")

    # ── AI transfers by league ──────────────────────────────────────────────
    if ai_moves:
        # Group by buyer team for readability (max 5 teams shown, 2 moves each)
        from collections import defaultdict
        by_team: dict = defaultdict(list)
        for m in ai_moves:
            by_team[m["buyer"]].append(m)

        lines.append(f"📋 MOUVEMENTS DES AUTRES ÉQUIPES ({len(ai_moves)} transfert(s))")
        shown = 0
        for tid, moves in list(by_team.items())[:8]:
            team_abbr = GAME_STATE["teams"].get(tid, {}).get("abbr", tid[:3].upper())
            for m in moves[:2]:
                icon = _POS_ICON.get(m.get("position", ""), "🎮")
                lines.append(
                    f"  {icon} {team_abbr} recrute {m['player']} "
                    f"({m['position']}, {m['rating']}) ← {m.get('seller','?')}"
                )
                shown += 1
            if shown >= 14:
                break
        if len(ai_moves) > shown:
            lines.append(f"  ... et {len(ai_moves) - shown} autre(s) mouvement(s).")

    if not any(l.strip() for l in lines):
        return

    # ── Closing assessment ──────────────────────────────────────────────────
    lines.append("")
    user_team_obj = GAME_STATE["teams"].get(user_id, {})
    avg_rating = 0
    if user_team_obj.get("roster"):
        ratings = [GAME_STATE["players"].get(pid, {}).get("rating", 0) for pid in user_team_obj["roster"]]
        ratings = [r for r in ratings if r > 0]
        avg_rating = round(sum(ratings) / len(ratings)) if ratings else 0
    if avg_rating >= 85:
        assessment = f"✅ Votre effectif ({avg_rating} de moyenne) figure parmi les plus compétitifs de la ligue."
    elif avg_rating >= 78:
        assessment = f"📊 Effectif solide ({avg_rating} de moyenne) — visez le top 4 pour les playoffs."
    else:
        assessment = f"⚠️ Effectif en construction ({avg_rating} de moyenne) — le mercato n'est pas terminé."
    lines.append(assessment)
    lines.append(f"\nBonne chance pour {split_label} !")

    body = "\n".join(lines)
    _add_inbox_message(
        "board",
        "Directeur Sportif",
        f"Récapitulatif du mercato — {split_label}",
        body,
        0,
    )


@api_router.post("/season/start")
async def start_season():
    """Launch the season from preseason: run AI transfers then begin week 1."""
    # MP mode: any one human team selected is enough to proceed. The solo
    # user_team check is relaxed when _mp_user_team_ids is populated.
    mp_human_teams = GAME_STATE.get("_mp_user_team_ids") or []
    if not GAME_STATE["user_team"] and not mp_human_teams:
        raise HTTPException(status_code=400, detail="No team selected")
    if GAME_STATE.get("phase") != "preseason":
        raise HTTPException(status_code=400, detail="Season already started or not in preseason")

    # AI teams do their offseason business
    transfers = simulate_offseason_transfers()

    # Generate transfer recap inbox message (user + AI moves)
    _generate_transfer_recap_message()

    # Init international standings for the new season
    _init_intl_standings()

    # Start the season
    GAME_STATE["phase"] = "regular"
    GAME_STATE["current_week"] = 1
    save_state()

    return {
        "success": True,
        "ai_transfers": transfers,
        "message": f"La saison démarre ! {len(transfers)} transfert(s) IA effectué(s).",
    }


@api_router.post("/split/next")
async def advance_to_next_split():
    """
    End current split, save history, and initialize the next split.
    The user's roster is NEVER touched — only AI teams get new rosters.
    """
    if not GAME_STATE["initialized"]:
        raise HTTPException(status_code=400, detail="Game not initialized")
    if GAME_STATE["phase"] not in ["offseason", "playoffs"]:
        raise HTTPException(status_code=400, detail="Le split n'est pas encore terminé")
    
    user_team_id = GAME_STATE.get("user_team")
    
    # 1 — Save current split to history
    bracket = GAME_STATE.get("playoffs_bracket") or {}
    champion_id = bracket.get("champion")
    champion_name = GAME_STATE["teams"].get(champion_id, {}).get("name", "—") if champion_id else "—"
    
    user_team = GAME_STATE["teams"].get(user_team_id, {})
    history_entry = {
        "split_label": f"{GAME_STATE.get('league', 'LEC')} {'Spring' if GAME_STATE['current_split'] == 1 else 'Summer'} {GAME_STATE['season']}",
        "season": GAME_STATE["season"],
        "split_number": GAME_STATE["current_split"],
        "team_id": user_team_id,
        "team_name": user_team.get("name", ""),
        "team_abbr": user_team.get("abbr", ""),
        "wins": user_team.get("wins", 0),
        "losses": user_team.get("losses", 0),
        "final_rank": next(
            (i + 1 for i, t in enumerate(
                sorted(
                    [t for t in GAME_STATE["teams"].values()
                     if t["id"] in {tm["id"] for tm in LEAGUES_DATA.get(GAME_STATE.get("league", "LEC"), {}).get("teams", [])}],
                    key=lambda x: (-x.get("wins", 0), x.get("losses", 0))
                )
            ) if t["id"] == user_team_id),
            10
        ),
        "champion": champion_name,
        "is_champion": champion_id == user_team_id,
        "playoffs_result": _get_user_playoffs_result(user_team_id),
        "budget": user_team.get("budget", 0),
        "prestige": user_team.get("prestige", 0),
        "champion_stats": dict(GAME_STATE.get("champion_stats", {})),
        "total_games_played": GAME_STATE.get("total_games_played", 0),
        # Snapshot ELO à la fin du split pour le graphe de carrière
        "elo_snapshot": user_team.get("elo", initial_elo(user_team.get("rating", 80))),
    }
    GAME_STATE["history"].append(history_entry)
    
    # 2 — Determine next split metadata
    active_league = GAME_STATE.get("league", "LEC")
    next_id = get_next_split_id()

    # Get split data from the active league (fallback to LEC_SPLITS for backward compat)
    league_splits_key = f"{active_league}_SPLITS"
    league_splits = globals().get(league_splits_key, LEC_SPLITS)
    next_data = league_splits.get(next_id) if next_id else None

    if next_data:
        new_season = next_data["season"]
        new_split_num = next_data["split_number"]
        new_teams_list = next_data["teams"]
    else:
        # Procedural: increment — keep same teams from current split
        meta = generate_next_split_label(get_current_split_id())
        new_season = meta["season"]
        new_split_num = meta["split_number"]
        new_teams_list = list(GAME_STATE["teams"].keys())
    
    # 3 — Save current human rosters BEFORE reinit (must survive the reset).
    # In MP sessions every human team must be preserved, not just user_team.
    mp_human_teams = GAME_STATE.get("_mp_user_team_ids") or []
    protected_team_ids: set[str] = set()
    if user_team_id:
        protected_team_ids.add(user_team_id)
    protected_team_ids.update(tid for tid in mp_human_teams if tid)

    # Map: team_id -> {pid: dict(player)} of its roster snapshot.
    saved_human_rosters: dict[str, dict] = {}
    for tid in protected_team_ids:
        team_snap = GAME_STATE["teams"].get(tid, {})
        roster_ids = list(team_snap.get("roster", []))
        roster_players = {
            pid: dict(GAME_STATE["players"][pid])
            for pid in roster_ids
            if pid in GAME_STATE["players"]
        }
        # Age players by 0.5 year, reduce contract, slight natural evolution
        for p in roster_players.values():
            p["age"] = round(p.get("age", 22) + 0.5, 1)
            p["contract_years"] = max(0, p.get("contract_years", 1) - 1)
            delta = random.randint(-2, 3)
            p["rating"] = max(50, min(99, p["rating"] + delta))
            p["potential"] = p.get("potential", p["rating"])
        saved_human_rosters[tid] = roster_players

    # Legacy alias for the primary user_team (used by downstream blocks below).
    saved_user_players = saved_human_rosters.get(user_team_id, {})
    
    # 4 — Re-initialize game world (AI teams get fresh rosters)
    GAME_STATE["current_split"] = new_split_num
    GAME_STATE["season"] = new_season
    GAME_STATE["phase"] = "preseason"
    GAME_STATE["playoffs_bracket"] = None
    GAME_STATE["current_week"] = 0
    GAME_STATE["draft_state"] = {
        "step": 0,
        "phase": "ban1",
        "current_turn": "user",
        "user_bans": [],
        "enemy_bans": [],
        "user_picks": [],
        "enemy_picks": [],
        "banned_champions": [],
        "picked_champions": [],
        "user_picked_champions": [],
        "enemy_picked_champions": [],
        "fearless_excluded": [],
    }
    
    # Rebuild teams and AI rosters
    GAME_STATE["teams"] = {}
    GAME_STATE["players"] = {}
    
    # Re-use same league team base data but only for teams in new split
    active_league = GAME_STATE.get("league", "LEC")
    all_league_teams = LEAGUES_DATA.get(active_league, LEAGUES_DATA["LEC"])["teams"]
    relevant_teams = [t for t in all_league_teams if t["id"] in new_teams_list]
    if not relevant_teams:
        relevant_teams = all_league_teams  # fallback
    
    for team_data in relevant_teams:
        team = {**team_data, "wins": 0, "losses": 0, "roster": []}
        GAME_STATE["teams"][team["id"]] = team

        if team["id"] in protected_team_ids:
            # Restore the human team's saved roster (no changes from split data)
            human_roster = saved_human_rosters.get(team["id"], {})
            for pid, player in human_roster.items():
                player["team_id"] = team["id"]
                GAME_STATE["players"][pid] = player
            team["roster"] = list(human_roster.keys())
        else:
            # AI team gets fresh roster from next split data or generated
            if next_data and team["id"] in next_data.get("rosters", {}):
                # Override REAL_ROSTERS mapping with next split
                orig_real = dict(REAL_ROSTERS.get(team["id"], {}))
                override = next_data["rosters"][team["id"]]
                for pos, pname in override.items():
                    if pos in orig_real:
                        orig_real[pos]["name"] = pname
                roster = generate_team_roster_from(team["id"], orig_real)
            else:
                roster = generate_team_roster(team["id"])
            
            for player in roster:
                GAME_STATE["players"][player["id"]] = player
                team["roster"].append(player["id"])
    
    # 5 — Refresh ERL pool with new players
    active_league = GAME_STATE.get("league", "LEC")
    GAME_STATE["erl_players"] = {}
    for erl_data in ERL_PLAYERS:
        player = generate_erl_player(erl_data)
        GAME_STATE["erl_players"][player["id"]] = player
    for _ in range(30):
        newgen_data = generate_newgen(active_league)
        newgen_data["scouting_for"] = active_league
        player = generate_erl_player(newgen_data)
        GAME_STATE["erl_players"][player["id"]] = player
    
    # 6 — Update champion tiers from the finished split, then reset stats
    update_meta_from_split_stats()
    GAME_STATE["champion_stats"] = {}
    GAME_STATE["total_games_played"] = 0
    # Clear the completed international tournament so the next split starts fresh
    GAME_STATE["international"] = None
    generate_schedule()
    save_state()

    return {
        "success": True,
        "new_split": {
            "label": next_data["label"] if next_data else generate_next_split_label(get_current_split_id())["label"],
            "season": new_season,
            "split_number": new_split_num,
        },
        "history": GAME_STATE["history"],
        "user_team": GAME_STATE["teams"].get(user_team_id),
        "message": f"Bienvenue dans la nouvelle saison !",
    }

def _get_user_playoffs_result(user_team_id: str) -> str:
    """Determine how far user went in playoffs"""
    bracket = GAME_STATE.get("playoffs_bracket")
    if not bracket:
        return "Non qualifié"
    if bracket.get("champion") == user_team_id:
        return "🏆 Champion"
    for match in reversed(bracket.get("matches", [])):
        if match.get("completed") and user_team_id in [match["team1"], match["team2"]]:
            if match.get("winner") != user_team_id:
                rnd = match.get("round", "")
                return {"finals": "🥈 Finaliste", "semifinals": "🏅 Demi-finaliste", "quarterfinals": "Quart-de-finaliste"}.get(rnd, rnd)
    return "Phase régulière"

def generate_team_roster_from(team_id: str, roster_override: dict):
    """Generate roster using a custom dict of position→player_data"""
    positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
    roster = []
    for pos in positions:
        player_data = roster_override.get(pos)
        if player_data:
            roster.append(generate_player(pos, team_id, player_data, is_starter=True))
        else:
            roster.append(generate_player(pos, team_id, None, is_starter=True))
    return roster

# Static team logo mapping (game team ID → lolesports CDN URL)
TEAM_LOGOS: dict[str, str] = {
    # LEC
    "g2":    "https://static.lolesports.com/teams/G2-FullonDark.png",
    "fnc":   "https://static.lolesports.com/teams/1631819669150_fnc-2021-worlds.png",
    "kc":    "https://static.lolesports.com/teams/1704714951336_KC.png",
    "koi":   "https://static.lolesports.com/teams/1734012609283_MKOI_FullColor_Blue.png",
    "vit":   "https://static.lolesports.com/teams/1675865863968_Vitality_FullColor.png",
    "navi":  "https://static.lolesports.com/teams/1752746833620_NAVI_FullColor.png",
    "gx":    "https://static.lolesports.com/teams/1765897105091_GIANTX-logotype-white.png",
    "th":    "https://static.lolesports.com/teams/1672933861879_Heretics-Full-Color.png",
    "sk":    "https://static.lolesports.com/teams/1643979272144_SK_Monochrome.png",
    "bds":   "https://static.lolesports.com/teams/1765897071435_600px-Shifters_allmode.png",
    # LCK
    "t1":    "https://static.lolesports.com/teams/1726801573959_539px-T1_2019_full_allmode.png",
    "geng":  "https://static.lolesports.com/teams/1773829250929_GENGLOGO_GOLD.png",
    "hle":   "https://static.lolesports.com/teams/1631819564399_hle-2021-worlds.png",
    "kt":    "https://static.lolesports.com/teams/kt_darkbackground.png",
    "dk":    "https://static.lolesports.com/teams/1673260049703_DPlusKIALOGO11.png",
    "kdrx":  "https://static.lolesports.com/teams/1774247803537_horizontal_EN_Wh.png",
    "ns":    "https://static.lolesports.com/teams/NSFullonDark.png",
    "bnk":   "https://static.lolesports.com/teams/1734691810721_BFXfullcolorfordarkbg.png",
    "brion": "https://static.lolesports.com/teams/1716454325887_Nowyprojekt.png",
    "dns":   "https://static.lolesports.com/teams/1767340467921_DN_SOOPerslogo_profile.webp",
    # LPL
    "blg":   "https://static.lolesports.com/teams/1682322954525_Bilibili_Gaming_logo_20211.png",
    "lng":   "https://static.lolesports.com/teams/1717487697003_LNGlogo.png",
    "al":    "https://static.lolesports.com/teams/1641199582689_.png",
    "nip":   "https://static.lolesports.com/teams/1673425724696_NIP-Symbol-RGB-NeonYellow1.png",
    "edg":   "https://static.lolesports.com/teams/1631819297476_edg-2021-worlds.png",
    "jdg":   "https://static.lolesports.com/teams/1627457924722_29.png",
    "weibo": "https://static.lolesports.com/teams/1641202879910_3.png",
    "tes":   "https://static.lolesports.com/teams/1592592064571_TopEsportsTES-01-FullonDark.png",
    "lgd":   "https://static.lolesports.com/teams/LGD-FullonDark-1.png",
    "we":    "https://static.lolesports.com/teams/1634763008788_220px-Team_WE_logo.png",
    "omg":   "https://static.lolesports.com/teams/1686821355861_OMG_2023_logo-01.png",
    "ig":    "https://static.lolesports.com/teams/1634762917340_300px-Invictus_Gaming_logo.png",
    "up":    "https://static.lolesports.com/teams/ultraprime.png",
    "tt":    "https://static.lolesports.com/teams/TT-FullonDark.png",
    # LCS
    "c9":    "https://static.lolesports.com/teams/1736924120254_C9Kia_IconBlue_Transparent_2000x2000.png",
    "lyon":  "https://static.lolesports.com/teams/1743717443673_isotypelyon-03.png",
    "tl":    "https://static.lolesports.com/teams/1769357207762_TLAlienware_Minimal_Bug-White.png",
    "sen":   "https://static.lolesports.com/teams/1767769784669_Sentinels_2020_Icon.png",
    "dsg":   "https://static.lolesports.com/teams/1731496922454_Disguised-Wordmark-Yellow-Main.png",
    "fly":   "https://static.lolesports.com/teams/flyquest-new-on-dark.png",
    "dig":   "https://static.lolesports.com/teams/DIG-FullonDark.png",
    "sr":    "https://static.lolesports.com/teams/1701424227458_Teams204_Shopify_1632869404072.png",
    # CBLOL
    "loud":  "https://static.lolesports.com/teams/Logo-LOUD-Esports_Original.png",
    "furia": "https://static.lolesports.com/teams/FURIA---black.png",
    "red":   "https://static.lolesports.com/teams/1671545496840_RED_Canidslogo_square.webp",
    "vks":   "https://static.lolesports.com/teams/1670542079678_vks.png",
    "lev":   "https://static.lolesports.com/teams/1643795049372_LEV-CLAROWhite.png",
    "fluxo": "https://static.lolesports.com/teams/1766161431111_LogoColorida.png",
    "pain":  "https://static.lolesports.com/teams/1674657011011_pain_logo_white.png",
}

@api_router.get("/team-logos")
async def get_team_logos():
    """Return team ID → logo URL mapping."""
    return TEAM_LOGOS


_PLAYER_IMAGES_CACHE: dict | None = None

@api_router.get("/player-images")
async def get_player_images():
    """Fetch player headshot URLs from lolesports API, keyed by summonerName (lowercase)."""
    global _PLAYER_IMAGES_CACHE
    if _PLAYER_IMAGES_CACHE is not None:
        return _PLAYER_IMAGES_CACHE

    headers = {"x-api-key": "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"}
    image_map: dict[str, str] = {}
    try:
        # Fetch all teams (lolesports returns LEC + other leagues)
        r = http_requests.get(
            "https://esports-api.lolesports.com/persisted/gw/getTeams?hl=en-US",
            headers=headers,
            timeout=10,
        )
        r.raise_for_status()
        teams = r.json().get("data", {}).get("teams", [])
        for team in teams:
            for player in team.get("players", []):
                name = player.get("summonerName", "")
                img = player.get("image", "")
                if name and img and not img.endswith("0.png"):
                    image_map[name.lower()] = img
    except Exception as e:
        logging.warning(f"lolesports player-images fetch failed: {e}")

    _PLAYER_IMAGES_CACHE = image_map
    return image_map


@api_router.get("/career/history")
async def get_career_history():
    """Get full career history across all splits"""
    return {
        "history": GAME_STATE.get("history", []),
        "current_split": GAME_STATE.get("current_split", 1),
        "current_season": GAME_STATE.get("season", 2026),
        "total_splits": len(GAME_STATE.get("history", [])) + 1,
    }

# ============ END SPLIT CONTINUITY ============

# ============ INTERNATIONAL TOURNAMENT ============
# MSI   (split 1): 10 teams  — Play-In 4 teams DE Bo5 → Bracket 8 teams DE Bo5
# Worlds (split 2+): 17 teams — Play-In 2 teams Bo5 → Swiss 16 teams 5 rounds → Knockout 8 teams SE Bo5


def _get_playoff_top_n(n: int) -> list[str]:
    """Return the top-N team IDs for the user's league by playoff placement.
    Placement order: 1st = champion, 2nd = grand_final loser,
                     3rd = lb_final loser, 4th = lb_sf/lb_r3 loser.
    """
    bracket = GAME_STATE.get("playoffs_bracket") or {}
    matches  = bracket.get("matches", [])
    result: list[str] = []

    def _loser(m: dict) -> str | None:
        if not m or not m.get("winner"):
            return None
        return m["team2"] if m["team1"] == m["winner"] else m["team1"]

    # 1st — champion
    if bracket.get("champion"):
        result.append(bracket["champion"])

    # 2nd — grand_final runner-up
    gf = next((m for m in matches if m["round"] == "grand_final"), None)
    if lo := _loser(gf):
        if lo not in result:
            result.append(lo)

    if n <= 2:
        return result[:n]

    # 3rd — lb_final loser
    lbf = next((m for m in matches if m["round"] == "lb_final"), None)
    if lo := _loser(lbf):
        if lo not in result:
            result.append(lo)

    if n <= 3:
        return result[:n]

    # 4th — lb_sf loser (LPL 6-team format) or lb_r3 loser (standard 6-team format)
    for rnd in ("lb_sf", "lb_r3"):
        m4 = next((m for m in matches if m["round"] == rnd), None)
        if lo := _loser(m4):
            if lo not in result:
                result.append(lo)
                break

    return result[:n]


def _intl_pick_top_n(league: str, n: int, user_league: str, user_champ_id) -> list:
    """Return the top-N qualified teams for an international tournament.
    Uses actual W-L standings for the user's league, intl_standings simulation for others.
    Does NOT force the user in if they didn't finish top-N.
    """
    is_user_league = (league == user_league)

    if is_user_league:
        # Use playoff placement (not regular season W-L): champion → runner-up → 3rd → 4th
        playoff_ids = _get_playoff_top_n(n)
        gs_teams = GAME_STATE.get("teams", {})
        result = []
        for tid in playoff_ids[:n]:
            t = gs_teams.get(tid)
            if not t:
                continue
            base = next((lt for lt in LEAGUES_DATA[league]["teams"] if lt["id"] == tid), t)
            result.append({**base, **t, "league": league,
                           "is_user_champ": tid == user_champ_id})
    else:
        # Use simulated intl standings if available, else fall back to rating sort
        intl_table = GAME_STATE.get("intl_standings", {}).get(league)
        league_teams_map = {t["id"]: t for t in LEAGUES_DATA.get(league, {}).get("teams", [])}
        if intl_table:
            sorted_table = sorted(intl_table, key=lambda x: (-x["wins"], x["losses"]))
            # Build a map by abbr for fast lookup
            abbr_map = {t.get("abbr", "").upper(): t for t in league_teams_map.values()}
            result = []
            for row in sorted_table[:n]:
                team = abbr_map.get(row["team"].upper())
                if team:
                    result.append({**team, "league": league,
                                   "is_user_champ": False,
                                   "sim_wins": row["wins"], "sim_losses": row["losses"]})
        else:
            # Fallback: sort by rating
            all_t = sorted(LEAGUES_DATA.get(league, {}).get("teams", []),
                           key=lambda x: x.get("rating", 0), reverse=True)
            result = [{**t, "league": league, "is_user_champ": False} for t in all_t[:n]]

    # Safety padding: always return exactly n teams to prevent IndexError in tournament creation
    if len(result) < n:
        all_t = sorted(LEAGUES_DATA.get(league, {}).get("teams", []),
                       key=lambda x: x.get("rating", 0), reverse=True)
        existing_ids = {t["id"] for t in result}
        for t in all_t:
            if t["id"] not in existing_ids and len(result) < n:
                result.append({**t, "league": league, "is_user_champ": False})

    return result


def _intl_make_match(mid: str, round_name: str, best_of: int = 5, t1=None, t2=None) -> dict:
    return {"id": mid, "round": round_name, "best_of": best_of,
            "team1": t1, "team2": t2, "winner_id": None, "score1": 0, "score2": 0, "games": [],
            "locked": t1 is None or t2 is None}


def _intl_set_slot(match: dict, slot: int, team: dict):
    match["team1" if slot == 1 else "team2"] = team
    if match["team1"] is not None and match["team2"] is not None:
        match["locked"] = False


def _intl_sim(t1: dict, t2: dict, best_of: int, t1_boost: float = 0, t2_boost: float = 0,
              start_score: tuple[int, int] = (0, 0), prev_games: list = None) -> dict:
    """Simulate a full BO (or finish a partial one) until one team reaches wins_needed.

    `start_score` lets the caller resume an in-progress BO. `prev_games` is the
    existing list of game results to extend.
    """
    wn = (best_of + 1) // 2
    w1, w2 = start_score
    games = list(prev_games or [])
    # Apply a per-series form variance to match the variability of calculate_team_power
    # (international teams lack real moral/fatigue data, so we simulate it with small noise)
    t1_form = random.gauss(0, 3.0)
    t2_form = random.gauss(0, 3.0)
    t1_power = max(30, min(100, t1["rating"] + t1_boost + t1_form))
    t2_power = max(30, min(100, t2["rating"] + t2_boost + t2_form))
    while w1 < wn and w2 < wn:
        r = simulate_match_phases(t1_power, t2_power)
        if r["winner"] == 1: w1 += 1
        else: w2 += 1
        games.append({"winner": t1["id"] if r["winner"] == 1 else t2["id"], "duration": r["duration"]})
    return {"winner_id": t1["id"] if w1 > w2 else t2["id"], "score1": w1, "score2": w2, "games": games}


def _intl_sim_one_game(t1: dict, t2: dict, t1_boost: float = 0, t2_boost: float = 0) -> dict:
    """Simulate exactly one game of an international BO. Returns the game result."""
    t1_form = random.gauss(0, 3.0)
    t2_form = random.gauss(0, 3.0)
    t1_power = max(30, min(100, t1["rating"] + t1_boost + t1_form))
    t2_power = max(30, min(100, t2["rating"] + t2_boost + t2_form))
    r = simulate_match_phases(t1_power, t2_power)
    return {
        "winner": t1["id"] if r["winner"] == 1 else t2["id"],
        "duration": r["duration"],
    }


def _intl_apply_one_game(m: dict, game: dict) -> dict:
    """Append a game to a match, update score1/score2, and return a status dict.

    Returns:
        {"completed": bool, "winner_id": str | None, "score1": int, "score2": int, "games": list}
    """
    m.setdefault("games", []).append(game)
    if game["winner"] == m["team1"]["id"]:
        m["score1"] = m.get("score1", 0) + 1
    else:
        m["score2"] = m.get("score2", 0) + 1
    wn = (m["best_of"] + 1) // 2
    if m["score1"] >= wn:
        m["winner_id"] = m["team1"]["id"]
    elif m["score2"] >= wn:
        m["winner_id"] = m["team2"]["id"]
    return {
        "completed": m.get("winner_id") is not None,
        "winner_id": m.get("winner_id"),
        "score1":    m["score1"],
        "score2":    m["score2"],
        "games":     m["games"],
    }


# ── MSI ──────────────────────────────────────────────────────────────────────

def _create_msi(user_league: str, user_champ_id) -> dict:
    s = {lg: _intl_pick_top_n(lg, 2, user_league, user_champ_id) for lg in ["LCK","LPL","LEC","LCS","CBLOL"]}
    pi_teams   = [s["LEC"][1], s["LPL"][1], s["LCS"][1], s["CBLOL"][1]]
    bracket_pre = [s["LCK"][0], s["LCK"][1], s["LPL"][0], s["LEC"][0], s["LCS"][0], s["CBLOL"][0]]
    pi_ms = {
        "pi_ub1": _intl_make_match("pi_ub1", "Play-In · UB R1",    5, pi_teams[0], pi_teams[1]),
        "pi_ub2": _intl_make_match("pi_ub2", "Play-In · UB R1",    5, pi_teams[2], pi_teams[3]),
        "pi_ubf": _intl_make_match("pi_ubf", "Play-In · UB Final", 5),
        "pi_lb1": _intl_make_match("pi_lb1", "Play-In · LB R1",    5),
        "pi_lbf": _intl_make_match("pi_lbf", "Play-In · LB Final", 5),
    }
    return {
        "type": "msi", "name": "MSI", "stage": "play_in",
        "completed": False, "winner": None,
        "user_league": user_league, "user_champ_id": user_champ_id,
        "play_in":  {"teams": pi_teams,  "matches": pi_ms, "qualified": [], "completed": False},
        "bracket":  {"pre_seeded": bracket_pre, "teams": None, "matches": {}, "winner": None, "completed": False},
    }


MSI_BRACKET_FLOW = {
    "ub1_1": {"w": ("ub2_1",1), "l": ("lb1_1",1)}, "ub1_2": {"w": ("ub2_1",2), "l": ("lb1_2",1)},
    "ub1_3": {"w": ("ub2_2",1), "l": ("lb1_1",2)}, "ub1_4": {"w": ("ub2_2",2), "l": ("lb1_2",2)},
    "ub2_1": {"w": ("ubf",  1), "l": ("lb2_1",2)}, "ub2_2": {"w": ("ubf",  2), "l": ("lb2_2",2)},
    "ubf":   {"w": ("gf",   1), "l": ("lbf",  2)},
    "lb1_1": {"w": ("lb2_1",1), "l": None}, "lb1_2": {"w": ("lb2_2",1), "l": None},
    "lb2_1": {"w": ("lb3",  1), "l": None}, "lb2_2": {"w": ("lb3",  2), "l": None},
    "lb3":   {"w": ("lbf",  1), "l": None}, "lbf":   {"w": ("gf",   2), "l": None},
    "gf":    {"w": None, "l": None},
}
_MSI_ROUND_LABELS = {
    "ub1_1":"Bracket · UB R1","ub1_2":"Bracket · UB R1","ub1_3":"Bracket · UB R1","ub1_4":"Bracket · UB R1",
    "ub2_1":"Bracket · UB Semifinal","ub2_2":"Bracket · UB Semifinal",
    "ubf":"Bracket · UB Final",
    "lb1_1":"Bracket · LB R1","lb1_2":"Bracket · LB R1",
    "lb2_1":"Bracket · LB Quarterfinal","lb2_2":"Bracket · LB Quarterfinal",
    "lb3":"Bracket · LB Semifinal","lbf":"Bracket · LB Final","gf":"Bracket · Grand Final",
}


def _msi_setup_bracket(msi: dict, teams: list):
    t = sorted(teams, key=lambda x: x.get("rating", 0), reverse=True)
    bm = msi["bracket"]["matches"]
    bm["ub1_1"] = _intl_make_match("ub1_1", _MSI_ROUND_LABELS["ub1_1"], 5, t[0], t[7])
    bm["ub1_2"] = _intl_make_match("ub1_2", _MSI_ROUND_LABELS["ub1_2"], 5, t[3], t[4])
    bm["ub1_3"] = _intl_make_match("ub1_3", _MSI_ROUND_LABELS["ub1_3"], 5, t[2], t[5])
    bm["ub1_4"] = _intl_make_match("ub1_4", _MSI_ROUND_LABELS["ub1_4"], 5, t[1], t[6])
    for mid in ["ub2_1","ub2_2","ubf","lb1_1","lb1_2","lb2_1","lb2_2","lb3","lbf","gf"]:
        bm[mid] = _intl_make_match(mid, _MSI_ROUND_LABELS[mid], 5)
    msi["bracket"]["teams"] = t


def _msi_update_play_in(msi: dict, mid: str, res: dict):
    pi = msi["play_in"]; ms = pi["matches"]; m = ms[mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"], score2=res["score2"], games=res["games"])
    w = m["team1"] if res["winner_id"] == m["team1"]["id"] else m["team2"]
    l = m["team2"] if res["winner_id"] == m["team1"]["id"] else m["team1"]
    if mid == "pi_ub1": _intl_set_slot(ms["pi_ubf"],1,w); _intl_set_slot(ms["pi_lb1"],1,l)
    elif mid == "pi_ub2": _intl_set_slot(ms["pi_ubf"],2,w); _intl_set_slot(ms["pi_lb1"],2,l)
    elif mid == "pi_ubf": pi["qualified"].append(w["id"]); _intl_set_slot(ms["pi_lbf"],1,l)
    elif mid == "pi_lb1": _intl_set_slot(ms["pi_lbf"],2,w)
    elif mid == "pi_lbf":
        pi["qualified"].append(w["id"]); pi["completed"] = True
        q_teams = [t for t in pi["teams"] if t["id"] in pi["qualified"]]
        _msi_setup_bracket(msi, msi["bracket"]["pre_seeded"] + q_teams)
        msi["stage"] = "bracket"


def _msi_update_bracket(msi: dict, mid: str, res: dict):
    bm = msi["bracket"]["matches"]; m = bm[mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"], score2=res["score2"], games=res["games"])
    w = m["team1"] if res["winner_id"] == m["team1"]["id"] else m["team2"]
    l = m["team2"] if res["winner_id"] == m["team1"]["id"] else m["team1"]
    flow = MSI_BRACKET_FLOW.get(mid, {})
    if flow.get("w"): _intl_set_slot(bm[flow["w"][0]], flow["w"][1], w)
    else:
        msi["bracket"]["winner"] = w["id"]; msi["bracket"]["completed"] = True
        msi.update(completed=True, winner=w["id"], stage="completed")
    if flow.get("l"): _intl_set_slot(bm[flow["l"][0]], flow["l"][1], l)


# ── Worlds ────────────────────────────────────────────────────────────────────

def _create_worlds(user_league: str, user_champ_id) -> dict:
    s = {
        "LCK":   _intl_pick_top_n("LCK",   4, user_league, user_champ_id),
        "LPL":   _intl_pick_top_n("LPL",   4, user_league, user_champ_id),
        "LCS":   _intl_pick_top_n("LCS",   3, user_league, user_champ_id),
        "LEC":   _intl_pick_top_n("LEC",   3, user_league, user_champ_id),
        "CBLOL": _intl_pick_top_n("CBLOL", 3, user_league, user_champ_id),
    }
    pi_teams   = [s["LCS"][2], s["CBLOL"][2]]                                     # 2
    pre_swiss  = s["LCK"] + s["LPL"] + s["LCS"][:2] + s["LEC"] + s["CBLOL"][:2]  # 4+4+2+3+2 = 15
    return {
        "type": "worlds", "name": "Worlds", "stage": "play_in",
        "completed": False, "winner": None,
        "user_league": user_league, "user_champ_id": user_champ_id,
        "play_in": {"teams": pi_teams,
                    "match": _intl_make_match("pi_main","Play-In",5,pi_teams[0],pi_teams[1]),
                    "qualified": None, "completed": False},
        "swiss":   {"pre_qualified": pre_swiss, "teams": None,
                    "rounds": [], "current_round": 0,
                    "advanced": [], "eliminated": [], "completed": False},
        "knockout":{"teams": None, "matches": {}, "winner": None, "completed": False},
    }


def _intl_pair_no_rematch(teams: list) -> list:
    by_id = {t["id"]: t for t in teams}
    rem   = [t["id"] for t in teams]
    pairs = []
    while len(rem) >= 2:
        t1_id = rem.pop(0)
        t1    = by_id[t1_id]
        opp   = next((oid for oid in rem if oid not in t1.get("sw_opponents",[])), rem[0])
        rem.remove(opp)
        pairs.append((t1, by_id[opp]))
    return pairs


def _worlds_gen_swiss_round(worlds: dict):
    sw = worlds["swiss"]
    active = [t for t in sw["teams"] if not t["sw_advanced"] and not t["sw_eliminated"]]
    if not active: sw["completed"] = True; _worlds_start_knockout(worlds); return
    rnum = sw["current_round"] + 1; sw["current_round"] = rnum
    groups = {}
    for t in active: groups.setdefault((t["sw_wins"], t["sw_losses"]), []).append(t)
    ordered = []
    for key in sorted(groups): grp = groups[key]; random.shuffle(grp); ordered.extend(grp)
    pairs = _intl_pair_no_rematch(ordered)
    rnd_ms = {}
    for i, (t1, t2) in enumerate(pairs):
        t1.setdefault("sw_opponents",[]).append(t2["id"]); t2.setdefault("sw_opponents",[]).append(t1["id"])
        bo = 3 if (t1["sw_wins"]==2 and t2["sw_wins"]==2) or (t1["sw_losses"]==2 and t2["sw_losses"]==2) else 1
        mid = f"sw_r{rnum}_m{i+1}"
        rnd_ms[mid] = _intl_make_match(mid, f"Swiss · Round {rnum}", bo, t1, t2)
    sw["rounds"].append({"round": rnum, "matches": rnd_ms, "completed": False})


def _worlds_update_swiss(worlds: dict, mid: str, res: dict):
    sw = worlds["swiss"]; cur = sw["rounds"][-1]; m = cur["matches"][mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"], score2=res["score2"], games=res["games"])
    loser_id = m["team1"]["id"] if res["winner_id"] == m["team2"]["id"] else m["team2"]["id"]
    for t in sw["teams"]:
        if t["id"] == res["winner_id"]:
            t["sw_wins"] += 1
            if t["sw_wins"] >= 3 and not t["sw_advanced"]:
                t["sw_advanced"] = True; sw["advanced"].append(t["id"])
        elif t["id"] == loser_id:
            t["sw_losses"] += 1
            if t["sw_losses"] >= 3 and not t["sw_eliminated"]:
                t["sw_eliminated"] = True; sw["eliminated"].append(t["id"])
    if all(m2["winner_id"] for m2 in cur["matches"].values()):
        cur["completed"] = True
        active = [t for t in sw["teams"] if not t["sw_advanced"] and not t["sw_eliminated"]]
        if len(sw["advanced"]) >= 8 or sw["current_round"] >= 5 or not active:
            while len(sw["advanced"]) < 8 and active:
                best = sorted(active, key=lambda t2: (-t2["sw_wins"], t2["sw_losses"]))[0]
                best["sw_advanced"] = True; sw["advanced"].append(best["id"])
                active = [t for t in active if not t["sw_advanced"]]
            sw["completed"] = True; _worlds_start_knockout(worlds)
        else:
            _worlds_gen_swiss_round(worlds)


def _worlds_start_knockout(worlds: dict):
    sw = worlds["swiss"]; by_id = {t["id"]: t for t in sw["teams"]}
    adv = sorted([by_id[tid] for tid in sw["advanced"][:8]], key=lambda t: (-t["sw_wins"], t["sw_losses"]))
    worlds["knockout"]["teams"] = adv; s = adv; km = worlds["knockout"]["matches"]
    km["qf1"] = _intl_make_match("qf1","Knockout · Quart de finale",5,s[0],s[7])
    km["qf2"] = _intl_make_match("qf2","Knockout · Quart de finale",5,s[3],s[4])
    km["qf3"] = _intl_make_match("qf3","Knockout · Quart de finale",5,s[2],s[5])
    km["qf4"] = _intl_make_match("qf4","Knockout · Quart de finale",5,s[1],s[6])
    km["sf1"] = _intl_make_match("sf1","Knockout · Demi-finale",5)
    km["sf2"] = _intl_make_match("sf2","Knockout · Demi-finale",5)
    km["gf"]  = _intl_make_match("gf", "Knockout · Grande Finale",5)
    worlds["stage"] = "knockout"


WORLDS_KO_FLOW = {
    "qf1":{"w":("sf1",1)}, "qf2":{"w":("sf1",2)}, "qf3":{"w":("sf2",1)}, "qf4":{"w":("sf2",2)},
    "sf1":{"w":("gf",1)},  "sf2":{"w":("gf",2)},  "gf": {},
}


def _worlds_update_knockout(worlds: dict, mid: str, res: dict):
    km = worlds["knockout"]["matches"]; m = km[mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"], score2=res["score2"], games=res["games"])
    w = m["team1"] if res["winner_id"] == m["team1"]["id"] else m["team2"]
    flow = WORLDS_KO_FLOW.get(mid, {})
    if flow.get("w"): _intl_set_slot(km[flow["w"][0]], flow["w"][1], w)
    else: worlds["knockout"].update(winner=w["id"], completed=True); worlds.update(completed=True, winner=w["id"], stage="completed")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@api_router.post("/international/start")
async def start_international():
    if not GAME_STATE["initialized"]: raise HTTPException(400, "Game not initialized")
    if GAME_STATE["phase"] != "offseason": raise HTTPException(400, "Playoffs not finished")
    if GAME_STATE.get("international") and not GAME_STATE["international"].get("completed"):
        return GAME_STATE["international"]
    user_league   = GAME_STATE.get("league", "LEC")
    user_team_id  = GAME_STATE.get("user_team")
    split_num     = GAME_STATE.get("current_split", 1)

    # Determine how many spots the user's league sends to the tournament
    spots_msi    = 2  # top-2 from each league for MSI
    spots_worlds = 3  # top-3 from each league for Worlds (LCK/LPL send 4)
    spots = spots_msi if split_num == 1 else spots_worlds
    # LCK/LPL send more teams to Worlds
    if split_num != 1 and user_league in ("LCK", "LPL"):
        spots = 4

    # Qualification based on playoff placement (not regular season W-L):
    # top-2 finishers (finalists) for MSI, top-3 or top-4 for Worlds
    top_ids = _get_playoff_top_n(spots)
    user_qualified = user_team_id in top_ids

    # user_champ_id = user's team if qualified, else None (spectator mode)
    user_champ_id = user_team_id if user_qualified else None

    GAME_STATE["international"] = _create_msi(user_league, user_champ_id) if split_num == 1 else _create_worlds(user_league, user_champ_id)
    GAME_STATE["international"]["user_team_id"] = user_team_id
    GAME_STATE["international"]["user_qualified"] = user_qualified
    return GAME_STATE["international"]


@api_router.get("/international")
async def get_international():
    if not GAME_STATE.get("international"): raise HTTPException(404, "Not started")
    return GAME_STATE["international"]


@api_router.post("/international/simulate")
async def simulate_international(req: IntlSimRequest):
    intl = GAME_STATE.get("international")
    if not intl: raise HTTPException(404, "Not started")
    if intl.get("completed"): raise HTTPException(400, "Tournament completed")
    mid = req.match_id
    uc = intl.get("user_champ_id")

    def _boost(m, t1, t2):
        """Return (t1_boost, t2_boost) from user draft when applicable."""
        if not req.user_draft or not uc: return 0, 0
        is_user_t1 = t1.get("id") == uc
        is_user_t2 = t2.get("id") == uc
        if not is_user_t1 and not is_user_t2: return 0, 0
        opp = t2 if is_user_t1 else t1
        adv = calculate_draft_advantage(req.user_draft, uc, opp.get("id", ""))
        return (adv, 0) if is_user_t1 else (0, adv)

    def _is_user_match(m: dict) -> bool:
        if not uc: return False
        t1 = m.get("team1") or {}
        t2 = m.get("team2") or {}
        return t1.get("id") == uc or t2.get("id") == uc

    def _resolve_user_bo(m: dict, best_of: int, b1: float, b2: float, on_complete) -> dict:
        """Simulate one game when the user is in the match. Avance le bracket
        uniquement quand le BO est terminé. on_complete reçoit un dict res
        compatible avec les fonctions `_*_update_*` historiques."""
        game = _intl_sim_one_game(m["team1"], m["team2"], b1, b2)
        status = _intl_apply_one_game(m, game)
        if status["completed"]:
            res = {
                "winner_id": status["winner_id"],
                "score1":    status["score1"],
                "score2":    status["score2"],
                "games":     status["games"],
            }
            on_complete(res)
        return status

    if intl["type"] == "msi":
        pi_ms = intl["play_in"]["matches"]; bk_ms = intl["bracket"]["matches"]
        if mid in pi_ms:
            m = pi_ms[mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            if m.get("locked"):    raise HTTPException(400, "Not ready")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            if _is_user_match(m):
                _resolve_user_bo(m, m["best_of"], b1, b2,
                                 lambda res: _msi_update_play_in(intl, mid, res))
            else:
                _msi_update_play_in(intl, mid, _intl_sim(m["team1"], m["team2"], m["best_of"], b1, b2))
        elif mid in bk_ms:
            m = bk_ms[mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            if m.get("locked"):    raise HTTPException(400, "Not ready")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            if _is_user_match(m):
                _resolve_user_bo(m, m["best_of"], b1, b2,
                                 lambda res: _msi_update_bracket(intl, mid, res))
            else:
                _msi_update_bracket(intl, mid, _intl_sim(m["team1"], m["team2"], m["best_of"], b1, b2))
        else: raise HTTPException(404, "Match not found")
    else:
        if mid == "pi_main":
            m = intl["play_in"]["match"]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            b1, b2 = _boost(m, m["team1"], m["team2"])

            def _on_pi_main_complete(res):
                m.update(winner_id=res["winner_id"], score1=res["score1"],
                         score2=res["score2"], games=res["games"])
                intl["play_in"]["qualified"] = res["winner_id"]
                intl["play_in"]["completed"] = True
                q_team = next((t for t in intl["play_in"]["teams"] if t["id"] == res["winner_id"]), None)
                teams_16 = intl["swiss"]["pre_qualified"] + ([q_team] if q_team else [])
                for t in teams_16:
                    t.update(sw_wins=0, sw_losses=0, sw_opponents=[],
                             sw_advanced=False, sw_eliminated=False)
                intl["swiss"]["teams"] = teams_16
                intl["stage"] = "swiss"
                _worlds_gen_swiss_round(intl)

            if _is_user_match(m):
                _resolve_user_bo(m, 5, b1, b2, _on_pi_main_complete)
            else:
                _on_pi_main_complete(_intl_sim(m["team1"], m["team2"], 5, b1, b2))
        elif mid.startswith("sw_"):
            sw_rounds = intl["swiss"]["rounds"]
            if not sw_rounds: raise HTTPException(400, "Swiss not started")
            cur = sw_rounds[-1]
            if mid not in cur["matches"]: raise HTTPException(404, "Match not found")
            m = cur["matches"][mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            if _is_user_match(m):
                _resolve_user_bo(m, m["best_of"], b1, b2,
                                 lambda res: _worlds_update_swiss(intl, mid, res))
            else:
                _worlds_update_swiss(intl, mid, _intl_sim(m["team1"], m["team2"], m["best_of"], b1, b2))
        else:
            km = intl["knockout"]["matches"]
            if mid not in km: raise HTTPException(404, "Match not found")
            m = km[mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            if m.get("locked"):    raise HTTPException(400, "Not ready")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            if _is_user_match(m):
                _resolve_user_bo(m, 5, b1, b2,
                                 lambda res: _worlds_update_knockout(intl, mid, res))
            else:
                _worlds_update_knockout(intl, mid, _intl_sim(m["team1"], m["team2"], 5, b1, b2))
    return intl

# ============ END INTERNATIONAL TOURNAMENT ============


@api_router.get("/tactics")
async def get_tactics():
    if not GAME_STATE["initialized"]:
        raise HTTPException(400, "Game not initialized")
    tactics = get_user_tactics()
    coherence = evaluate_coherence(tactics)
    return {"tactics": tactics, "coherence": coherence}


@api_router.post("/tactics")
async def update_tactics(body: dict):
    if not GAME_STATE["initialized"]:
        raise HTTPException(400, "Game not initialized")
    tactics = get_user_tactics()

    # Top-level fields
    for key in ("strong_side", "game_timing", "jungle_style", "jungle_pathing"):
        if key in body:
            tactics[key] = body[key]

    # Lane-level fields
    if "lanes" in body and isinstance(body["lanes"], dict):
        for pos, lane_data in body["lanes"].items():
            if pos in tactics["lanes"] and isinstance(lane_data, dict):
                tactics["lanes"][pos].update(lane_data)

    save_state()
    coherence = evaluate_coherence(tactics)
    return {"tactics": tactics, "coherence": coherence}


# ============ END TACTICS SYSTEM ============

# ============ CAREER HISTORY & ELO STATS ============

@api_router.get("/career/elo-history")
async def get_career_elo_history():
    """
    Get full ELO evolution history for a specific team across all splits.
    Returns ELO values and match results for each split.
    """
    if not GAME_STATE["initialized"]:
        raise HTTPException(status_code=400, detail="Game not initialized")

    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        return {"history": [], "current_team": None}

    user_team = GAME_STATE["teams"].get(user_team_id)
    if not user_team:
        return {"history": [], "current_team": None}

    history = []

    # Add current split stats
    current_elo = user_team.get("elo", initial_elo(user_team.get("rating", 80)))
    history.append({
        "split_key": "current",
        "split_label": f"{GAME_STATE.get('league', 'LEC')} {'Spring' if GAME_STATE['current_split'] == 1 else 'Summer'} {GAME_STATE['season']}",
        "season": GAME_STATE.get("season", 2026),
        "split_number": GAME_STATE.get("current_split", 1),
        "elo": current_elo,
        "elo_games": user_team.get("elo_games", 0),
        "wins": user_team.get("wins", 0),
        "losses": user_team.get("losses", 0),
        "is_current": True,
    })

    # Add historical splits (most recent first in GAME_STATE["history"], so reverse for chronological)
    for entry in GAME_STATE.get("history", []):
        history_entry = {
            "split_key": f"split_{entry.get('season', 2026)}_{entry.get('split_number', 1)}",
            "split_label": entry.get("split_label", f"Split {entry.get('split_number', 1)}"),
            "season": entry.get("season", 2026),
            "split_number": entry.get("split_number", 1),
            "final_rank": entry.get("final_rank", 10),
            "is_champion": entry.get("is_champion", False),
            "champion": entry.get("champion"),
            "wins": entry.get("wins", 0),
            "losses": entry.get("losses", 0),
            "budget": entry.get("budget", 0),
            "prestige": entry.get("prestige", 0),
            "elo_games": entry.get("total_games_played", 0),
            # ELO snapshot enregistré à la fin du split
            "elo": entry.get("elo_snapshot"),
            "is_current": False,
        }
        history.append(history_entry)

    return {
        "history": history,
        "current_team": {
            "id": user_team_id,
            "name": user_team.get("name", ""),
            "abbr": user_team.get("abbr", ""),
            "elo": current_elo,
            "elo_games": user_team.get("elo_games", 0),
        }
    }


@api_router.get("/career/elo-match-log")
async def get_career_elo_match_log():
    """
    Return per-match ELO log for the user team (one entry per match played).
    Each entry contains: season, split_number, split_label, week, opponent_abbr,
    won, elo_before, elo_after, delta, is_playoffs.
    Ordered chronologically (oldest first).
    """
    if not GAME_STATE.get("initialized"):
        return {"log": []}
    user_team_id = GAME_STATE.get("user_team")
    if not user_team_id:
        return {"log": []}
    log = list(GAME_STATE.get("user_elo_log", []))
    return {"log": log}


@api_router.get("/career/head-to-head/{team1_id}/{team2_id}")
async def get_head_to_head(team1_id: str, team2_id: str):
    """
    Get head-to-head record between two teams.
    Includes all matches played and ELO comparison.
    """
    if not GAME_STATE["initialized"]:
        raise HTTPException(status_code=400, detail="Game not initialized")

    teams = GAME_STATE.get("teams", {})
    team1 = teams.get(team1_id)
    team2 = teams.get(team2_id)

    if not team1 or not team2:
        raise HTTPException(status_code=404, detail="One or both teams not found")

    # Get all matches between these teams
    schedule = GAME_STATE.get("schedule", [])
    matches = []

    for match in schedule:
        if (match.get("team1") == team1_id and match.get("team2") == team2_id) or \
           (match.get("team1") == team2_id and match.get("team2") == team1_id):
            matches.append({
                "id": match.get("id"),
                "week": match.get("week"),
                "played": match.get("played", False),
                "winner": match.get("winner"),
                "score1": match.get("score1"),
                "score2": match.get("score2"),
                "team1_id": match.get("team1"),
                "team2_id": match.get("team2"),
            })

    # Count head-to-head results
    t1_wins = sum(1 for m in matches if m.get("winner") == team1_id)
    t2_wins = sum(1 for m in matches if m.get("winner") == team2_id)
    draws = len(matches) - t1_wins - t2_wins

    # Get ELO comparison (current or from history)
    t1_elo = team1.get("elo", initial_elo(team1.get("rating", 80)))
    t2_elo = team2.get("elo", initial_elo(team2.get("rating", 80)))

    from elo_system import win_probability
    t1_win_prob = round(win_probability(t1_elo, t2_elo) * 100, 1)
    t2_win_prob = round(win_probability(t2_elo, t1_elo) * 100, 1)

    return {
        "team1": {
            "id": team1_id,
            "name": team1.get("name", ""),
            "abbr": team1.get("abbr", ""),
            "rating": team1.get("rating"),
            "elo": t1_elo,
            "wins": team1.get("wins", 0),
            "losses": team1.get("losses", 0),
        },
        "team2": {
            "id": team2_id,
            "name": team2.get("name", ""),
            "abbr": team2.get("abbr", ""),
            "rating": team2.get("rating"),
            "elo": t2_elo,
            "wins": team2.get("wins", 0),
            "losses": team2.get("losses", 0),
        },
        "matches": matches,
        "record": {
            "total_matches": len(matches),
            "team1_wins": t1_wins,
            "team2_wins": t2_wins,
            "draws": draws,
            "win_probability": {
                "team1": t1_win_prob,
                "team2": t2_win_prob,
            }
        }
    }


@api_router.get("/career/split-stats")
async def get_split_stats(split: str = "current"):
    """
    Get detailed stats for a specific split (current or historical).
    Includes team performance, ELO changes, and match details.
    """
    if not GAME_STATE["initialized"]:
        raise HTTPException(status_code=400, detail="Game not initialized")

    user_team_id = GAME_STATE.get("user_team")

    if split == "current":
        # Current split stats
        user_team = GAME_STATE["teams"].get(user_team_id, {}) if user_team_id else {}

        # Get all played matches for user team
        schedule = GAME_STATE.get("schedule", [])
        user_matches = [m for m in schedule if m.get("played") and
                       (m.get("team1") == user_team_id or m.get("team2") == user_team_id)]

        return {
            "split_key": "current",
            "split_label": f"{GAME_STATE.get('league', 'LEC')} {'Spring' if GAME_STATE['current_split'] == 1 else 'Summer'} {GAME_STATE['season']}",
            "season": GAME_STATE.get("season", 2026),
            "split_number": GAME_STATE.get("current_split", 1),
            "user_team": {
                "id": user_team_id,
                "name": user_team.get("name", ""),
                "abbr": user_team.get("abbr", ""),
                "rating": user_team.get("rating"),
                "elo": user_team.get("elo", initial_elo(user_team.get("rating", 80))),
                "wins": user_team.get("wins", 0),
                "losses": user_team.get("losses", 0),
            },
            "matches": user_matches,
            "match_count": len(user_matches),
            "champion_stats": dict(GAME_STATE.get("champion_stats", {})),
        }
    else:
        # Historical split
        try:
            split_idx = int(split)
            history = GAME_STATE.get("history", [])
            entry = history[split_idx] if split_idx < len(history) else history[-1]
        except (ValueError, IndexError):
            history = GAME_STATE.get("history", [])
            entry = history[-1] if history else {}

        return {
            "split_key": f"split_{entry.get('season', 2026)}_{entry.get('split_number', 1)}",
            "split_label": entry.get("split_label", "Split"),
            "season": entry.get("season", 2026),
            "split_number": entry.get("split_number", 1),
            "user_team": {
                "id": user_team_id,
                "name": entry.get("team_name", ""),
                "abbr": entry.get("team_abbr", ""),
                "final_rank": entry.get("final_rank", 10),
                "is_champion": entry.get("is_champion", False),
                "champion": entry.get("champion"),
                "wins": entry.get("wins", 0),
                "losses": entry.get("losses", 0),
                "budget": entry.get("budget", 0),
                "prestige": entry.get("prestige", 0),
            },
            "champion_stats": entry.get("champion_stats", {}),
            "match_count": entry.get("total_games_played", 0),
        }


# ── Inbox endpoints ───────────────────────────────────────────────────────────

@api_router.get("/inbox")
async def get_inbox():
    if not GAME_STATE["initialized"]:
        ensure_initialized()
    msgs = GAME_STATE.get("inbox", [])
    return {
        "messages": list(reversed(msgs)),
        "unread_board": sum(1 for m in msgs if not m["read"] and m["type"] == "board"),
        "unread_soloq": sum(1 for m in msgs if not m["read"] and m["type"] == "soloq"),
        "unread_international": sum(1 for m in msgs if not m["read"] and m["type"] == "international"),
        "unread_total": sum(1 for m in msgs if not m["read"]),
    }


@api_router.post("/inbox/read-all")
async def inbox_read_all():
    for msg in GAME_STATE.get("inbox", []):
        msg["read"] = True
    save_state()
    return {"ok": True}


@api_router.post("/inbox/{msg_id}/read")
async def inbox_read_one(msg_id: str):
    for msg in GAME_STATE.get("inbox", []):
        if msg["id"] == msg_id:
            msg["read"] = True
            break
    save_state()
    return {"ok": True}


# ── Multiplayer v2 — WebSockets + SQLite (DELETED) ───────────────────────────
# The legacy `/api/mp/*` endpoints, their SQLite-backed `mp_db`, `mp_logic`,
# and `mp_websocket` modules have been replaced by the MP-as-shared-solo
# refactor. See `sessions.py` + the `/api/mp2/*` endpoints + the session_id
# middleware below. Only the WebSocket imports are preserved because the new
# `/ws/mp2/{sid}` endpoint (further down) still needs them.
from fastapi import WebSocket, WebSocketDisconnect


# ── NEW: MP-as-shared-solo endpoints (Phase 2c) ───────────────────────────────
# These /mp2/* endpoints use the new `sessions` registry. Combined with
# `use_session_state()` they let solo endpoints serve MP sessions transparently
# via the `?session_id=...` query param.

def _mp2_public_info(sess: "_sessions.Session", token: str | None = None) -> dict:
    """Shape a session for the client. Never leaks other players' tokens."""
    my_team = sess.players.get(token) if token else None
    return {
        "sid": sess.sid,
        "code": sess.code,
        "league": sess.league,
        "phase": sess.phase,
        "players": [
            {"username": sess.usernames.get(t, "?"), "team_id": tid}
            for t, tid in sess.players.items()
        ],
        "my_team_id": my_team,
        # Ready votes: { action -> [usernames who have voted ready] }.
        # Lets the UI show "Waiting for Charlie to ready up…"
        "ready": _sessions.ready_snapshot(sess),
        # Convenience: which actions am I ready for?
        "my_ready": sorted(
            action for action, tokens in sess.ready.items()
            if token and token in tokens
        ),
    }


@api_router.post("/mp2/create")
def mp2_create(body: _Mp2CreateBody):
    """Create a new MP session backed by an isolated clone of solo GAME_STATE."""
    try:
        sess, token = _sessions.create_session(
            body.league, body.username, build_initial_state
        )
    except Exception as exc:
        logger.exception("mp2_create failed")
        raise HTTPException(500, f"Création de session MP échouée: {exc}")
    return {"sid": sess.sid, "code": sess.code, "token": token,
            "username": body.username,
            "info": _mp2_public_info(sess, token)}


@api_router.post("/mp2/join")
def mp2_join(body: _Mp2JoinBody):
    """Join an existing session by its short code."""
    try:
        sess, token = _sessions.join_session(body.code, body.username)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return {"sid": sess.sid, "code": sess.code, "token": token,
            "username": body.username,
            "info": _mp2_public_info(sess, token)}


@api_router.post("/mp2/reconnect")
def mp2_reconnect(body: _Mp2JoinBody):
    """Re-attach to an existing session as an already-registered username.

    Searches `session.usernames` for a token whose display name matches
    `body.username` (case-insensitive). Returns the existing token so the
    client can restore its session without creating a new slot.

    NOTE: no authentication — trivially spoofable. Intended for LAN/Tailscale
    coop between trusted players. Do not expose this to the public internet.
    """
    code = (body.code or "").strip().upper()
    wanted = (body.username or "").strip().lower()
    if not code or not wanted:
        raise HTTPException(400, "Code et pseudo requis")

    sess = _sessions.get_session_by_code(code)
    if sess is None:
        raise HTTPException(404, f"Session {code} introuvable")

    match = next(
        (tok for tok, name in sess.usernames.items()
         if (name or "").strip().lower() == wanted),
        None,
    )
    if match is None:
        raise HTTPException(404, f"Pseudo '{body.username}' inconnu dans cette session")

    return {"sid": sess.sid, "code": sess.code, "token": match,
            "username": sess.usernames.get(match, body.username),
            "info": _mp2_public_info(sess, match)}


@api_router.get("/mp2/{sid}/info")
def mp2_info(sid: str, token: str | None = None):
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    return _mp2_public_info(sess, token)


@api_router.post("/mp2/{sid}/team")
async def mp2_pick_team(sid: str, body: _Mp2TeamBody):
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    try:
        _sessions.assign_team(sess, body.token, body.team_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    # Flip session phase once every joined human has picked.
    if sess.phase == "team_pick" and all(tid is not None for tid in sess.players.values()):
        sess.phase = "running"
        sess._dirty = True
    try:
        await _sessions.broadcast(sid, "team_picked", {
            "username": sess.usernames.get(body.token, "?"),
            "team_id": body.team_id,
            "phase": sess.phase,
        })
    except Exception:
        logger.exception("broadcast team_picked failed (sid=%s)", sid[:8])
    return _mp2_public_info(sess, body.token)


# ── Ready/vote gate for progression ─────────────────────────────────────────
# Progression actions (simulate season, play next match, advance to the next
# split/phase) are shared by every player in a session. They must not run
# until every human has clicked "ready". The client POSTs /ready to signal
# intent; once the last vote lands, the server runs the action and clears
# the ready set. A companion DELETE endpoint un-votes if the player changes
# their mind before the action fires.

_MP2_READY_ACTIONS = {
    "season/simulate",
    "season/start",
    "split/next",
}
_MP2_MATCH_ACTION_PREFIX = "match:"  # match:<match_id> — per-match gate


def _mp2_validate_action(action: str) -> None:
    if action in _MP2_READY_ACTIONS:
        return
    if action.startswith(_MP2_MATCH_ACTION_PREFIX) and len(action) > len(_MP2_MATCH_ACTION_PREFIX):
        return
    raise HTTPException(400, f"Action de ready inconnue: {action}")


async def _mp2_run_ready_action(sess: "_sessions.Session", action: str) -> dict:
    """Execute the shared progression action under the MP session's state.

    Runs inside the same GAME_STATE swap the middleware would apply for a
    normal HTTP call — we enter swap mode manually because /mp2/* paths are
    excluded from the middleware (they own their own session routing).
    """
    async with _swap_lock, _ThreadLockAsyncBridge(_state_thread_lock):
        global _mp_swap_depth
        solo_snapshot = dict(GAME_STATE)
        GAME_STATE.clear()
        GAME_STATE.update(sess.state)
        # Advertise every human team to MP-aware endpoints. Set *before* any
        # handler runs so start_season / advance_to_next_split can preserve
        # every human roster rather than reading the None user_team.
        human_team_ids = [tid for tid in sess.players.values() if tid]
        GAME_STATE["_mp_user_team_ids"] = human_team_ids
        # Seed user_team with any one human so legacy single-team code paths
        # that read user_team (history entry, etc.) still work coherently.
        if human_team_ids and not GAME_STATE.get("user_team"):
            GAME_STATE["user_team"] = human_team_ids[0]
        try:
            _rebuild_meta_lookup()
        except Exception:
            logger.exception("meta rebuild on ready-run failed")
        _mp_swap_depth += 1
        try:
            if action == "season/simulate":
                result = await simulate_full_season()  # existing solo endpoint body
            elif action == "season/start":
                result = await start_season()
            elif action == "split/next":
                result = await advance_to_next_split()
            elif action.startswith(_MP2_MATCH_ACTION_PREFIX):
                match_id = action[len(_MP2_MATCH_ACTION_PREFIX):]
                # Match-play gate: the actual /match/simulate call is made by
                # the player who drafted. Here we only unlock the gate, the
                # client re-posts /match/simulate on its own. Returning a
                # marker payload keeps the frontend simple.
                result = {"unlocked": True, "match_id": match_id}
            else:
                raise HTTPException(400, f"Action non exécutable: {action}")
            # Persist mutations back into the session. Strip MP-only hints
            # so they don't leak into per-player views on the next swap.
            GAME_STATE.pop("_mp_user_team_ids", None)
            # user_team in sess.state must stay None — each player's team is
            # tracked via sess.players and restored by the middleware on a
            # per-token basis.
            GAME_STATE["user_team"] = None
            sess.state.clear()
            sess.state.update(GAME_STATE)
            _sessions.mark_dirty(sess.sid)
            return result if isinstance(result, dict) else {"ok": True}
        finally:
            _mp_swap_depth -= 1
            GAME_STATE.clear()
            GAME_STATE.update(solo_snapshot)
            if solo_snapshot.get("league"):
                try:
                    _rebuild_meta_lookup()
                except Exception:
                    logger.exception("meta rebuild on ready swap-out failed")


@api_router.post("/mp2/{sid}/ready")
async def mp2_ready(sid: str, body: _Mp2ReadyBody):
    """Vote ready for a shared progression action.

    Returns the session info (with `ready` map updated). When every human
    has voted, the action runs server-side and the ready set is cleared; the
    response also includes `fired=True` and the action's result payload.
    """
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    _mp2_validate_action(body.action)
    try:
        everyone_ready = _sessions.mark_ready(sess, body.action, body.token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    fired = False
    result: dict = {}
    if everyone_ready:
        try:
            result = await _mp2_run_ready_action(sess, body.action)
            fired = True
        finally:
            _sessions.clear_ready(sess, body.action)

    # Always notify peers so their UI updates (ready dots, or the post-action
    # state change that fires on everyone_ready).
    try:
        await _sessions.broadcast(sid, "ready_changed", {
            "action": body.action, "fired": fired,
        })
        if fired:
            await _sessions.broadcast(sid, "state_changed", {
                "trigger": body.action,
            })
    except Exception:
        logger.exception("broadcast after /mp2/ready failed (sid=%s)", sid[:8])

    info = _mp2_public_info(sess, body.token)
    return {"info": info, "fired": fired, "result": result}


@api_router.delete("/mp2/{sid}/ready")
async def mp2_unready(sid: str, token: str, action: str):
    """Withdraw a ready vote before the action fires."""
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    _mp2_validate_action(action)
    _sessions.unmark_ready(sess, action, token)
    try:
        await _sessions.broadcast(sid, "ready_changed", {
            "action": action, "fired": False,
        })
    except Exception:
        logger.exception("broadcast after /mp2/unready failed (sid=%s)", sid[:8])
    return _mp2_public_info(sess, token)


@api_router.get("/mp2/sessions")
def mp2_list():
    """Debug/health listing of active sessions."""
    return _sessions.list_sessions()


# ── MP2 versus draft (2 humans face off) ──────────────────────────────────────
# When both humans in an MP session are scheduled to play each other, they go
# through a shared alternating pick/ban instead of the solo draft (where the
# opponent side is played by AI). The flow:
#   1. A client posts /mp2/{sid}/draft/start with {token, match_id}.
#      Server initialises `session.mp_draft`, determines sides from
#      team1/team2 of the match (team1=blue=side 1, team2=red=side 2), and
#      broadcasts `mp_draft_update`.
#   2. Clients POST /mp2/{sid}/draft/action on their turn. Server validates
#      side, applies the action, advances step, broadcasts.
#   3. When step == len(sequence), mp_draft.completed = True. The state is
#      reconciled into session.state["draft_state"] so that a subsequent
#      /match/simulate?session_id=...&user_draft=... can consume the same
#      picks for either player.
#
# Reconnect: since `mp_draft` is persisted on the session, a dropped client
# refetches via GET /mp2/{sid}/draft. No timeout — the draft just waits.

def _mp_draft_sequence() -> list:
    return [[kind, 1 if actor == "user" else 2] for (actor, kind) in DRAFT_SEQUENCE]


def _mp_draft_find_match(state: dict, match_id: str) -> dict | None:
    """Look up a match by id in the session's schedule or playoffs bracket."""
    for m in state.get("schedule", []) or []:
        if m.get("id") == match_id:
            return m
    bracket = state.get("playoffs_bracket") or {}
    for m in bracket.get("matches", []) or []:
        if m.get("id") == match_id:
            return m
    return None


def _mp_draft_public(sess: "_sessions.Session", token: str | None) -> dict | None:
    """Return the draft state with `_mySide` hint for the caller.

    Explicitly whitelists non-sensitive fields — NEVER spread `sess.mp_draft`
    directly because `side` maps auth tokens to player sides and must not leak.
    """
    d = sess.mp_draft
    if not d:
        return None
    my_side = d.get("side", {}).get(token) if token else None
    step = d.get("step", 0)
    seq = d.get("sequence", [])
    current = seq[step] if 0 <= step < len(seq) else None
    return {
        "match_id": d.get("match_id"),
        "team1_id": d.get("team1_id"),
        "team2_id": d.get("team2_id"),
        "step": step,
        "sequence": seq,
        "bans": d.get("bans", {"1": [], "2": []}),
        "picks": d.get("picks", {"1": [], "2": []}),
        "fearless_excluded": d.get("fearless_excluded", []),
        "completed": d.get("completed", False),
        "_mySide": my_side,
        "current_side": current[1] if current else None,
        "current_action": current[0] if current else None,
    }


def _mp_draft_all_champs(d: dict) -> set[str]:
    taken: set[str] = set()
    for side in ("1", "2"):
        taken.update(d["bans"].get(side, []))
        taken.update(p["champion"] for p in d["picks"].get(side, []))
    return taken


def _mp_draft_needed_positions(picks: list) -> list:
    taken = {p["position"] for p in picks if p.get("position")}
    all_pos = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
    needed = [p for p in all_pos if p not in taken]
    return needed if needed else all_pos


@api_router.post("/mp2/{sid}/draft/start")
async def mp2_draft_start(sid: str, body: _Mp2DraftStartBody):
    """Initialise a shared versus draft between the 2 humans in the session."""
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    if body.token not in sess.players:
        raise HTTPException(403, "Token invalide")

    # Idempotency: when both peers receive the ready-gate broadcast, both
    # call /draft/start concurrently. The second call must NOT wipe the first
    # call's progress — return the existing draft instead.
    if (
        sess.mp_draft is not None
        and sess.mp_draft.get("match_id") == body.match_id
        and not sess.mp_draft.get("completed")
    ):
        return _mp_draft_public(sess, body.token)

    match = _mp_draft_find_match(sess.state, body.match_id)
    if match is None:
        raise HTTPException(404, f"Match {body.match_id} introuvable dans la session")

    team1_id = match.get("team1")
    team2_id = match.get("team2")
    # Find which token plays team1 and which plays team2.
    token_t1 = next((t for t, tid in sess.players.items() if tid == team1_id), None)
    token_t2 = next((t for t, tid in sess.players.items() if tid == team2_id), None)
    if token_t1 is None or token_t2 is None:
        raise HTTPException(409, "Ce match n'est pas un PvP entre 2 joueurs de la session")

    # Fearless: reuse solo logic for playoff matches.
    fearless: list = []
    try:
        bracket = sess.state.get("playoffs_bracket") or {}
        if any(m.get("id") == body.match_id for m in bracket.get("matches", []) or []):
            fearless = sorted(_get_fearless_used(match))
    except Exception:
        logger.exception("mp2_draft_start: fearless lookup failed")

    sess.mp_draft = {
        "match_id": body.match_id,
        "team1_id": team1_id,
        "team2_id": team2_id,
        "side": {token_t1: 1, token_t2: 2},
        "step": 0,
        "sequence": _mp_draft_sequence(),
        "bans":  {"1": [], "2": []},
        "picks": {"1": [], "2": []},
        "fearless_excluded": fearless,
        "completed": False,
    }
    sess._dirty = True
    try:
        await _sessions.broadcast(sid, "mp_draft_update", {"reason": "start"})
    except Exception:
        logger.exception("broadcast mp_draft_update(start) failed (sid=%s)", sid[:8])
    return _mp_draft_public(sess, body.token)


@api_router.get("/mp2/{sid}/draft")
def mp2_draft_get(sid: str, token: str | None = None):
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    # Require a valid session token to prevent sid-only enumeration.
    if token is None or token not in sess.players:
        raise HTTPException(403, "Token invalide")
    return _mp_draft_public(sess, token)


@api_router.post("/mp2/{sid}/draft/action")
async def mp2_draft_action(sid: str, body: _Mp2DraftActionBody):
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    d = sess.mp_draft
    if not d:
        raise HTTPException(400, "Aucun draft MP en cours")
    if d.get("completed"):
        raise HTTPException(400, "Draft déjà complet")

    my_side = d.get("side", {}).get(body.token)
    if my_side is None:
        raise HTTPException(403, "Token sans side dans ce draft")

    step = d["step"]
    seq = d["sequence"]
    if step >= len(seq):
        raise HTTPException(400, "Draft déjà complet")
    expected_kind, expected_side = seq[step]
    if expected_side != my_side:
        raise HTTPException(409, "Ce n'est pas votre tour")
    if body.action != expected_kind:
        raise HTTPException(400, f"Action attendue: {expected_kind}")

    champ = body.champion
    if champ in _mp_draft_all_champs(d):
        raise HTTPException(400, "Champion déjà pris/banni")
    if body.action == "pick" and champ in d.get("fearless_excluded", []):
        raise HTTPException(400, f"{champ} interdit par la règle Fearless")

    side_key = str(my_side)
    if body.action == "ban":
        d["bans"][side_key].append(champ)
    else:
        position = body.position
        if not position:
            meta = META_LOOKUP.get(champ)
            if meta:
                position = meta.get("position")
        if not position:
            needed = _mp_draft_needed_positions(d["picks"][side_key])
            if needed:
                position = needed[0]
        d["picks"][side_key].append({"champion": champ, "position": position})

    d["step"] = step + 1
    if d["step"] >= len(seq):
        d["completed"] = True
        # Reconcile mutates sess.state["draft_state"]; serialise against the
        # session-swap middleware so its write-back can't wipe our update.
        async with _swap_lock, _ThreadLockAsyncBridge(_state_thread_lock):
            _reconcile_mp_draft_into_state(sess)

    sess._dirty = True
    try:
        await _sessions.broadcast(sid, "mp_draft_update", {
            "reason": "action",
            "step": d["step"],
            "completed": d["completed"],
        })
    except Exception:
        logger.exception("broadcast mp_draft_update(action) failed (sid=%s)", sid[:8])
    return _mp_draft_public(sess, body.token)


def _reconcile_mp_draft_into_state(sess: "_sessions.Session") -> None:
    """Mirror the completed versus draft into session.state['draft_state'] so
    that the solo /match/simulate path sees the right picks/bans from either
    player's perspective. Each player is `user` from their own side.
    """
    d = sess.mp_draft
    if not d:
        return
    # We store a "symmetric" draft_state: the solo code reads user_* and
    # enemy_* based on whoever's request it's serving. At /match/simulate
    # time, the request carries user_draft in the body, so this mirror is
    # really only useful for UI fetches. We write it from side-1's POV
    # (blue = user) and let the request body override as needed.
    sess.state["draft_state"] = {
        "step": d["step"],
        "phase": "complete",
        "current_turn": None,
        "user_bans":  list(d["bans"].get("1", [])),
        "enemy_bans": list(d["bans"].get("2", [])),
        "user_picks":  [dict(p) for p in d["picks"].get("1", [])],
        "enemy_picks": [dict(p) for p in d["picks"].get("2", [])],
        "banned_champions": list(d["bans"].get("1", []))
                         + list(d["bans"].get("2", [])),
        "picked_champions": [p["champion"] for p in d["picks"].get("1", [])]
                         + [p["champion"] for p in d["picks"].get("2", [])],
        "user_picked_champions":  [p["champion"] for p in d["picks"].get("1", [])],
        "enemy_picked_champions": [p["champion"] for p in d["picks"].get("2", [])],
        "fearless_excluded": list(d.get("fearless_excluded", [])),
        # Extra metadata used by /match/simulate in MP mode
        "_mp_side1_team": d.get("team1_id"),
        "_mp_side2_team": d.get("team2_id"),
    }


# ── MP2 unified WebSocket ─────────────────────────────────────────────────────
# One WS per session. The server broadcasts state/chat events to every live
# subscriber via `sessions.broadcast()`. Closed sockets are pruned
# automatically.
@app.websocket("/ws/mp2/{sid}")
async def mp2_websocket(websocket: WebSocket, sid: str, token: str):
    """WebSocket for an MP2 session.

    - Validates `token` against `session.players`.
    - Sends an initial `hello` snapshot with session info.
    - Subscribes the socket for server-pushed broadcasts.
    - Handles client messages: `ping` (→ `pong`), `chat` (fan-out to peers).
    """
    session = _sessions.get_session(sid)
    if session is None or token not in session.players:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    _sessions.subscribe(session, websocket)
    username = session.usernames.get(token, "?")
    logger.info("MP2 WS connected sid=%s user=%s", sid[:8], username)

    try:
        # Initial snapshot for this socket only
        await websocket.send_json({
            "event": "hello",
            "data": _mp2_public_info(session, token),
        })
        # Let peers know someone joined
        await _sessions.broadcast(sid, "peer_joined", {"username": username})

        # Client message loop with 30s heartbeat timeout
        missed = 0
        while True:
            try:
                msg = await _asyncio.wait_for(websocket.receive_json(), timeout=30.0)
                missed = 0
            except _asyncio.TimeoutError:
                missed += 1
                if missed >= 2:
                    logger.info("MP2 WS heartbeat timeout sid=%s user=%s",
                                sid[:8], username)
                    break
                try:
                    await websocket.send_json({"event": "ping", "data": {}})
                except Exception:
                    break
                continue

            kind = msg.get("type", "")
            if kind == "ping":
                await websocket.send_json({"event": "pong", "data": {}})
            elif kind == "pong":
                pass
            elif kind == "chat":
                text = str(msg.get("text", ""))[:200]
                await _sessions.broadcast(sid, "chat", {
                    "username": username,
                    "text": text,
                })
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("MP2 WS error sid=%s user=%s", sid[:8], username, exc_info=True)
    finally:
        _sessions.unsubscribe(session, websocket)
        try:
            await _sessions.broadcast(sid, "peer_left", {"username": username})
        except Exception:
            logger.exception("MP2 WS peer_left broadcast failed")


# ── FastAPI lifecycle — autosave + reload MP sessions ─────────────────────────
# Attached via `router.add_event_handler` (Starlette primitive) instead of
# `@app.on_event` to avoid the FastAPI deprecation warning.
async def _mp2_startup() -> None:
    try:
        n = _sessions.load_all()
        if n:
            logger.info("MP2: restored %d session(s) from disk", n)
    except Exception:
        logger.exception("MP2: load_all failed at startup")
    try:
        _sessions.start_autosave()
        logger.info("MP2: autosave started (%.0fs interval)",
                    _sessions._AUTOSAVE_INTERVAL_S)
    except Exception:
        logger.exception("MP2: failed to start autosave")


async def _mp2_shutdown() -> None:
    try:
        await _sessions.stop_autosave()
    except Exception:
        logger.exception("MP2: stop_autosave failed")
    try:
        n = _sessions.save_all_dirty()
        if n:
            logger.info("MP2: flushed %d dirty session(s) on shutdown", n)
    except Exception:
        logger.exception("MP2: save_all_dirty failed on shutdown")


# Attach to the router's event hooks (Starlette primitive — not deprecated).
app.router.add_event_handler("startup", _mp2_startup)
app.router.add_event_handler("shutdown", _mp2_shutdown)


# ── MP2 session_id middleware ─────────────────────────────────────────────────
# Any solo endpoint automatically becomes a multiplayer endpoint when called
# with `?session_id=<sid>`. The middleware swaps GAME_STATE to the session's
# state around the request, so the solo code path runs untouched. Mutations
# are copied back into the session and persisted by the autosave loop.
#
# Paths that already own session routing (`/api/mp2/*` and WebSockets) are
# skipped so their handlers can manage sessions directly.
_MP2_SKIP_PATH_PREFIXES = ("/api/mp2/", "/api/mp2", "/ws/")


@app.middleware("http")
async def _mp2_session_swap_middleware(request, call_next):
    path = request.url.path
    if any(path.startswith(p) for p in _MP2_SKIP_PATH_PREFIXES):
        return await call_next(request)

    sid = request.query_params.get("session_id")
    if not sid:
        # Solo request. Serialise against any in-flight MP swap so a solo
        # GET cannot read GAME_STATE mid-swap (which would return the
        # swapped-in session's data). Holding _swap_lock for the duration
        # of the call also serialises against the threadpool path via
        # _state_thread_lock acquired below.
        async with _swap_lock:
            with _state_thread_lock:
                return await call_next(request)

    sess = _sessions.get_session(sid)
    if sess is None:
        # Don't 404 silently — let the client know the session is gone.
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=404,
            content={"detail": f"MP session {sid} introuvable"},
        )

    mutating = request.method.upper() in ("POST", "PUT", "PATCH", "DELETE")
    # Per-request user_team resolution: in MP each player has their own team,
    # stored in session.players[token]. Override the shared state's user_team
    # for the duration of this request so the solo code path sees the right
    # perspective. We restore the pre-call value on swap-out so the per-player
    # override doesn't leak into the persisted session state.
    token = request.query_params.get("mp_token")
    per_player_team = sess.players.get(token) if token else None

    async with _swap_lock, _ThreadLockAsyncBridge(_state_thread_lock):
        global _mp_swap_depth
        solo_snapshot = dict(GAME_STATE)
        GAME_STATE.clear()
        GAME_STATE.update(sess.state)
        # Advertise every human team so MP-aware solo endpoints (transfers,
        # offseason, start_season) can distinguish humans from AI. Preserve
        # what was on sess.state so we can restore exact bytes on swap-out.
        mp_teams_snapshot = sess.state.get("_mp_user_team_ids")
        human_team_ids = [tid for tid in sess.players.values() if tid]
        GAME_STATE["_mp_user_team_ids"] = human_team_ids
        try:
            _rebuild_meta_lookup()
        except Exception:
            logger.exception("meta rebuild on swap-in failed (sid=%s)", sid[:8])
        # Apply per-player view of user_team. Stash the session's stored value
        # so we can restore it afterwards and it doesn't get overwritten by a
        # player-scoped view.
        session_user_team_snapshot = sess.state.get("user_team")
        if per_player_team:
            GAME_STATE["user_team"] = per_player_team
        _mp_swap_depth += 1
        try:
            response = await call_next(request)
            # Persist mutations back into the session ONLY when the request
            # actually succeeded. The inner ExceptionMiddleware converts
            # HTTPException into a 4xx Response, so a partial mutation that
            # raised mid-flow would otherwise be committed to disk on the
            # next autosave. Skip GETs too — they shouldn't mutate, and if
            # one does that's a separate bug, not a reason to persist.
            if mutating and 200 <= response.status_code < 300:
                # `user_team` is special: when the caller supplies `mp_token`,
                # it is a per-player view that must NOT leak into the shared
                # session state (would cause joueur 2 to see joueur 1's team
                # on reconnect). When there is no mp_token (solo-style call
                # into a session), the write is the session's own mutation
                # and must be persisted.
                sess.state.clear()
                sess.state.update(GAME_STATE)
                if token:
                    if session_user_team_snapshot is not None:
                        sess.state["user_team"] = session_user_team_snapshot
                    else:
                        sess.state.pop("user_team", None)
                # `_mp_user_team_ids` is a per-request hint; restore whatever
                # the session previously held (normally nothing) so it does
                # not leak into on-disk session state.
                if mp_teams_snapshot is None:
                    sess.state.pop("_mp_user_team_ids", None)
                else:
                    sess.state["_mp_user_team_ids"] = mp_teams_snapshot
                _sessions.mark_dirty(sid)
                # Notify all subscribers so they refetch.
                try:
                    await _sessions.broadcast(sid, "state_changed", {
                        "path": request.url.path,
                        "method": request.method,
                    })
                except Exception:
                    logger.exception("broadcast state_changed failed (sid=%s)", sid[:8])
            return response
        finally:
            _mp_swap_depth -= 1
            GAME_STATE.clear()
            GAME_STATE.update(solo_snapshot)
            if solo_snapshot.get("league"):
                try:
                    _rebuild_meta_lookup()
                except Exception:
                    logger.exception("meta rebuild on swap-out failed")


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(','),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
)

logger.info("LM26 backend ready — CORS origins: %s",
            os.environ.get('CORS_ORIGINS', 'http://localhost:3000'))