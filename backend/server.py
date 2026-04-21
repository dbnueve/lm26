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
from persistence import save_state, load_state, _sync_state_if_stale, register_post_load_hook  # noqa: E402
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
    {"id": "navi","name": "Natus Vincere", "abbr": "NAVI", "country": "UA", "rating": 86, "budget": 3800000, "prestige": 82},
    {"id": "vit", "name": "Team Vitality", "abbr": "VIT",  "country": "FR", "rating": 85, "budget": 4200000, "prestige": 83},
    {"id": "koi", "name": "Movistar KOI",  "abbr": "KOI",  "country": "ES", "rating": 84, "budget": 3800000, "prestige": 85},
    {"id": "gx",  "name": "GIANTX",        "abbr": "GX",   "country": "ES", "rating": 83, "budget": 3200000, "prestige": 78},
    {"id": "bds", "name": "Shifters",      "abbr": "SFT",  "country": "FR", "rating": 81, "budget": 3200000, "prestige": 74},
    {"id": "th",  "name": "Team Heretics", "abbr": "TH",   "country": "ES", "rating": 81, "budget": 3400000, "prestige": 77},
    {"id": "fnc", "name": "Fnatic",        "abbr": "FNC",  "country": "EU", "rating": 79, "budget": 4500000, "prestige": 94},
    {"id": "sk",  "name": "SK Gaming",     "abbr": "SK",   "country": "DE", "rating": 77, "budget": 3000000, "prestige": 75}
]

# Real LEC 2026 Rosters (Starters only)
REAL_ROSTERS = {
    "fnc": {
        "TOP":     {"name": "Empyros",   "full_name": "Panagiotis Tantis",        "nationality": "GR", "age": 20, "rating": 80, "potential": 91},
        "JUNGLE":  {"name": "Razork",    "full_name": "Iván Martín Díaz",         "nationality": "ES", "age": 25, "rating": 85, "potential": 84},
        "MID":     {"name": "Vladi",     "full_name": "Vladimiros Kourtidis",     "nationality": "GR", "age": 22, "rating": 85, "potential": 90},
        "ADC":     {"name": "Upset",     "full_name": "Elias Lipp",               "nationality": "DE", "age": 26, "rating": 88, "potential": 92},
        "SUPPORT": {"name": "Lospa",     "full_name": "Park Joon-hyeong",         "nationality": "KR", "age": 23, "rating": 78, "potential": 88}
    },
    "g2": {
        "TOP":     {"name": "BrokenBlade","full_name": "Sergen Çelik",            "nationality": "DE", "age": 25, "rating": 90, "potential": 91},
        "JUNGLE":  {"name": "SkewMond",  "full_name": "Rudy Semaan",              "nationality": "LB", "age": 23, "rating": 91, "potential": 93},
        "MID":     {"name": "Caps",      "full_name": "Rasmus Borregaard Winther","nationality": "DK", "age": 26, "rating": 92, "potential": 96},
        "ADC":     {"name": "Hans Sama", "full_name": "Steven Liv",               "nationality": "FR", "age": 26, "rating": 90, "potential": 93},
        "SUPPORT": {"name": "Labrov",    "full_name": "Labros Papoutsakis",       "nationality": "GR", "age": 24, "rating": 89, "potential": 89}
    },
    "gx": {
        "TOP":     {"name": "Lot",       "full_name": "Eren Yıldız",              "nationality": "TR", "age": 22, "rating": 83, "potential": 88},
        "JUNGLE":  {"name": "ISMA",      "full_name": "Ismaïl Boualem",           "nationality": "FR", "age": 22, "rating": 84, "potential": 88},
        "MID":     {"name": "Jackies",   "full_name": "Adam Jeřábek",             "nationality": "CZ", "age": 21, "rating": 82, "potential": 89},
        "ADC":     {"name": "Noah",      "full_name": "Oh Hyeon-taek",            "nationality": "KR", "age": 23, "rating": 85, "potential": 89},
        "SUPPORT": {"name": "Jun",       "full_name": "Yoon Se-jun",              "nationality": "KR", "age": 25, "rating": 86, "potential": 85}
    },
    "kc": {
        "TOP":     {"name": "Canna",     "full_name": "Kim Chang-dong",           "nationality": "KR", "age": 25, "rating": 91, "potential": 90},
        "JUNGLE":  {"name": "Yike",      "full_name": "Martin Sundelin",          "nationality": "SE", "age": 23, "rating": 90, "potential": 90},
        "MID":     {"name": "kyeahoo",   "full_name": "Kang Ye-hoo",              "nationality": "KR", "age": 20, "rating": 90, "potential": 94},
        "ADC":     {"name": "Caliste",   "full_name": "Caliste Henry-Hennebert", "nationality": "FR", "age": 22, "rating": 91, "potential": 93},
        "SUPPORT": {"name": "Busio",     "full_name": "Alan Cwalina",             "nationality": "PL", "age": 21, "rating": 90, "potential": 91}
    },
    "koi": {
        "TOP":     {"name": "Myrwn",     "full_name": "Alex Villarejo",           "nationality": "ES", "age": 22, "rating": 86, "potential": 89},
        "JUNGLE":  {"name": "Elyoya",    "full_name": "Javier Prades Batalla",    "nationality": "ES", "age": 25, "rating": 91, "potential": 92},
        "MID":     {"name": "jojopyun",  "full_name": "Joon Pyun",               "nationality": "CA", "age": 22, "rating": 90, "potential": 92},
        "ADC":     {"name": "Supa",      "full_name": "David Martínez García",    "nationality": "ES", "age": 23, "rating": 89, "potential": 90},
        "SUPPORT": {"name": "Alvaro",    "full_name": "Álvaro Fernández del Amo", "nationality": "ES", "age": 23, "rating": 87, "potential": 88}
    },
    "navi": {
        "TOP":     {"name": "Maynter",   "full_name": "Volodymyr Sorokin",        "nationality": "UA", "age": 21, "rating": 83, "potential": 89},
        "JUNGLE":  {"name": "Rhilech",   "full_name": "Enes Uçan",               "nationality": "TR", "age": 22, "rating": 85, "potential": 89},
        "MID":     {"name": "Poby",      "full_name": "Yun Sung-won",             "nationality": "KR", "age": 22, "rating": 85, "potential": 90},
        "ADC":     {"name": "SamD",      "full_name": "Lee Jae-hoon",             "nationality": "KR", "age": 23, "rating": 84, "potential": 91},
        "SUPPORT": {"name": "Parus",     "full_name": "Polat Çiçek",              "nationality": "TR", "age": 24, "rating": 83, "potential": 87}
    },
    "sk": {
        "TOP":     {"name": "Wunder",    "full_name": "Martin Hansen",            "nationality": "DK", "age": 26, "rating": 77, "potential": 83},
        "JUNGLE":  {"name": "Skeanz",    "full_name": "Duncan Marquet",           "nationality": "FR", "age": 24, "rating": 77, "potential": 84},
        "MID":     {"name": "Lider",     "full_name": "Adam Ilyasov",             "nationality": "RU", "age": 24, "rating": 75, "potential": 84},
        "ADC":     {"name": "Jopa",      "full_name": "Josip Čančar",             "nationality": "HR", "age": 22, "rating": 80, "potential": 88},
        "SUPPORT": {"name": "Mikyx",     "full_name": "Mihael Mehle",             "nationality": "SI", "age": 27, "rating": 85, "potential": 84}
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
        "JUNGLE":  {"name": "Sheo",      "full_name": "Théo Borile",              "nationality": "FR", "age": 24, "rating": 85, "potential": 86},
        "MID":     {"name": "Serin",     "full_name": "Tolga Ölmez",              "nationality": "TR", "age": 21, "rating": 81, "potential": 92},
        "ADC":     {"name": "Ice",       "full_name": "Yoon Sang-hoon",           "nationality": "KR", "age": 22, "rating": 79, "potential": 90},
        "SUPPORT": {"name": "Stend",     "full_name": "Paul Lardin",              "nationality": "DE", "age": 23, "rating": 78, "potential": 86}
    },
    "vit": {
        "TOP":     {"name": "Naak Nako", "full_name": "Kaan Okan",               "nationality": "TR", "age": 22, "rating": 85, "potential": 90},
        "JUNGLE":  {"name": "Lyncas",    "full_name": "Linas Nauncikas",          "nationality": "LT", "age": 22, "rating": 84, "potential": 90},
        "MID":     {"name": "Humanoid",  "full_name": "Marek Brázda",             "nationality": "CZ", "age": 26, "rating": 88, "potential": 90},
        "ADC":     {"name": "Carzzy",    "full_name": "Matyáš Orság",             "nationality": "CZ", "age": 24, "rating": 85, "potential": 90},
        "SUPPORT": {"name": "Fleshy",    "full_name": "Kadir Kemiksiz",           "nationality": "TR", "age": 22, "rating": 84, "potential": 89}
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
    """
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

_swap_lock = _asyncio.Lock()


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

    async with _swap_lock:
        # Snapshot solo state
        solo_snapshot = dict(GAME_STATE)
        GAME_STATE.clear()
        GAME_STATE.update(sess.state)
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

def simulate_match_phases(team1_power: float, team2_power: float):
    """
    Granular 3-phase simulation.
    Power difference drives win probability via a logistic curve (± randomness).
    Momentum compounds across phases; late-game has comeback potential via clutch.
    """
    phases = []
    events = []

    # Convert power to a win-probability using logistic function
    def win_prob(p1, p2, noise_scale=8):
        diff = p1 - p2 + random.gauss(0, noise_scale)
        # Logistic sigmoid — steeper than pure coin flip but not deterministic
        import math
        return 1 / (1 + math.exp(-diff / 12))

    # ── EARLY GAME (0-15 min) ───────────────────────────────────────────────
    # Jungle + early skirmishes dominate
    early_p1 = team1_power * random.uniform(0.90, 1.10)
    early_p2 = team2_power * random.uniform(0.90, 1.10)
    early_win = 1 if random.random() < win_prob(early_p1, early_p2, noise_scale=12) else 2

    gold_early = abs(early_p1 - early_p2) * random.uniform(60, 130)
    first_blood_team = early_win if random.random() < 0.65 else (3 - early_win)
    first_drake_team = early_win if random.random() < 0.60 else (3 - early_win)

    phases.append({
        "name": "Early Game",
        "duration": "0-15 min",
        "advantage": early_win,
        "gold_diff": int(gold_early),
        "first_blood": first_blood_team,
        "first_drake": first_drake_team,
        "first_tower": early_win if random.random() < 0.70 else (3 - early_win),
    })

    events.append({
        "time": f"{random.randint(3, 8)}:00",
        "type": "first_blood",
        "team": first_blood_team,
        "description": f"First Blood pour l'équipe {first_blood_team}",
    })

    # ── MID GAME (15-25 min) ────────────────────────────────────────────────
    # Snowball: winner of early gets +4, loser gets -2 (but can still recover)
    # EGPM feedback (ProjektZero-inspired): gold advantage from early game
    # translates to a mid-game power modifier. +1 power per ~800 gold lead
    # (competitive earned gold rate ≈ 350-400 gold/min, so 800 gold ≈ 2 min ahead).
    egpm_mod = min(gold_early / 800.0, 5.0)  # cap at +5 to prevent runaway
    momentum = 4 if early_win == 1 else -4
    if early_win == 1:
        mid_p1 = early_p1 + momentum + egpm_mod + random.gauss(0, 3)
        mid_p2 = early_p2 - momentum - egpm_mod * 0.5 + random.gauss(0, 3)
    else:
        mid_p1 = early_p1 + momentum - egpm_mod * 0.5 + random.gauss(0, 3)
        mid_p2 = early_p2 - momentum + egpm_mod + random.gauss(0, 3)
    mid_win = 1 if random.random() < win_prob(mid_p1, mid_p2, noise_scale=9) else 2

    rift_team = mid_win if random.random() < 0.65 else (3 - mid_win)
    gold_mid = gold_early + abs(mid_p1 - mid_p2) * random.uniform(120, 220)
    drakes_1 = min(4, random.randint(1 if early_win == 1 else 0, 3))
    drakes_2 = min(4 - drakes_1, random.randint(1 if early_win == 2 else 0, 3))

    phases.append({
        "name": "Mid Game",
        "duration": "15-25 min",
        "advantage": mid_win,
        "gold_diff": int(gold_mid),
        "rift_herald": rift_team,
        "towers_destroyed": {1: random.randint(1, 4), 2: random.randint(1, 4)},
        "drakes": {1: drakes_1, 2: drakes_2},
    })

    if random.random() < 0.55:
        events.append({
            "time": f"{random.randint(18, 24)}:00",
            "type": "teamfight",
            "team": mid_win,
            "description": f"L'équipe {mid_win} remporte le teamfight au Dragon",
        })

    # ── LATE GAME (25+ min) ─────────────────────────────────────────────────
    # Momentum continues, but comeback_factor can flip the game (clutch / Baron steal)
    # EGPM carry: mid-game gold lead also propagates (diminished — teamfights reset econ)
    egpm_late_mod = min(gold_mid / 3000.0, 3.0)  # smaller than mid-game, caps at +3
    momentum_late = 3 if mid_win == 1 else -3
    if mid_win == 1:
        late_p1 = mid_p1 + momentum_late + egpm_late_mod * 0.4 + random.gauss(0, 2)
        late_p2 = mid_p2 - momentum_late - egpm_late_mod * 0.2 + random.gauss(0, 2)
    else:
        late_p1 = mid_p1 + momentum_late - egpm_late_mod * 0.2 + random.gauss(0, 2)
        late_p2 = mid_p2 - momentum_late + egpm_late_mod * 0.4 + random.gauss(0, 2)

    # Comeback mechanic: trailing team gets a slight boost (Baron fight variance)
    if mid_win == 1:
        comeback_boost = random.uniform(0, 5)  # team2 upset potential
        late_p2 += comeback_boost
    else:
        comeback_boost = random.uniform(0, 5)
        late_p1 += comeback_boost

    # Less noise late — games tend to resolve decisively
    final_win = 1 if random.random() < win_prob(late_p1, late_p2, noise_scale=6) else 2

    # Duration: short games (< 28 min) if one team dominated both early and mid;
    # long games (> 38 min) if phases split between teams.
    same_phase_winner = (early_win == mid_win)
    if same_phase_winner:
        game_duration = random.randint(24, 34)
    else:
        game_duration = random.randint(30, 44)

    baron_team = final_win if random.random() < 0.70 else (3 - final_win)
    elder_team = final_win if game_duration > 35 and random.random() < 0.65 else None
    inhib_1 = random.randint(1, 2) if final_win == 1 else random.randint(0, 1)
    inhib_2 = random.randint(1, 2) if final_win == 2 else random.randint(0, 1)

    gold_final = gold_mid + abs(late_p1 - late_p2) * random.uniform(50, 140)

    phases.append({
        "name": "Late Game",
        "duration": f"25-{game_duration} min",
        "advantage": final_win,
        "gold_diff": int(gold_final),
        "baron": baron_team,
        "elder_drake": elder_team,
        "inhibitors_destroyed": {1: inhib_1, 2: inhib_2},
    })

    events.append({
        "time": f"{game_duration}:00",
        "type": "game_end",
        "team": final_win,
        "description": f"L'équipe {final_win} détruit le Nexus!",
    })

    return {
        "winner": final_win,
        "duration": game_duration,
        "phases": phases,
        "events": events,
        "mvp_team": final_win,
        "phase_wins": {1: sum(1 for ph in phases if ph["advantage"] == 1),
                       2: sum(1 for ph in phases if ph["advantage"] == 2)},
    }

def generate_kill_totals(duration: int, team1_won: bool):
    """Return (team1_kills, team2_kills) — coherent totals matching competitive rates."""
    # Competitive: ~0.75–1.3 total kills/min across both teams
    total = max(10, int(duration * random.uniform(0.75, 1.3)))
    winner_share = random.uniform(0.55, 0.72)
    w_kills = max(4, round(total * winner_share))
    l_kills = max(2, total - w_kills)
    return (w_kills, l_kills) if team1_won else (l_kills, w_kills)


def generate_detailed_events(phases: list, team1_stats: list, team2_stats: list,
                              duration: int, winner: int, base_events: list) -> tuple[list, list]:
    """
    Build a dense, chronologically-ordered event timeline + per-minute gold snapshots
    consistent with phases and team stats.

    Returns:
        (events, gold_timeline)
        events: list of dicts {time "MM:SS", type, team, description, [killer, victim, ...]}
        gold_timeline: list of dicts {minute, g1, g2}
    """
    events: list[dict] = []

    # ── Kill / death budgets (by team-number and position) ──────────────────
    kills_budget = {
        1: {p["position"]: int(p.get("kills", 0)) for p in team1_stats},
        2: {p["position"]: int(p.get("kills", 0)) for p in team2_stats},
    }
    deaths_budget = {
        1: {p["position"]: int(p.get("deaths", 0)) for p in team1_stats},
        2: {p["position"]: int(p.get("deaths", 0)) for p in team2_stats},
    }
    players = {
        1: {p["position"]: p for p in team1_stats},
        2: {p["position"]: p for p in team2_stats},
    }

    def _sum_budget(budget_team: dict) -> int:
        return sum(budget_team.values())

    def pick_weighted(budget_team: dict):
        pool = [(pos, v) for pos, v in budget_team.items() if v > 0]
        if not pool:
            return None
        positions, weights = zip(*pool)
        return random.choices(positions, weights=weights)[0]

    def pinfo(team: int, pos: str) -> dict:
        return players[team].get(pos, {}) if pos else {}

    def mmss(minute_f: float) -> tuple[str, int]:
        mm = max(0, int(minute_f))
        ss = max(0, min(59, int((minute_f - mm) * 60)))
        return f"{mm}:{ss:02d}", mm * 60 + ss

    def add_kill(minute_f: float, team: int, evt_type: str = "kill"):
        """Append a kill-type event, consuming from the budgets. Returns the event or None."""
        killer_pos = pick_weighted(kills_budget[team])
        if not killer_pos:
            return None
        victim_pos = pick_weighted(deaths_budget[3 - team])
        kills_budget[team][killer_pos] -= 1
        if victim_pos:
            deaths_budget[3 - team][victim_pos] -= 1

        k = pinfo(team, killer_pos)
        v = pinfo(3 - team, victim_pos) if victim_pos else {}
        k_name = k.get("player_name") or killer_pos
        k_champ = k.get("champion") or killer_pos
        v_name = v.get("player_name") or ""
        v_champ = v.get("champion") or ""

        if evt_type == "first_blood":
            desc = (f"First Blood ! {k_name} ({k_champ}) élimine {v_name}"
                    + (f" ({v_champ})" if v_champ else "")) if v_name else f"First Blood pour {k_name} ({k_champ}) !"
        elif evt_type == "double_kill":
            desc = f"DOUBLE KILL — {k_name} ({k_champ}) !"
        elif evt_type == "triple_kill":
            desc = f"TRIPLE KILL — {k_name} ({k_champ}) !"
        elif evt_type == "quadra_kill":
            desc = f"QUADRA KILL — {k_name} ({k_champ}) !!"
        elif evt_type == "penta_kill":
            desc = f"PENTAKILL ! {k_name} ({k_champ}) !!!"
        else:
            if v_name:
                desc = f"{k_name} ({k_champ}) élimine {v_name}" + (f" ({v_champ})" if v_champ else "")
            else:
                desc = f"{k_name} ({k_champ}) signe un kill"

        time_str, sec = mmss(minute_f)
        ev = {
            "time": time_str,
            "_sec": sec,
            "type": evt_type,
            "team": team,
            "description": desc,
            "killer": k_name,
            "killer_champion": k_champ,
            "killer_position": killer_pos,
            "victim": v_name,
            "victim_champion": v_champ,
            "victim_position": victim_pos or "",
        }
        events.append(ev)
        return ev

    def add_obj(minute_f: float, team: int, evt_type: str, description: str):
        time_str, sec = mmss(minute_f)
        events.append({
            "time": time_str,
            "_sec": sec,
            "type": evt_type,
            "team": team,
            "description": description,
        })

    # ── Preserve base first_blood timing if any ─────────────────────────────
    fb_time = next((e["time"] for e in (base_events or []) if e.get("type") == "first_blood"), None)
    if fb_time and ":" in fb_time:
        try:
            mm, ss = fb_time.split(":")
            fb_min_f = int(mm) + int(ss) / 60.0
        except Exception:
            fb_min_f = random.uniform(3, 8)
    else:
        fb_min_f = random.uniform(3, 8)

    fb_team = phases[0].get("first_blood") if phases else random.choice([1, 2])
    if fb_team not in (1, 2):
        fb_team = random.choice([1, 2])

    end_time = next((e["time"] for e in (base_events or []) if e.get("type") == "game_end"), None)
    if end_time and ":" in end_time:
        try:
            mm, ss = end_time.split(":")
            end_sec = int(mm) * 60 + int(ss)
        except Exception:
            end_sec = duration * 60
    else:
        end_sec = duration * 60
    if end_sec <= 0:
        end_sec = max(duration, 20) * 60

    # Cap all events a bit before nexus
    latest_allowed = max(60, end_sec - 20)
    latest_min = latest_allowed / 60.0

    total_kills_game = sum(_sum_budget(kills_budget[t]) for t in (1, 2))

    # ── First Blood ─────────────────────────────────────────────────────────
    add_kill(fb_min_f, fb_team, "first_blood")

    # ── Early objectives ────────────────────────────────────────────────────
    # Tracker pour respecter le spawn timer des drakes (≥ 4 min d'écart)
    last_drake_min: float = 0.0

    if phases:
        ph1 = phases[0]
        if ph1.get("first_tower") in (1, 2):
            add_obj(random.uniform(8, 13.5), ph1["first_tower"], "first_tower", "Première tour détruite")
        if ph1.get("first_drake") in (1, 2):
            drake_min = random.uniform(5.0, 9.5)
            add_obj(drake_min, ph1["first_drake"], "drake", "Premier Drake sécurisé")
            last_drake_min = drake_min

    # ── Early kills (~25% of remaining) ─────────────────────────────────────
    # Aucun kill ne peut précéder le first blood
    early_kill_start = fb_min_f + 0.1
    remaining = sum(_sum_budget(kills_budget[t]) for t in (1, 2))
    early_target = max(0, int(round(total_kills_game * 0.22)) - 1)  # -1 for first_blood
    for _ in range(min(early_target, remaining)):
        t1_left = _sum_budget(kills_budget[1])
        t2_left = _sum_budget(kills_budget[2])
        if t1_left + t2_left == 0:
            break
        t = random.choices([1, 2], weights=[max(1, t1_left), max(1, t2_left)])[0]
        if _sum_budget(kills_budget[t]) == 0:
            t = 3 - t
        add_kill(random.uniform(early_kill_start, 13.8), t, "kill")

    # ── Mid objectives ──────────────────────────────────────────────────────
    if len(phases) >= 2:
        ph2 = phases[1]
        if ph2.get("rift_herald") in (1, 2):
            add_obj(random.uniform(9, 13), ph2["rift_herald"], "herald", "Rift Herald capturé")
        towers = ph2.get("towers_destroyed") or {}
        for tn in (1, 2):
            n = towers.get(tn) or towers.get(str(tn)) or 0
            for _ in range(int(n)):
                add_obj(random.uniform(14, 24.6), tn, "tower", "Tour détruite")

        # Drakes mid-game : respecter ≥ 4 min entre chaque spawn
        DRAKE_MIN_GAP = 4.0  # minutes
        drakes = ph2.get("drakes") or {}
        # Flatten en liste ordonnée (peu importe l'équipe) pour assigner les timestamps
        drake_entries: list[tuple[int, int]] = []  # (team_num, drake_index)
        for tn in (1, 2):
            n = drakes.get(tn) or drakes.get(str(tn)) or 0
            for i in range(int(n)):
                drake_entries.append((tn, i))
        # Trier aléatoirement pour mélanger les équipes
        random.shuffle(drake_entries)
        for tn_d, _ in drake_entries:
            earliest = max(last_drake_min + DRAKE_MIN_GAP, 12.0)
            latest   = 24.5
            if earliest >= latest:
                earliest = latest - 0.5
            drake_min = random.uniform(earliest, latest)
            add_obj(drake_min, tn_d, "drake", "Drake sécurisé")
            last_drake_min = drake_min

    # ── Mid kills (~45%) ────────────────────────────────────────────────────
    mid_target = int(round(total_kills_game * 0.45))
    for _ in range(mid_target):
        t1_left = _sum_budget(kills_budget[1])
        t2_left = _sum_budget(kills_budget[2])
        if t1_left + t2_left == 0:
            break
        t = random.choices([1, 2], weights=[max(1, t1_left), max(1, t2_left)])[0]
        if _sum_budget(kills_budget[t]) == 0:
            t = 3 - t
        if _sum_budget(kills_budget[t]) == 0:
            break
        add_kill(random.uniform(14, 24.8), t, "kill")

    # ── Late objectives ─────────────────────────────────────────────────────
    if len(phases) >= 3:
        ph3 = phases[2]
        if ph3.get("baron") in (1, 2):
            add_obj(random.uniform(25, max(26, min(duration - 2, 38))), ph3["baron"], "baron", "Baron Nashor !")
        if ph3.get("elder_drake") in (1, 2):
            add_obj(random.uniform(max(32, duration - 8), max(32, duration - 2)),
                    ph3["elder_drake"], "elder", "Elder Dragon !")
        inhibs = ph3.get("inhibitors_destroyed") or {}
        for tn in (1, 2):
            n = inhibs.get(tn) or inhibs.get(str(tn)) or 0
            for _ in range(int(n)):
                add_obj(random.uniform(28, max(29, duration - 1)), tn, "inhibitor", "Inhibiteur détruit")

    # ── Late kills (whatever is left) ───────────────────────────────────────
    safety = 400
    while safety > 0 and sum(_sum_budget(kills_budget[t]) for t in (1, 2)) > 0:
        safety -= 1
        t1_left = _sum_budget(kills_budget[1])
        t2_left = _sum_budget(kills_budget[2])
        t = random.choices([1, 2], weights=[max(1, t1_left), max(1, t2_left)])[0]
        if _sum_budget(kills_budget[t]) == 0:
            t = 3 - t
            if _sum_budget(kills_budget[t]) == 0:
                break
        late_start = 25.0
        late_end = max(26.0, min(latest_min, float(duration) - 0.5))
        if late_end <= late_start:
            late_end = late_start + 0.5
        add_kill(random.uniform(late_start, late_end), t, "kill")

    # ── Sort chronologically ────────────────────────────────────────────────
    events.sort(key=lambda e: e["_sec"])

    # Clamp any stray event above latest_allowed
    for e in events:
        if e["_sec"] > latest_allowed:
            e["_sec"] = latest_allowed
            e["time"] = f"{latest_allowed // 60}:{latest_allowed % 60:02d}"

    # ── Multi-kill promotion: same killer within 12s window ────────────────
    i = 0
    while i < len(events):
        e = events[i]
        if e.get("type") in ("kill", "first_blood") and e.get("killer"):
            streak_idx = [i]
            j = i + 1
            while j < len(events) and (events[j]["_sec"] - events[streak_idx[-1]]["_sec"]) <= 12:
                if events[j].get("type") == "kill" and events[j].get("killer") == e["killer"]:
                    streak_idx.append(j)
                    j += 1
                else:
                    j += 1
            if len(streak_idx) >= 2:
                n = min(len(streak_idx), 5)
                label = {2: "double_kill", 3: "triple_kill", 4: "quadra_kill", 5: "penta_kill"}[n]
                last_ev = events[streak_idx[-1]]
                last_ev["type"] = label
                k_name = last_ev.get("killer") or ""
                k_champ = last_ev.get("killer_champion") or ""
                # Collecter les victimes de tous les kills du streak
                victims_parts = []
                for idx in streak_idx:
                    v = events[idx].get("victim") or ""
                    vc = events[idx].get("victim_champion") or ""
                    if v:
                        victims_parts.append(f"{v} ({vc})" if vc else v)
                victims_str = ", ".join(victims_parts)
                killed_suffix = f" — tue {victims_str}" if victims_str else ""
                prefix = {
                    "double_kill": "DOUBLE KILL",
                    "triple_kill": "TRIPLE KILL",
                    "quadra_kill": "QUADRA KILL",
                    "penta_kill":  "PENTAKILL",
                }[label]
                bang = "!!!" if label == "penta_kill" else ("!!" if label == "quadra_kill" else "!")
                last_ev["description"] = f"{prefix} — {k_name} ({k_champ}){killed_suffix}{bang}"
            i = (streak_idx[-1] if streak_idx else i) + 1
        else:
            i += 1

    # ── Final Nexus event ───────────────────────────────────────────────────
    events.append({
        "time": f"{end_sec // 60}:{end_sec % 60:02d}",
        "_sec": end_sec,
        "type": "game_end",
        "team": winner,
        "description": "Nexus détruit — fin de la partie !",
    })
    events.sort(key=lambda e: e["_sec"])

    # Drop internal _sec before returning
    for e in events:
        e.pop("_sec", None)

    # ── Gold timeline (per minute) ──────────────────────────────────────────
    # Keyframes from phases. Base income per team ≈ 1700 gold/min.
    START_G = 2500
    kf: list[tuple[int, int, int]] = [(0, START_G, START_G)]

    def _kf_at(minute: int, gold_diff: int, adv: int):
        base = START_G + int(minute * 1700)
        if adv == 1:
            return (minute, base + gold_diff // 2, base - gold_diff // 2)
        if adv == 2:
            return (minute, base - gold_diff // 2, base + gold_diff // 2)
        return (minute, base, base)

    if phases:
        ph1 = phases[0]
        kf.append(_kf_at(15, int(ph1.get("gold_diff") or 0), ph1.get("advantage") or 0))
    if len(phases) >= 2:
        ph2 = phases[1]
        kf.append(_kf_at(25, int(ph2.get("gold_diff") or 0), ph2.get("advantage") or 0))
    if len(phases) >= 3:
        ph3 = phases[2]
        kf.append(_kf_at(max(26, duration), int(ph3.get("gold_diff") or 0), ph3.get("advantage") or 0))
    else:
        kf.append(_kf_at(max(duration, 26), 0, 0))

    # De-duplicate keyframe minutes (keep last)
    kf_by_min: dict[int, tuple[int, int, int]] = {}
    for k in kf:
        kf_by_min[k[0]] = k
    kf_sorted = sorted(kf_by_min.values(), key=lambda x: x[0])

    def interp(m: int) -> tuple[int, int]:
        prev = kf_sorted[0]
        nxt = kf_sorted[-1]
        for idx in range(len(kf_sorted) - 1):
            if kf_sorted[idx][0] <= m <= kf_sorted[idx + 1][0]:
                prev = kf_sorted[idx]
                nxt = kf_sorted[idx + 1]
                break
        if nxt[0] == prev[0]:
            return prev[1], prev[2]
        t = (m - prev[0]) / float(nxt[0] - prev[0])
        g1 = int(prev[1] + (nxt[1] - prev[1]) * t)
        g2 = int(prev[2] + (nxt[2] - prev[2]) * t)
        return g1, g2

    gold_timeline: list[dict] = []
    for m in range(int(duration) + 1):
        g1, g2 = interp(m)
        # Light per-minute noise so the bar breathes
        g1 += random.randint(-250, 250)
        g2 += random.randint(-250, 250)
        gold_timeline.append({"minute": m, "g1": max(0, g1), "g2": max(0, g2)})

    return events, gold_timeline


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


def _player_performance_score(player_stats: dict, won: bool, game_duration: float) -> float:
    """
    Compute a 0–10 performance score for one player from a single game.

    Inputs come from the stat dict returned by generate_player_stats().
    Formula:
      - KDA component (0–5): (K + A×0.5) / max(D, 1), normalised to max 5
      - CS component  (0–3): cs/min vs role expectation, normalised to max 3
      - Win  bonus    (0–2): +2 for a win, 0 for a loss
    """
    pos = player_stats.get("position", "MID")
    k   = player_stats.get("kills",   0)
    d   = player_stats.get("deaths",  1)
    a   = player_stats.get("assists", 0)
    cs  = player_stats.get("cs",      0)
    dur = max(game_duration, 1)

    kda_raw = (k + a * 0.5) / max(d, 1)
    kda_score = min(5.0, kda_raw * 1.2)   # KDA 4+ → max component

    # Role CS expectations (cs/min)
    cs_expect = {"TOP": 9.0, "JUNGLE": 7.5, "MID": 9.0, "ADC": 9.5, "SUPPORT": 0.8}
    cs_per_min = cs / dur
    cs_ratio   = cs_per_min / max(cs_expect.get(pos, 8.0), 0.1)
    cs_score   = min(3.0, cs_ratio * 3.0)

    win_bonus = 2.0 if won else 0.0
    return round(kda_score + cs_score + win_bonus, 2)


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


# ── Inbox helpers ─────────────────────────────────────────────────────────────

def _add_inbox_message(msg_type: str, sender: str, subject: str, body: str, week: int = None) -> dict:
    msg = {
        "id": str(uuid.uuid4()),
        "type": msg_type,
        "sender": sender,
        "subject": subject,
        "body": body,
        "week": week or GAME_STATE.get("current_week", 0),
        "read": False,
    }
    inbox = GAME_STATE.setdefault("inbox", [])
    inbox.append(msg)
    if len(inbox) > 60:
        GAME_STATE["inbox"] = inbox[-60:]
    return msg


def _get_user_streak() -> tuple[str, int]:
    """Return ('win'|'loss'|None, count) for the user's current streak from the schedule."""
    user_id = GAME_STATE.get("user_team")
    played = sorted(
        [m for m in GAME_STATE.get("schedule", []) if m.get("played") and
         (m["team1"] == user_id or m["team2"] == user_id)],
        key=lambda m: m.get("week", 0)
    )
    if not played:
        return None, 0
    streak_type = "win" if played[-1].get("winner") == user_id else "loss"
    count = 0
    for m in reversed(played):
        result = "win" if m.get("winner") == user_id else "loss"
        if result == streak_type:
            count += 1
        else:
            break
    return streak_type, count


def _get_mvp_name(stats: list) -> str | None:
    """Return the name of the player with the best KDA from a stats list."""
    if not stats:
        return None
    best = max(
        stats,
        key=lambda p: (p.get("kills", 0) + p.get("assists", 0)) / max(p.get("deaths", 1), 1),
    )
    return best.get("name") or best.get("player")


def _generate_match_inbox_messages(
    winner_id: str, loser_id: str, match_result: dict,
    w_stats: list = None, l_stats: list = None, week: int = None
):
    """Generate board + soloq inbox messages after the user plays a match."""
    user_id = GAME_STATE.get("user_team")
    if not user_id:
        return
    user_won = winner_id == user_id
    opp_id   = loser_id if user_won else winner_id
    opp_team = GAME_STATE["teams"].get(opp_id, {})
    opp_name = opp_team.get("name", "l'adversaire")
    opp_abbr = opp_team.get("abbr", opp_name[:3].upper())
    user_team_obj = GAME_STATE["teams"].get(user_id, {})
    wins     = user_team_obj.get("wins", 0)
    losses   = user_team_obj.get("losses", 0)
    week_num = week or GAME_STATE.get("current_week", 0)
    duration = match_result.get("duration", 30)
    phases   = match_result.get("phases", [])
    gold_diff = abs(phases[-1].get("gold_diff", 0)) if phases else 0

    streak_type, streak_count = _get_user_streak()
    user_mvp  = _get_mvp_name(w_stats if user_won else l_stats)
    mvp_mention = f" {user_mvp} a été exceptionnel." if user_mvp else ""

    # Streak flavour snippets
    if user_won and streak_count >= 3:
        streak_note = f" {streak_count} victoires consécutives — l'élan est indéniable."
    elif not user_won and streak_count >= 3:
        streak_note = f" {streak_count} défaites de suite — la situation est préoccupante."
    else:
        streak_note = ""

    total = wins + losses
    wr = round(wins / total * 100) if total else 0
    # Current position in standings
    league_ids = [t["id"] for t in sorted(
        GAME_STATE["teams"].values(),
        key=lambda t: (-t.get("wins", 0), t.get("losses", 0))
    )]
    rank = (league_ids.index(user_id) + 1) if user_id in league_ids else "?"

    if user_won:
        if gold_diff > 10000:
            board_pool = [
                ("Direction Sportive", f"Victoire écrasante contre {opp_name}",
                 f"Performance de grande classe ce soir contre {opp_abbr} en {duration}min (différence d'or : {gold_diff:,}).{mvp_mention} L'équipe est 1ère au classement si elle continue ainsi. Bilan : {wins}V-{losses}D."),
                ("Président", f"Domination totale — Semaine {week_num}",
                 f"Je n'ai pas grand-chose à dire, laissez le jeu parler de lui-même. {opp_abbr} n'a jamais eu le match en main.{mvp_mention} Bilan {wins}V-{losses}D — nous sommes #{rank}."),
                ("Sponsor Principal", f"Nos partenaires sont conquis 🏆",
                 f"La domination contre {opp_abbr} en {duration}min a généré un pic d'engagement record sur nos réseaux.{mvp_mention} Sponsors ravis. Bilan {wins}V-{losses}D."),
            ]
        elif streak_count >= 3 and streak_type == "win":
            board_pool = [
                ("Manager Général", f"Série de {streak_count} — Semaine {week_num}",
                 f"Encore une victoire contre {opp_abbr} !{mvp_mention}{streak_note} Le groupe est en feu, continuons à capitaliser. #{rank} au classement, {wins}V-{losses}D."),
                ("Direction Sportive", f"Série en cours — {streak_count} victoires consécutives",
                 f"L'équipe confirme sa régularité.{mvp_mention} Victoire contre {opp_abbr} en {duration}min.{streak_note} #{rank} au classement avec {wins}V-{losses}D."),
            ]
        else:
            board_pool = [
                ("Direction Sportive", f"Victoire acquise contre {opp_name}",
                 f"Bonne victoire contre {opp_abbr} en {duration}min.{mvp_mention} L'essentiel est là. #{rank} au classement — bilan {wins}V-{losses}D."),
                ("Manager Général", f"Résultat positif — Semaine {week_num}",
                 f"Victoire contre {opp_name} confirmée. Match équilibré mais bien géré.{mvp_mention} On reste sur la bonne trajectoire : {wins}V-{losses}D (#{rank})."),
                ("Analyste Tactique", f"Post-match vs {opp_abbr} ✅",
                 f"La lecture mid-game a fait la différence contre {opp_abbr}.{mvp_mention} {duration}min, match maîtrisé. Bilan {wins}V-{losses}D."),
            ]
        soloq_pool = [
            ("@LoLAnalyst_EU", f"Thread : {opp_abbr} battu ✅",
             f"Performance solide ce soir. Vision control et pacing mid-game au top. La victoire en {duration}min montre une bonne lecture du jeu.{(' ' + user_mvp + ' MVP incontesté.') if user_mvp else ''} #LoLEsports"),
            ("LeagueFanatic42", f"Quelle victoire contre {opp_abbr} !",
             f"J'étais devant ma TV ce soir, c'était vraiment beau. Victoire en {duration}min{(' — ' + user_mvp + ' dominant') if user_mvp else ''} — let's go ! 🔥 {wins}V-{losses}D"),
            ("EsportsInsider", f"Analyse post-match vs {opp_abbr}",
             f"Cohérence tactique notable ce soir. La victoire contre {opp_abbr} renforce la position au classement (#{rank}).{(' ' + user_mvp + ' en grande forme.') if user_mvp else ''} {wins}V-{losses}D"),
            ("@ProScoutWatch", f"{opp_abbr} neutralisé — les chiffres",
             f"Victoire en {duration}min contre {opp_abbr}.{(' ' + user_mvp + ' : KDA hors normes ce soir.') if user_mvp else ''} Le bilan {wins}V-{losses}D est solide. #Analytics"),
        ]
    else:
        if streak_count >= 3 and streak_type == "loss":
            board_pool = [
                ("Président", f"URGENT — Série noire : {streak_count} défaites",
                 f"Je ne peux plus rester silencieux. {streak_count} défaites consécutives dont ce soir contre {opp_abbr}. Bilan {wins}V-{losses}D (#{rank}). Une réunion de crise est convoquée."),
                ("Manager Général", f"Crise de résultats — Action immédiate requise",
                 f"La série de {streak_count} défaites (dernière contre {opp_abbr} en {duration}min) exige une réponse concrète. {wins}V-{losses}D. #{rank} au classement — les playoffs s'éloignent."),
            ]
        elif losses > wins:
            board_pool = [
                ("Manager Général", f"Défaite préoccupante — URGENT",
                 f"Cette défaite contre {opp_abbr} est difficile à accepter. Avec {wins}V-{losses}D (#{rank}), notre position devient critique. Réunion tactique avant le prochain match."),
                ("Président", f"Réunion de situation demandée",
                 f"Suite à la défaite contre {opp_name} — bilan {wins}V-{losses}D, #{rank}. Les investisseurs s'interrogent. J'attends un retour d'analyse sous 48h."),
            ]
        else:
            board_pool = [
                ("Direction Sportive", f"Défaite contre {opp_name} — Analyse requise",
                 f"Défaite ce soir contre {opp_abbr} en {duration}min. Bilan toujours positif : {wins}V-{losses}D (#{rank}). Identifiez les erreurs et revenez plus forts."),
                ("Manager Général", f"Retour sur la défaite — S{week_num}",
                 f"Résultat décevant contre {opp_name} en {duration}min. Des lacunes en mid-game. Bilan : {wins}V-{losses}D (#{rank}) — les points se rattrapent encore."),
                ("Analyste Tactique", f"Points à corriger vs {opp_abbr}",
                 f"Défaite en {duration}min contre {opp_abbr}. La gestion des objectifs a posé problème. À travailler avant le prochain match. Bilan : {wins}V-{losses}D."),
            ]
        soloq_pool = [
            ("@CriticalCoach", f"Analyse défaite vs {opp_abbr} 🔴",
             f"Difficile à regarder ce soir. La défaite en {duration}min est symptomatique de problèmes récurrents. Vision control en mid-game à retravailler.{streak_note} #LoLEsports"),
            ("LoLFan_Frustrated", f"Qu'est-ce qui se passe ???",
             f"Comment on perd contre {opp_abbr} comme ça en {duration}min... L'équipe doit se ressaisir.{streak_note} {wins}V-{losses}D c'est pas acceptable à ce niveau."),
            ("EsportsBetting", f"Post-match {opp_abbr} — Côtes révisées",
             f"La défaite contre {opp_abbr} en {duration}min impacte les prévisions playoff. Le bilan {wins}V-{losses}D (#{rank}) place l'équipe dans une position délicate."),
            ("@ProScoutWatch", f"Analyse froide : {opp_abbr} a dominé",
             f"Pas grand-chose à sauver ce soir. {opp_abbr} a contrôlé le tempo en {duration}min.{streak_note} #{rank} au classement, {wins}V-{losses}D. #Analytics"),
        ]

    b = random.choice(board_pool)
    s = random.choice(soloq_pool)
    _add_inbox_message("board", b[0], b[1], b[2], week_num)
    _add_inbox_message("soloq", s[0], s[1], s[2], week_num)


def _generate_weekly_board_message(week: int):
    """Board message at the start of each new week with standings context."""
    user_id = GAME_STATE.get("user_team")
    if not user_id:
        return
    user_team_obj = GAME_STATE["teams"].get(user_id, {})
    wins   = user_team_obj.get("wins", 0)
    losses = user_team_obj.get("losses", 0)
    total  = wins + losses
    if total == 0:
        return

    wr = round(wins / total * 100)
    league_sorted = sorted(
        GAME_STATE["teams"].values(),
        key=lambda t: (-t.get("wins", 0), t.get("losses", 0))
    )
    rank = next((i + 1 for i, t in enumerate(league_sorted) if t["id"] == user_id), "?")
    n_teams = len(league_sorted)
    playoff_spots = 6  # standard playoff qualification
    remaining = max(0, 9 - total)  # 9 regular season weeks

    # Phase context
    if week <= 3:
        phase_ctx = "début de split"
    elif week <= 6:
        phase_ctx = "mi-saison"
    else:
        phase_ctx = "sprint final"

    if wr >= 70:
        pool = [
            (f"Semaine {week} — Objectifs dépassés ✅",
             f"Bilan {wins}V-{losses}D ({wr}%) en {phase_ctx}. #{rank}/{n_teams} au classement. "
             f"L'équipe est en avance sur les objectifs fixés — les playoffs semblent assurés si l'élan se maintient."),
            (f"Point hebdomadaire — Semaine {week}",
             f"#{rank} au classement avec {wins}V-{losses}D ({wr}%). Excellente régularité en {phase_ctx}. "
             f"{remaining} match(s) restant(s) — continuez à capitaliser sur cette dynamique."),
        ]
        sender = "Direction Sportive"
    elif wr >= 50:
        pool = [
            (f"Bilan semaine {week} — En bonne voie",
             f"#{rank}/{n_teams} avec {wins}V-{losses}D ({wr}%) — bilan satisfaisant en {phase_ctx}. "
             f"Les prochains matchs seront décisifs pour la qualification aux playoffs ({playoff_spots} places disponibles)."),
            (f"Point hebdomadaire — Semaine {week}",
             f"Bilan {wins}V-{losses}D, #{rank} au classement. {remaining} match(s) restant(s) en {phase_ctx}. "
             f"La qualification reste à portée — pas de relâchement."),
        ]
        sender = "Manager Général"
    elif rank <= playoff_spots:
        pool = [
            (f"Semaine {week} — Position précaire",
             f"#{rank}/{n_teams} avec {wins}V-{losses}D ({wr}%). Encore dans les playoffs pour l'instant, "
             f"mais la marge est mince. {remaining} match(s) pour consolider — chaque point compte."),
            (f"Point hebdomadaire — Semaine {week}",
             f"Bilan {wins}V-{losses}D. #{rank} au classement — dans la zone playoffs mais sous pression. "
             f"Des adversaires directs se rapprochent. Il faut une réaction en {phase_ctx}."),
        ]
        sender = "Manager Général"
    else:
        pool = [
            (f"ALERTE — Semaine {week} : playoffs compromis",
             f"#{rank}/{n_teams} avec {wins}V-{losses}D ({wr}%) — hors des {playoff_spots} premières places. "
             f"{remaining} match(s) restant(s). Des victoires consécutives sont indispensables pour remonter."),
            (f"Point de crise — Semaine {week}",
             f"Bilan {wins}V-{losses}D, #{rank}/{n_teams}. En {phase_ctx}, la qualification devient critique. "
             f"Chaque défaite supplémentaire réduit nos chances. J'attends une réponse collective."),
        ]
        sender = "Président"

    subject, body = random.choice(pool)
    _add_inbox_message("board", sender, subject, body, week)


def generate_player_stats(team_id: str, won: bool, game_duration: int,
                           team_kills: int, opp_kills: int,
                           draft_picks: list = None, excluded: set = None):
    """Generate realistic post-game stats for a team with role-coherent kill/death distribution."""
    positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
    stats = []

    team = GAME_STATE["teams"].get(team_id, {})
    roster = team.get("roster", [])

    # Build position → (player_name, champion_pool) mapping
    player_by_position: dict[str, dict] = {}
    for player_id in roster:
        player = GAME_STATE["players"].get(player_id, {})
        if player:
            pos = player.get("position", "")
            player_by_position[pos] = {
                "name": player.get("name", f"Player ({pos})"),
                "pool": player.get("champion_pool", []),
            }

    # draft_picks: [{"champion": "Azir", "position": "MID"}, ...]
    picks_by_position: dict[str, str] = {}
    if draft_picks:
        for pick in draft_picks:
            champ = pick.get("champion") if isinstance(pick, dict) else None
            pos = pick.get("position") if isinstance(pick, dict) else None
            if champ and pos:
                picks_by_position[pos] = champ

    used_champs: set[str] = set(picks_by_position.values()) | (excluded or set())

    # Role-weighted distribution helpers
    kill_w  = {"TOP": 0.18, "JUNGLE": 0.18, "MID": 0.24, "ADC": 0.28, "SUPPORT": 0.12}
    death_w = {"TOP": 0.22, "JUNGLE": 0.20, "MID": 0.15, "ADC": 0.15, "SUPPORT": 0.28}
    assist_w = {"TOP": 0.16, "JUNGLE": 0.22, "MID": 0.18, "ADC": 0.12, "SUPPORT": 0.32}

    def distribute(total, weights):
        result = {p: 0 for p in positions}
        for _ in range(max(0, total)):
            chosen = random.choices(positions, weights=[weights[p] for p in positions])[0]
            result[chosen] += 1
        return result

    total_assists = int(team_kills * random.uniform(2.0, 2.8))
    kills_by_pos   = distribute(team_kills, kill_w)
    deaths_by_pos  = distribute(opp_kills, death_w)
    assists_by_pos = distribute(total_assists, assist_w)

    for pos in positions:
        kills   = kills_by_pos[pos]
        deaths  = deaths_by_pos[pos]
        assists = assists_by_pos[pos]

        if pos == "SUPPORT":
            cs = int(game_duration * random.uniform(0, 1.5))
        elif pos == "JUNGLE":
            cs = int(game_duration * random.uniform(6, 9))
        else:
            cs = int(game_duration * random.uniform(7.5, 10.5))

        info = player_by_position.get(pos, {"name": f"Player ({pos})", "pool": []})
        player_name = info["name"]

        # Champion assignment: draft pick > player pool > meta pool
        champion = picks_by_position.get(pos)
        if not champion:
            pool = [c for c in info["pool"] if c not in used_champs]
            if not pool:
                meta_pool = [c["name"] for c in get_meta_champions().get(pos, [])[:10] if c["name"] not in used_champs]
                pool = meta_pool
            if pool:
                champion = random.choice(pool)
                used_champs.add(champion)

        stat = {
            "position": pos,
            "player_name": player_name,
            "champion": champion,
            "kills": kills,
            "deaths": deaths,
            "assists": assists,
            "cs": cs,
            "gold": random.randint(8000, 18000),
            "damage": random.randint(10000, 35000) if pos != "SUPPORT" else random.randint(3000, 10000),
            "vision_score": random.randint(60, 120) if pos == "SUPPORT" else random.randint(30, 60),
        }
        stat["perf_score"] = _player_performance_score(stat, won, game_duration)
        stats.append(stat)

    return stats

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

class NewGameRequest(BaseModel):
    league: str = "LEC"

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

class SignERLPlayerRequest(BaseModel):
    player_id: str = Field(min_length=1, max_length=100)
    offered_salary: int = Field(ge=0, le=50_000_000)

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

class PlayoffsGameRequest(BaseModel):
    match_id: str = Field(min_length=1, max_length=100)
    user_draft: Optional[Dict] = None

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

class SimulateMatchRequest(BaseModel):
    match_id: str = Field(min_length=1, max_length=100)
    user_draft: Optional[Dict] = None

@api_router.post("/match/simulate")
async def simulate_match(request: SimulateMatchRequest):
    """Simulate a specific match"""
    if GAME_STATE.get("phase") == "preseason":
        raise HTTPException(status_code=400, detail="Lancez la saison depuis la page Négociations avant de jouer des matchs")
    match = next((m for m in GAME_STATE["schedule"] if m["id"] == request.match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if match["played"]:
        raise HTTPException(status_code=400, detail="Match already played")
    
    # Calculate draft advantage if a draft was submitted
    user_adv = 0.0
    if request.user_draft and GAME_STATE["user_team"] in [match["team1"], match["team2"]]:
        opponent_id = match["team2"] if match["team1"] == GAME_STATE["user_team"] else match["team1"]
        user_adv = calculate_draft_advantage(request.user_draft, GAME_STATE["user_team"], opponent_id)

    user_team = GAME_STATE["user_team"]
    team1_power = calculate_team_power(match["team1"],
                                       user_adv if match["team1"] == user_team else 0,
                                       apply_tactics=match["team1"] == user_team)
    team2_power = calculate_team_power(match["team2"],
                                       user_adv if match["team2"] == user_team else 0,
                                       apply_tactics=match["team2"] == user_team)

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

    # Simulate other matches of the same week
    current_week = match["week"]
    other_results = []
    for other_match in GAME_STATE["schedule"]:
        if other_match["week"] != current_week or other_match["played"]:
            continue
        if GAME_STATE["user_team"] in [other_match["team1"], other_match["team2"]]:
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

class NegotiationOffer(BaseModel):
    player_id: str = Field(min_length=1, max_length=100)
    offered_amount: int = Field(ge=0, le=50_000_000)
    contract_years: int = Field(default=2, ge=1, le=5)
    clauses: Optional[List[str]] = []
    player_to_swap_id: Optional[str] = None  # joueur user remplacé par le nouveau
    is_counter_offer: bool = False  # si True, acceptation directe sans aléatoire

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


@api_router.post("/negotiations/offer")
async def make_offer(offer: NegotiationOffer):
    """Make a transfer offer for a player"""
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
        # Transfer the player
        old_team_id = player["team_id"]
        old_team = GAME_STATE["teams"][old_team_id]
        old_team["roster"].remove(player["id"])
        old_team["budget"] += offer.offered_amount

        player["team_id"] = GAME_STATE["user_team"]
        player["salary"] = int(offer.offered_amount * TRANSFER_SALARY_PCT)
        player["contract_years"] = offer.contract_years
        player["is_starter"] = True  # le joueur acheté devient titulaire

        user_team["roster"].append(player["id"])
        user_team["budget"] -= offer.offered_amount

        # Si un joueur existant est désigné pour céder sa place, le passer en sub
        swapped_out_name = None
        if offer.player_to_swap_id:
            swap_target = GAME_STATE["players"].get(offer.player_to_swap_id)
            if swap_target and swap_target["team_id"] == GAME_STATE["user_team"]:
                swap_target["is_starter"] = False
                swapped_out_name = swap_target.get("name")

        # Remplaçant cohérent pour l'équipe vendeuse
        replacement = _find_coherent_replacement(player, old_team_id)
        GAME_STATE["players"][replacement["id"]] = replacement
        old_team["roster"].append(replacement["id"])

        # Track transfer for recap message
        GAME_STATE.setdefault("mercato_recap", []).append({
            "player": player["name"],
            "position": player["position"],
            "rating": player["rating"],
            "amount": offer.offered_amount,
            "buyer": GAME_STATE["user_team"],
            "seller": old_team.get("abbr", old_team_id),
        })

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

# Standard LoL draft sequence — (actor, action_type)
# Phase 1 bans : 3+3 alternating, user (blue) starts
# Phase 1 picks : 1-2-2-1 (user, enemy×2, user×2, enemy)
# Phase 2 bans : 2+2 alternating, enemy (red) starts
# Phase 2 picks : enemy, user×2, enemy  (red, blue×2, red)
DRAFT_SEQUENCE = [
    ("user",  "ban"),   # 0
    ("enemy", "ban"),   # 1
    ("user",  "ban"),   # 2
    ("enemy", "ban"),   # 3
    ("user",  "ban"),   # 4
    ("enemy", "ban"),   # 5
    ("user",  "pick"),  # 6
    ("enemy", "pick"),  # 7
    ("enemy", "pick"),  # 8
    ("user",  "pick"),  # 9
    ("user",  "pick"),  # 10
    ("enemy", "pick"),  # 11
    ("enemy", "ban"),   # 12
    ("user",  "ban"),   # 13
    ("enemy", "ban"),   # 14
    ("user",  "ban"),   # 15
    ("enemy", "pick"),  # 16
    ("user",  "pick"),  # 17
    ("user",  "pick"),  # 18
    ("enemy", "pick"),  # 19
]


def _draft_phase_name(draft: dict) -> str:
    step = draft["step"]
    if step >= len(DRAFT_SEQUENCE):
        return "complete"
    actor, action_type = DRAFT_SEQUENCE[step]
    total_bans = len(draft["user_bans"]) + len(draft["enemy_bans"])
    if action_type == "ban":
        return "ban1" if total_bans < 6 else "ban2"
    else:
        return "pick1" if total_bans <= 6 else "pick2"


def _draft_apply(draft: dict, actor: str, action_type: str, champion: str, position=None):
    if action_type == "ban":
        draft["user_bans" if actor == "user" else "enemy_bans"].append(champion)
        draft["banned_champions"].append(champion)
    else:
        # Auto-assign position from meta if not provided
        if not position:
            meta = META_LOOKUP.get(champion)
            if meta:
                position = meta.get("position")
        # If still no position, assign the first unfilled position
        if not position:
            needed = _needed_positions(draft, actor)
            if needed:
                position = needed[0]
        entry = {"champion": champion, "position": position}
        draft["user_picks" if actor == "user" else "enemy_picks"].append(entry)
        draft["picked_champions"].append(champion)
        # Track per-team picks for proper availability check (avoid enemy picks)
        if actor == "user":
            draft["user_picked_champions"].append(champion)
        else:
            draft["enemy_picked_champions"].append(champion)


def _needed_positions(draft: dict, actor: str) -> list:
    picks = draft["user_picks"] if actor == "user" else draft["enemy_picks"]
    taken = {p["position"] for p in picks if p.get("position")}
    all_pos = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
    needed = [p for p in all_pos if p not in taken]
    return needed if needed else all_pos


class DraftStartRequest(BaseModel):
    match_id: Optional[str] = None   # playoff match_id to load fearless exclusions


@api_router.post("/draft/start")
async def start_draft(request: DraftStartRequest = None):
    """Initialize a new draft. Pass match_id for a playoff series to enforce fearless rule."""
    fearless: list = []
    if request and request.match_id:
        bracket = GAME_STATE.get("playoffs_bracket") or {}
        match = next((m for m in bracket.get("matches", []) if m["id"] == request.match_id), None)
        if match:
            fearless = sorted(_get_fearless_used(match))

    GAME_STATE["draft_state"] = {
        "step": 0,
        "phase": "ban1",
        "current_turn": "user",
        "user_bans": [],
        "enemy_bans": [],
        "user_picks": [],
        "enemy_picks": [],
        "banned_champions": [],
        "picked_champions": [],  # Global pick tracking (legacy)
        "user_picked_champions": [],  # Track user's own picks (avoid enemy picks)
        "enemy_picked_champions": [],  # Track enemy's picks (avoid user picks)
        "fearless_excluded": fearless,  # fearless rule: cannot be picked by either team
    }
    return GAME_STATE["draft_state"]

class DraftAction(BaseModel):
    action: str  # "ban" or "pick"
    champion: str
    position: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════
# DRAFT INTELLIGENCE SYSTEM
# Inspired by PandaSkill / sequence-aware draft simulators:
#   • Champion trait database  (damage type, CC level, archetypes)
#   • Synergy pairs            (known combo bonuses)
#   • Counter map              (what each champ counters)
#   • Compositional scorer     (damage balance + CC + synergy + meta + scaling)
#   • Delta Analyzer           (comp gain – counter exposure per candidate)
#   • Sequence-aware weights   (early = tier priority, late = counter-pick)
# ═══════════════════════════════════════════════════════════════════════════

# Trait tuple: (dmg_type, cc_level, archetypes_tuple)
#   dmg_type  : "AD" | "AP" | "Mixed"
#   cc_level  : 0 none | 1 soft | 2 hard single | 3 multi hard CC
#   archetypes: any of "eng","dis","pok","tf","sp","ass","scl","eg","uti","tank","bru"
CHAMP_TRAITS: dict = {
    # TOP
    "Rumble":       ("AP",    1, ("tf","pok","bru")),
    "K'Sante":      ("Mixed", 2, ("eng","tank","tf")),
    "Sion":         ("AD",    3, ("eng","tank","tf")),
    "Ambessa":      ("AD",    1, ("bru","ass","eg")),
    "Gnar":         ("Mixed", 2, ("pok","tf","dis")),
    "Renekton":     ("AD",    1, ("bru","eg")),
    "Poppy":        ("AD",    2, ("tank","eng","dis")),
    "Gwen":         ("AP",    0, ("bru","sp")),
    "Jax":          ("Mixed", 1, ("sp","bru","scl")),
    "Ornn":         ("Mixed", 3, ("eng","tank","tf","scl")),
    "Kennen":       ("AP",    2, ("pok","tf")),
    "Kled":         ("AD",    1, ("bru","eg","sp")),
    "Gragas":       ("AP",    2, ("eng","dis","tank")),
    "Yasuo":        ("AD",    0, ("bru","sp","scl")),
    "Shen":         ("Mixed", 2, ("tank","eng","uti")),
    "Volibear":     ("Mixed", 2, ("eng","tank","eg")),
    # JUNGLE
    "Xin Zhao":     ("AD",    1, ("bru","eng","eg")),
    "Vi":           ("AD",    2, ("eng","bru","eg")),
    "Jarvan IV":    ("AD",    2, ("eng","tf","eg")),
    "Pantheon":     ("AD",    2, ("bru","ass","eg","pok")),
    "Dr. Mundo":    ("Mixed", 0, ("tank","sp","scl")),
    "Jayce":        ("Mixed", 1, ("pok","sp","bru")),
    "Wukong":       ("AD",    1, ("bru","tf","eg")),
    "Aatrox":       ("AD",    1, ("bru","scl")),
    "Malphite":     ("AP",    3, ("eng","tank","tf")),
    "Nocturne":     ("AD",    1, ("ass","eg")),
    "Zac":          ("AP",    2, ("eng","tank","tf")),
    "Skarner":      ("Mixed", 2, ("eng","tank")),
    "Sejuani":      ("Mixed", 3, ("eng","tank","tf")),
    "Qiyana":       ("AD",    1, ("ass","eg","tf")),
    "Naafiri":      ("AD",    0, ("ass","eg")),
    "Trundle":      ("AD",    1, ("bru","tank")),
    # MID
    "Azir":         ("AP",    1, ("tf","pok","scl","dis")),
    "Orianna":      ("AP",    2, ("tf","pok","scl")),
    "Taliyah":      ("AP",    2, ("pok","tf","uti")),
    "Ryze":         ("AP",    1, ("pok","scl","tf")),
    "Akali":        ("AP",    0, ("ass","sp")),
    "Ahri":         ("AP",    1, ("ass","pok","dis")),
    "Aurora":       ("AP",    1, ("pok","tf")),
    "Anivia":       ("AP",    2, ("pok","scl","tf")),
    "Galio":        ("AP",    2, ("tank","eng","tf","uti")),
    "Yone":         ("Mixed", 1, ("bru","ass","scl")),
    "Cassiopeia":   ("AP",    1, ("pok","scl","tf")),
    "Viktor":       ("AP",    1, ("pok","tf","scl")),
    "Aurelion Sol": ("AP",    0, ("pok","scl","tf")),
    "LeBlanc":      ("AP",    1, ("ass","pok")),
    "Syndra":       ("AP",    2, ("pok","ass")),
    "Zoe":          ("AP",    2, ("pok","ass")),
    # ADC
    "Yunara":       ("AD",    0, ("scl","tf")),
    "Varus":        ("Mixed", 2, ("pok","scl","tf")),
    "Corki":        ("Mixed", 0, ("pok","eg")),
    "Ezreal":       ("Mixed", 0, ("pok","dis","scl")),
    "Aphelios":     ("AD",    0, ("scl","tf","pok")),
    "Kai'Sa":       ("Mixed", 0, ("scl","ass")),
    "Caitlyn":      ("AD",    1, ("pok","eg")),
    "Jhin":         ("AD",    1, ("pok","tf")),
    "Sivir":        ("AD",    0, ("tf","scl","uti")),
    "Ashe":         ("AD",    2, ("pok","tf","uti")),
    "Xayah":        ("AD",    1, ("dis","scl")),
    "Jinx":         ("AD",    0, ("scl","tf")),
    "Lucian":       ("AD",    0, ("eg","pok")),
    "Kalista":      ("AD",    0, ("scl","uti")),
    "Smolder":      ("AD",    0, ("scl","pok")),
    # SUPPORT
    "Alistar":      ("Mixed", 3, ("eng","tank","uti")),
    "Bard":         ("Mixed", 2, ("uti","dis","pok")),
    "Rakan":        ("AP",    2, ("eng","dis","uti")),
    "Nautilus":     ("Mixed", 3, ("eng","tank")),
    "Neeko":        ("AP",    2, ("eng","tf","pok")),
    "Nami":         ("AP",    2, ("uti","pok","scl")),
    "Lulu":         ("AP",    1, ("uti","dis","pok")),
    "Karma":        ("AP",    1, ("pok","uti","dis")),
    "Seraphine":    ("AP",    1, ("pok","tf","uti")),
    "Rell":         ("Mixed", 3, ("eng","tank","tf")),
    "Braum":        ("Mixed", 3, ("eng","tank","dis")),
    "Leona":        ("Mixed", 3, ("eng","tank")),
    "Thresh":       ("Mixed", 2, ("eng","uti","dis")),
    "Renata Glasc": ("AP",    1, ("uti","tf")),
    "Pyke":         ("AD",    1, ("ass","eng")),
    "Elise":        ("AP",    1, ("ass","eg")),
}

# Known synergy pairs: frozenset({A, B}) → bonus score (added to comp_score)
# Expanded from 22 → 80 pairs covering current pro meta combos.
# Scoring guide: 3.0 = passive interaction / unique mechanic; 2.5 = strong ult combo;
# 2.0 = reliable teamfight setup; 1.5 = situational / supportive synergy.
SYNERGY_PAIRS: list = [
    # ── Unique passive / item interactions ──────────────────────────────────
    (frozenset({"Rakan",     "Xayah"}),    3.0),  # Lover's Leap passive
    (frozenset({"Thresh",    "Kalista"}),  2.5),  # Rend + lantern ult pull
    (frozenset({"Nami",      "Kalista"}),  2.0),  # Tidecaller's proc on tether

    # ── 2-man ult combos ────────────────────────────────────────────────────
    (frozenset({"Orianna",   "Malphite"}), 2.5),  # Ball + Flash Unstoppable Force
    (frozenset({"Orianna",   "Vi"}),       2.5),  # Ball + VI Assault
    (frozenset({"Orianna",   "Zac"}),      2.0),  # Ball + Boing
    (frozenset({"Jarvan IV", "Orianna"}),  2.0),  # Cataclysm + Ball
    (frozenset({"Malphite",  "Yasuo"}),    2.5),  # Insec + Last Breath
    (frozenset({"Malphite",  "Yone"}),     2.0),  # Airborne + Fate Sealed
    (frozenset({"Sion",      "Yasuo"}),    2.0),  # Knockup chain
    (frozenset({"Jarvan IV", "Azir"}),     2.0),  # Emperor's Divide + Cataclysm
    (frozenset({"Jarvan IV", "Taliyah"}),  2.0),  # Cataclysm + Weaver's Wall
    (frozenset({"Taliyah",   "Orianna"}),  1.5),  # Weaver's Wall funnels Ball
    (frozenset({"Galio",     "Orianna"}),  2.0),  # Justice Punch into Ball
    (frozenset({"Galio",     "Azir"}),     1.5),  # Colossus engage into Emperor's

    # ── ADC + Support carry peel ─────────────────────────────────────────────
    (frozenset({"Lulu",      "Jinx"}),     2.0),  # Wild Growth to keep Jinx alive
    (frozenset({"Lulu",      "Aphelios"}), 2.0),  # Peel for positioning-dependent ADC
    (frozenset({"Lulu",      "Yunara"}),   2.0),  # Same peel pattern
    (frozenset({"Lulu",      "Kog'Maw"}),  2.5),  # Classic hypercarry duo
    (frozenset({"Lulu",      "Xayah"}),    1.5),
    (frozenset({"Nami",      "Lucian"}),   2.5),  # Surging Tides proc + Relentless Pursuit
    (frozenset({"Karma",     "Caitlyn"}),  1.5),  # Shield + poke zone
    (frozenset({"Seraphine", "Aphelios"}), 1.5),  # AoE shield with scaling ADC

    # ── Engage + follow-up ──────────────────────────────────────────────────
    (frozenset({"Varus",     "Alistar"}),  2.0),  # Chain of Corruption root into headbutt
    (frozenset({"Varus",     "Rell"}),     2.0),  # Same root + Ferromancy combo
    (frozenset({"Varus",     "Leona"}),    2.0),  # Hard CC chain into Varus ult
    (frozenset({"Ashe",      "Nautilus"}), 1.5),  # Slows into Depth Charge
    (frozenset({"Ashe",      "Jarvan IV"}),1.5),  # Arrow into Cataclysm lockdown
    (frozenset({"Alistar",   "Caitlyn"}),  1.5),  # Headbutt into Headshot trap
    (frozenset({"Alistar",   "Ezreal"}),   1.5),  # Crowd-control setup for poke
    (frozenset({"Leona",     "Ezreal"}),   1.5),  # Zone lock into Arcane Shift
    (frozenset({"Nautilus",  "Jhin"}),     2.0),  # Depth Charge + Curtain Call root
    (frozenset({"Rell",      "Jinx"}),     1.5),  # Engage peels for Jinx scaling

    # ── Speedrun / engage AoE ───────────────────────────────────────────────
    (frozenset({"Sivir",     "Orianna"}),  2.0),  # On the Hunt + Ball delivery
    (frozenset({"Sivir",     "Azir"}),     1.5),  # Movement speed lets Azir close
    (frozenset({"Sivir",     "Malphite"}), 2.0),  # Movement to close + AOE ult
    (frozenset({"Sivir",     "Galio"}),    1.5),

    # ── Global / roam synergies ──────────────────────────────────────────────
    (frozenset({"Shen",      "Jhin"}),     2.0),  # Stand United + Curtain Call
    (frozenset({"Shen",      "Darius"}),   1.5),  # Global peel for split-pusher
    (frozenset({"Galio",     "Corki"}),    1.5),  # Hero's Entrance into Package poke
    (frozenset({"Twisted Fate","Nocturne"}),2.0), # Global ults coordinate dives
    (frozenset({"Twisted Fate","Elise"}),  1.5),  # Gate + rappel ganks

    # ── Poke / siege compositions ────────────────────────────────────────────
    (frozenset({"Jayce",     "Ezreal"}),   1.5),  # Long-range siege poke
    (frozenset({"Jayce",     "Corki"}),    2.0),  # Dual AD/mixed poke range
    (frozenset({"Caitlyn",   "Zyra"}),     1.5),  # Trap + root zone control
    (frozenset({"Caitlyn",   "Lux"}),      1.5),  # Binding into Headshot
    (frozenset({"Ezreal",    "Yuumi"}),    2.0),  # Attached hypercarry poke
    (frozenset({"Karma",     "Ezreal"}),   1.5),  # Shield + poke sustain

    # ── Scaling / late-game hyper ────────────────────────────────────────────
    (frozenset({"Azir",      "Aphelios"}), 1.5),  # Emperor's Divide + Moonlight Vigil zone
    (frozenset({"Viktor",    "Sejuani"}),  1.5),  # AoE CC to let Viktor chain cast
    (frozenset({"Cassiopeia","Galio"}),    1.5),  # Petrifying Gaze + engage
    (frozenset({"Ryze",      "Neeko"}), 2.0),  # Realm Warp into 5-man Unstoppable Force

    # ── Top lane island + team follow-up ────────────────────────────────────
    (frozenset({"Aatrox",    "Orianna"}),  1.5),  # Darkin Blade chain + Ball
    (frozenset({"Gnar",      "Orianna"}),  1.5),  # GNAR! AoE knockup + Ball
    (frozenset({"Gragas",    "Yasuo"}),    2.0),  # Explosive Cask toss + Last Breath
    (frozenset({"Gragas",    "Yone"}),     1.5),

    # ── Support utilities ───────────────────────────────────────────────────
    (frozenset({"Seraphine", "Sion"}),     1.5),  # Shield/heal the frontline
    (frozenset({"Bard",      "Alistar"}),  1.5),  # Cosmic Binding into Headbutt
    (frozenset({"Renata Glasc","Jinx"}),   2.0),  # Bailout passive on scaling hyper
    (frozenset({"Renata Glasc","Aphelios"}),1.5),
    (frozenset({"Thresh",    "Xayah"}),    1.5),  # Flay feather scatter + lantern
# ── Fasting / Unique Lane archetypes ─────────────────────────────────────
    (frozenset({"Senna",     "Tahm Kench"}), 3.0),  # Fasting Senna: The classic "unbreakable" lane
    (frozenset({"Senna",     "Sion"}),       2.5),  # Fasting Senna: Infinite scaling + CC chain
    (frozenset({"Senna",     "Maokai"}),     2.5),  # Fasting Senna: Extreme zone control
    (frozenset({"Seraphine", "Senna"}),      2.0),  # Double support scaling lane

    # ── Hyper-mobility & Protection (The "Zeri" era) ─────────────────────────
    (frozenset({"Zeri",      "Yuumi"}),      2.5),  # High-speed kiting engine
    (frozenset({"Zeri",      "Lulu"}),       2.5),  # AS boost + giant growth survival
    (frozenset({"Milio",     "Kog'Maw"}),    2.5),  # Extra range + cleanse for hypercarry
    (frozenset({"Milio",     "Lucian"}),     2.0),  # Passive procs + movement speed
    (frozenset({"Nami",      "Smolder"}),    2.0),  # E-proc helps Smolder stack/slow safely

    # ── Jungle/Mid (The Pro 2v2) ─────────────────────────────────────────────
    (frozenset({"Sejuani",   "Renekton"}),   2.5),  # Instant point-and-click stun + passive stack
    (frozenset({"Sejuani",   "Yone"}),       2.0),  # Melee stacks for Sejuani E + Ult chain
    (frozenset({"Vi",        "Ahri"}),       2.5),  # Point-and-click CC + Charm follow-up
    (frozenset({"Maokai",    "Tristana"}),   2.0),  # Mid lane Tristana dive setup with Mao ult
    (frozenset({"Lee Sin",   "Leblanc"}),    2.0),  # High mobility/burst pick potential
    (frozenset({"Nocturne",  "Neeko"}),      2.5),  # Paranoia + Pop Blossom (invisible engage)

    # ── Modern Wombat Combos (AoE Devastation) ───────────────────────────────
    (frozenset({"Rumble",    "Jarvan IV"}),  2.5),  # Equalizer + Cataclysm (The "Microwave")
    (frozenset({"Rumble",    "Rell"}),       2.5),  # Magnet Storm into fire path
    (frozenset({"Amumu",     "Miss Fortune"}), 2.5), # Curse of the Sad Mummy + Bullet Time
    (frozenset({"Maokai",    "Miss Fortune"}), 2.0), # Nature's Grasp into Bullet Time
    (frozenset({"Diana",     "Yasuo"}),      2.5),  # Moonfall (multi-knockup) + Last Breath
    (frozenset({"Braum",     "Lucian"}),     2.5),  # Lightslinger procs Braum passive instantly

    # ── Kill Lanes (Snowball focus) ──────────────────────────────────────────
    (frozenset({"Draven",    "Nautilus"}),   2.5),  # Total lockdown for early Draven cash-out
    (frozenset({"Draven",    "Pyke"}),       2.0),  # Double gold execution lane
    (frozenset({"Kalista",   "Renata Glasc"}), 2.5), # Bailout on aggressive Kalista + Ult save
    (frozenset({"Samira",    "Nautilus"}),   2.5),  # Passive knock-up extension
    (frozenset({"Samira",    "Rell"}),       2.5),  # AoE CC for Samira's Inferno Trigger

    # ── Global / Semi-Global pressure ────────────────────────────────────────
    (frozenset({"Briar",     "Shen"}),       2.0),  # Shen ults Briar while she screams across map
    (frozenset({"Galio",     "Camille"}),    2.5),  # The "Golden Combo": Hextech Ultimatum + Hero's Entrance
    (frozenset({"Taliyah",   "Pantheon"}),   2.0),  # Point-and-click stun into Taliyah combo
    (frozenset({"K'Sante",   "Orianna"}),    1.5),  # All-out repositioning delivers the Ball
]

# Counter map: champ → set of champions it counters (opponent has X → I pick Y)
# Expanded from 25 → 80+ entries covering top/jng/mid/bot/sup matchups.
COUNTER_MAP: dict = {
    # ── TOP LANE ────────────────────────────────────────────────────────────
    "Malphite":     {"Yasuo", "Yone", "Corki", "Lucian", "Jinx", "Aphelios", "Kalista"},
    "Poppy":        {"Vi", "Jarvan IV", "Xin Zhao", "Nocturne", "Gragas", "Wukong", "Skarner", "Lee Sin"}, # Anti-dash queen
    "Ornn":         {"Gnar", "Kennen", "Rumble", "Renekton"},  # Out-scales bully tops
    "Renekton":     {"Sion", "Aatrox", "Gwen", "Mordekaiser"}, # Early lane domination
    "Jax":          {"Renekton", "Gwen", "Dr. Mundo", "Darius", "Camille"}, # Wins extended fights
    "Gnar":         {"Ornn", "Malphite", "Sion", "K'Sante"},   # Kite tank tops
    "Pantheon":     {"Sion", "Ornn", "Garen", "Nasus"},        # Early lane bully
    "Shen":         {"Nocturne", "Pantheon", "Tryndamere"},    # Global ult negates splits
    "Kennen":       {"Malphite", "Sion", "Ornn"},              # AoE poke vs armor stacks
    "Rumble":       {"Ornn", "Maokai", "Cho'Gath", "Garen"},   # AP poke vs HP tanks
    "Gragas":       {"Renekton", "Darius", "Aatrox"},          # Disengage + sustain
    "Kled":         {"Gnar", "Sion", "Yasuo"},                 # Aggressive dueling
    "Volibear":     {"Gnar", "Kennen", "Jax"},                 # Hard-engages pokers
    "Ambessa":      {"Gnar", "Renekton", "Aatrox", "Jax"},     # Mobile executioner
    "K'Sante":      {"Fiora", "Jax", "Gwen"},                  # Tank that can 1v1 carries
    "Darius":       {"Garen", "Nasus", "Sion", "Cho'Gath"},    # Juge, juré, bourreau des tanks
    "Fiora":        {"K'Sante", "Aatrox", "Mordekaiser", "Jax"}, # True damage scaling & Riposte
    "Camille":      {"Gnar", "Jayce", "Kennen"},               # The "long range" engage specialist
    "Mordekaiser":  {"Illaoi", "Yorick", "Malphite"},          # Death Realm cancels pets/summons
    "Olaf":         {"Morgana", "Leona", "Nautilus", "Lux"},   # Ragnarok ignores all CC chains

    # ── JUNGLE ──────────────────────────────────────────────────────────────
    "Poppy":        {"Vi", "Jarvan IV", "Xin Zhao", "Nocturne", "Wukong", "Skarner"},
    "Trundle":      {"Malphite", "Cho'Gath", "Dr. Mundo", "Sion", "Sejuani"}, # Subjugate steals stats
    "Wukong":       {"Amumu", "Sejuani", "Zac"},               # Clears fast, outduels tanks
    "Nocturne":     {"Twisted Fate", "Shen", "Pantheon", "Karthus"}, # Paranoia denies global info
    "Hecarim":      {"Nunu", "Amumu", "Lillia"},               # Speed-clears & dive
    "Vi":           {"Nidalee", "Elise", "Lee Sin", "Zeri"},   # Point-and-click R stops mobility
    "Sejuani":      {"Jarvan IV", "Vi", "Xin Zhao"},           # Tank that survives dives
    "Zac":          {"Nidalee", "Kindred", "Twitch"},          # Long-range engage vs squishies
    "Skarner":      {"Nunu", "Rammus", "Hecarim"},             # Impale stops speed-demons
    "Xin Zhao":     {"Kindred", "Nunu", "Graves"},             # Early invade god
    "Jarvan IV":    {"Lee Sin", "Nidalee", "Ezreal", "Zeri"},  # Cataclysm traps dashers
    "Graves":       {"Evelynn", "Shaco", "Rengar"},            # True Grit armor vs AD assassins
    "Lee Sin":      {"Amumu", "Rammus", "Karthus"},            # Aggressive early tempo
    "Elise":        {"Nunu", "Kindred", "Lee Sin"},            # Rappel dodge/Execute
    "Naafiri":      {"Karthus", "Fiddle", "Brand"},            # Assassin vs immobile junglers
    "Rammus":       {"Bel'Veth", "Master Yi", "Briar", "Lucian"}, # "Stop hitting yourself"
    "Kindred":      {"Zac", "Sejuani", "Vi"},                  # Scaling + R to deny execution
    "Bel'Veth":     {"Lillia", "Karthus", "Evelynn"},          # High pressure vs power farmers
    "Nidalee":      {"Graves", "Kindred"},                     # Invade and out-tempo

    # ── MID LANE ────────────────────────────────────────────────────────────
    "Galio":        {"Akali", "Ahri", "LeBlanc", "Syndra", "Zoe", "Qiyana", "Naafiri", "Talon"},
    "Ahri":         {"Akali", "Naafiri", "LeBlanc", "Qiyana"}, # Charm + mobility outplay
    "Viktor":       {"Azir", "Orianna", "Corki", "Hwei"},      # Push + poke king
    "Qiyana":       {"Azir", "Orianna", "Corki", "Taliyah"},   # Assassinates poke mages
    "Zed":          {"Syndra", "Orianna", "LeBlanc"},          # Classic shadow outplay
    "LeBlanc":      {"Syndra", "Viktor", "Orianna", "Hwei"},   # Burst before waveclear
    "Syndra":       {"Cassiopeia", "Ryze", "Azir"},            # Scatter the Weak outranges
    "Orianna":      {"Akali", "LeBlanc", "Yone"},              # Safe scaling + utility
    "Azir":         {"LeBlanc", "Talon", "Fizz", "Sylas"},     # Shurima Shuffle + Soldier zone
    "Taliyah":      {"Azir", "Orianna", "LeBlanc"},            # Terrain control + roaming
    "Cassiopeia":   {"Yasuo", "Yone", "Irelia", "Lee Sin"},    # Miasma = Anti-dash zone
    "Twisted Fate": {"Ryze", "Orianna", "Akali"},              # Global gold card pressure
    "Corki":        {"Azir", "Taliyah", "Hwei"},               # Package burst vs immobile
    "Aurora":       {"Syndra", "Zoe", "Viktor"},               # Hops over key skillshots
    "Zoe":          {"Ryze", "Orianna", "Azir"},               # Long-range pick potential
    "Anivia":       {"Corki", "Azir", "Yone"},                 # Wall traps immobile targets
    "Malzahar":     {"Yasuo", "Irelia", "LeBlanc", "Akali"},   # Point-and-click suppression
    "Lissandra":    {"LeBlanc", "Zed", "Akali", "Ahri"},       # Anti-assassin lockdown
    "Kassadin":     {"Syndra", "Viktor", "LeBlanc", "Ahri"},   # Magic shield + scaling
    "Sylas":        {"Malphite", "Alistar", "Ornn", "Ashe"},   # "I'll take that ult, thanks"

    # ── BOT LANE (ADC) ──────────────────────────────────────────────────────
    "Sivir":        {"Zac", "Alistar", "Nautilus", "Malphite", "Leona", "Blitzcrank"},
    "Ezreal":       {"Draven", "Samira", "Nautilus"},          # Arcane Shift away from all-in
    "Xayah":        {"Alistar", "Nautilus", "Rell", "Leona", "Jarvan IV"}, # Feather safety
    "Caitlyn":      {"Alistar", "Thresh", "Vayne", "Short-range ADCs"}, # Lane bully range
    "Aphelios":     {"Sivir", "Morgana", "Nami"},              # Massive DPS vs sustain lanes
    "Ashe":         {"Nocturne", "Naafiri", "Talon", "Briar"}, # Hawkshot reveals + Permaslow
    "Jhin":         {"Alistar", "Blitzcrank", "Brand"},        # Long-range follow-up
    "Jinx":         {"Alistar", "Nami", "Sona"},               # Hyper-scaling resets
    "Kalista":      {"Zac", "Jarvan IV", "Amumu", "Skillshot-reliant"}, # Hop, hop, hop
    "Varus":        {"Alistar", "Leona", "Nautilus", "Maokai"}, # Blight pop vs tanks
    "Lucian":       {"Kalista", "Jinx", "Ezreal"},             # High burst early
    "Draven":       {"Jinx", "Aphelios", "Xayah", "Kai'Sa"},   # Dominance via raw damage
    "Smolder":      {"Caitlyn", "Jhin", "Senna"},              # Infinite scaling sustain
    "Kai'Sa":       {"Ezreal", "Miss Fortune", "Zeri"},        # Assassination potential
    "Samira":       {"Ashe", "Miss Fortune", "Caitlyn", "Jinx"}, # Blade Whirl blocks ults
    "Nilah":        {"Lucian", "Draven", "Yasuo"},             # Melee ADC anti-AA shield

    # ── SUPPORT ──────────────────────────────────────────────────────────────
    "Lulu":         {"Nocturne", "Malphite", "Zac", "Vi", "Jarvan IV", "Katarina"},
    "Braum":        {"Ezreal", "Aphelios", "Kalista", "Caitlyn", "Ashe", "Ornn"}, # Unbreakable wall
    "Alistar":      {"Caitlyn", "Jinx", "Aphelios", "Leona"},  # Disengages the engage
    "Thresh":       {"Jinx", "Caitlyn", "Aphelios", "LeBlanc"}, # Lantern = The ultimate "Nope"
    "Morgana":      {"Blitzcrank", "Nautilus", "Thresh", "Leona", "Rell"}, # Black Shield king
    "Nautilus":     {"Tristana", "Lucian", "Zeri", "Ezreal"},  # Hook + Point-and-click R
    "Leona":        {"Tristana", "Jinx", "Soraka", "Sona"},    # Raw all-in pressure
    "Rell":         {"Ezreal", "Corki", "Xayah", "Seraphine"}, # Shield break + AoE CC
    "Nami":         {"Alistar", "Leona", "Draven"},            # Sustain + Bubble counter-engage
    "Seraphine":    {"Zac", "Vi", "Sion"},                     # Scaling AoE CC
    "Renata Glasc": {"Jinx", "Twitch", "Master Yi", "Draven"}, # Berserk makes carries kill themselves
    "Karma":        {"Blitzcrank", "Thresh", "Poke lanes"},    # Mantra shield speed/sustain
    "Pyke":         {"Thresh", "Nautilus", "Soraka", "Sona"},  # Roaming executioner
    "Bard":         {"Jarvan IV", "Skarner", "Zac"},           # Tempered Fate stasis
    "Blitzcrank":   {"Lulu", "Nami", "Sona", "Soraka"},        # Hook the squishy enchanter
    "Milio":        {"Leona", "Nautilus", "Rell", "Varus"},    # Cleanse ultimate for the team
    "Zyra":         {"Rell", "Leona", "Alistar"},              # Plant zone vs melee engage
    "Senna":        {"Tahm Kench", "Sion", "Braum"},           # Scaling with heavy frontlines
    "Maokai":       {"Pyke", "Thresh", "Blitzcrank"},          # Saplings check bushes safely
}


def _get_team_champ_pool(team_id: str) -> set:
    """Return the set of all champions in a team's rosters."""
    if not team_id:
        return set()
    team = GAME_STATE["teams"].get(team_id, {})
    pool: set = set()
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        pool.update(p.get("champion_pool", []))
    return pool


def _get_team_champ_pool_by_pos(team_id: str) -> dict:
    """Return {position: set_of_champions} for each player on the team."""
    if not team_id:
        return {}
    team = GAME_STATE["teams"].get(team_id, {})
    by_pos: dict = {}
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        pos = p.get("position", "")
        if pos:
            by_pos.setdefault(pos, set()).update(p.get("champion_pool", []))
    return by_pos


def _get_current_opponent_id() -> Optional[str]:
    """Infer the current opponent from the schedule (current week, first unplayed match)."""
    user_id = GAME_STATE.get("user_team")
    week = GAME_STATE.get("current_week", 1)
    for m in GAME_STATE.get("schedule", []):
        if m.get("week") == week and not m.get("played"):
            if m["team1"] == user_id:
                return m["team2"]
            elif m["team2"] == user_id:
                return m["team1"]
    return None


def comp_score(picks: list) -> float:
    """
    Score a (partial) team composition [0-100] across five axes:
      1. Damage balance  (AD/AP mix)        : 0-25
      2. CC / Engage depth                  : 0-25
      3. Synergy combos                     : 0-20
      4. Meta power (avg tier pts)          : 0-20
      5. Game-plan coherence (early/scaling): 0-10
    """
    if not picks:
        return 0.0

    names = [p.get("champion", "") if isinstance(p, dict) else str(p) for p in picks]
    traits = [CHAMP_TRAITS.get(n, ("AD", 0, ())) for n in names]
    n = len(names)

    # 1. Damage balance
    eff_ad = sum(1 if t[0]=="AD" else 0.5 if t[0]=="Mixed" else 0 for t in traits)
    eff_ap = sum(1 if t[0]=="AP" else 0.5 if t[0]=="Mixed" else 0 for t in traits)
    if n >= 3 and max(eff_ad, eff_ap) > 0:
        balance = min(eff_ad, eff_ap) / max(eff_ad, eff_ap)
        dmg_sc  = balance * 25
    else:
        dmg_sc = 12.5   # neutral for small partial comps

    # 2. CC / Engage
    total_cc   = sum(t[1] for t in traits)
    eng_count  = sum(1 for t in traits if "eng" in t[2])
    cc_sc      = min(25.0, total_cc * 3.5 + eng_count * 1.5)

    # 3. Synergies
    name_set = set(names)
    syn_pts  = sum(v for pair, v in SYNERGY_PAIRS if pair.issubset(name_set))
    syn_sc   = min(20.0, syn_pts * 5.0)

    # 4. Meta power
    tier_pts = {"S": 4, "A": 3, "B": 2, "C": 1}
    avg_tier = sum(tier_pts.get(META_LOOKUP.get(nm, {}).get("tier", "C"), 1) for nm in names) / n
    meta_sc  = min(20.0, avg_tier * 5.0)

    # 5. Scaling / game-plan coherence
    scalers   = sum(1 for t in traits if "scl" in t[2])
    eg_champs = sum(1 for t in traits if "eg"  in t[2])
    if scalers >= 2 and eg_champs >= 1:
        plan_sc = 10.0   # ideal balance
    elif scalers >= 3:
        plan_sc = 8.0    # heavy scaling (vulnerable early)
    elif eg_champs >= 3:
        plan_sc = 6.0    # heavy early (might fall off)
    else:
        plan_sc = 4.0

    return dmg_sc + cc_sc + syn_sc + meta_sc + plan_sc


def delta_analyzer(candidate: str, pos: str,
                   my_picks: list, enemy_picks: list,
                   remaining_positions: list, draft_step: int) -> float:
    """
    Score how good it is to pick `candidate` at `pos` right now.

    Three pillars (matches the sequence-aware simulator architecture):
      A. Compositional delta   — how much does this pick improve our comp?
      B. Counter value         — does it counter existing enemy picks?
      C. Sequence weight       — early=tier priority, mid=synergy, late=counter
    """
    # A. Compositional delta
    new_picks = my_picks + [{"champion": candidate, "position": pos}]
    comp_delta = comp_score(new_picks) - comp_score(my_picks)

    # B. Counter value
    enemy_names  = {p.get("champion", "") for p in enemy_picks}
    countered    = COUNTER_MAP.get(candidate, set()) & enemy_names
    counter_val  = len(countered) * 4.0

    # Role viability: champion's primary meta position matches needed slot?
    primary_pos = META_LOOKUP.get(candidate, {}).get("position", "")
    role_fit    = 3.0 if primary_pos == pos else -1.5

    # Tier of the candidate
    tier     = META_LOOKUP.get(candidate, {}).get("tier", "C")
    tier_val = {"S": 4, "A": 3, "B": 2, "C": 1}.get(tier, 1)

    # C. Sequence weights
    if draft_step <= 5:
        # Early picks: prioritise S-tier flexible picks, establish strong base
        seq = tier_val * 4.0 + comp_delta * 0.6
    elif draft_step <= 14:
        # Mid picks: complete roles, maximise comp synergy
        seq = comp_delta * 1.8 + tier_val * 1.5 + counter_val * 0.6
    else:
        # Late picks: counter-pick is king
        seq = counter_val * 2.5 + comp_delta * 1.0 + tier_val * 0.8

    return seq + role_fit + counter_val


def calculate_draft_advantage(user_draft: dict, user_team_id: str, opponent_team_id: str) -> float:
    """
    Compute a draft advantage score [-12, +12].

    Factors:
    1. Compositional delta  — user comp_score vs enemy comp_score
    2. Pool fit             — +1 per pick already in player's pool
    3. Ban value            — targeted S/A bans against opponent's pool
    4. Pick quality bonus   — WR > 55% gets extra credit
    """
    if not user_draft:
        return 0.0

    advantage = 0.0

    # ── 0. Normalise inputs ────────────────────────────────────────────────
    # Picks can arrive as either [{"champion": "x", "position": "y"}] or plain ["x", "y"]
    # (some MP payloads strip the position). Accept both.
    def _pick_name(p) -> str:
        if isinstance(p, dict):
            return p.get("champion", "") or ""
        return str(p) if p else ""

    def _pick_pos(p) -> str | None:
        if isinstance(p, dict):
            return p.get("position")
        return None

    def _ban_name(b) -> str:
        if isinstance(b, dict):
            return b.get("champion", "") or ""
        return str(b) if b else ""

    # ── 1. Compositional delta ─────────────────────────────────────────────
    user_picks  = user_draft.get("picks", []) or []
    draft_state = GAME_STATE.get("draft_state") or {}
    # Prefer enemy_picks from the payload (MP provides it); fall back to solo GAME_STATE.
    enemy_picks = user_draft.get("enemy_picks") or draft_state.get("enemy_picks", [])

    user_comp_sc  = comp_score(user_picks)
    enemy_comp_sc = comp_score(enemy_picks)
    advantage    += (user_comp_sc - enemy_comp_sc) / 8.0   # normalise to ~±6

    # ── 2. Pick quality (WR bonus) ─────────────────────────────────────────
    for pick in user_picks:
        meta = META_LOOKUP.get(_pick_name(pick), {})
        if meta.get("winrate", 0) > 55:
            advantage += 0.4
        elif meta.get("winrate", 0) < 45:
            advantage -= 0.2

    # ── 3. Pool fit ────────────────────────────────────────────────────────
    team = GAME_STATE["teams"].get(user_team_id, {})
    starters_by_pos: dict = {}
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        if p and p.get("is_starter"):
            starters_by_pos[p["position"]] = p

    for pick in user_picks:
        pos = _pick_pos(pick)
        if pos is None:
            continue
        player = starters_by_pos.get(pos)
        if player and _pick_name(pick) in player.get("champion_pool", []):
            advantage += 1.0

    # ── 4. Ban value ───────────────────────────────────────────────────────
    opponent_pool = _get_team_champ_pool(opponent_team_id)
    for ban_raw in (user_draft.get("bans", []) or []):
        ban = _ban_name(ban_raw)
        if not ban:
            continue
        meta = META_LOOKUP.get(ban, {})
        tier = meta.get("tier", "C")
        if tier == "S" and ban in opponent_pool:
            advantage += 1.5
        elif tier == "A" and ban in opponent_pool:
            advantage += 0.5
        elif tier == "S":
            advantage += 0.3   # blind S-tier ban still has value

    return max(-12.0, min(12.0, advantage))


def ai_select_ban(draft: dict) -> Optional[str]:
    """
    Sequence-aware ban selection:
    - Early bans  (step ≤ 5) : target S-tier + opponent's champion pool
    - Late bans   (step > 5) : target counters to our forming composition
    Never ban a champion for a role the opponent has already filled.
    Fearless-excluded champions are never banned (they can't be picked anyway).
    """
    step        = draft["step"]
    fearless    = set(draft.get("fearless_excluded", []))
    unavailable = set(draft["banned_champions"] + draft["picked_champions"]) | fearless
    my_picks   = [p.get("champion","") for p in draft["enemy_picks"]]   # AI is "enemy"
    my_traits  = [CHAMP_TRAITS.get(c, ("AD", 0, ())) for c in my_picks]

    opp_id   = _get_current_opponent_id()
    opp_pool = _get_team_champ_pool(opp_id) if opp_id else set()
    opp_pool_by_pos = _get_team_champ_pool_by_pos(opp_id) if opp_id else {}

    # Positions the opponent (user) has already locked in
    opp_filled_positions = {p.get("position") for p in draft["user_picks"] if p.get("position")}
    # Positions the opponent still needs
    opp_needed_positions = set(_needed_positions(draft, "user"))

    my_scalers = sum(1 for t in my_traits if "scl" in t[2])
    my_eg      = sum(1 for t in my_traits if "eg"  in t[2])

    candidates = []
    for name, meta in META_LOOKUP.items():
        if name in unavailable:
            continue

        tier     = meta.get("tier", "C")
        presence = meta.get("presence", 0.0)
        wr       = meta.get("winrate", 50.0)
        # Use actual player position from pool, not meta position
        pool_pos = next((pos for pos, champs in opp_pool_by_pos.items() if name in champs), None)
        champ_pos = pool_pos or meta.get("position", "")

        # Base ban priority: raw meta value
        weight = presence * 0.4 + wr * 0.2
        weight += {"S": 18, "A": 9, "B": 3, "C": 0}.get(tier, 0)

        # De-prioritize banning for roles the opponent already filled — it's a wasted ban
        if champ_pos and champ_pos in opp_filled_positions:
            weight -= 20

        # Extra value for banning strong champions the opponent still needs
        if champ_pos and champ_pos in opp_needed_positions:
            weight += 8

        if step <= 5:
            # Early: punish opponent's pool + global S-tier threats
            if name in opp_pool and champ_pos not in opp_filled_positions:
                weight += 22
        else:
            # Late: protect our comp from specific threats
            traits = CHAMP_TRAITS.get(name, ("AD", 0, ()))
            # If we're building scaling → ban early-game bullies
            if my_scalers >= 2 and "eg" in traits[2]:
                weight += 12
            # If we have no engage → ban peel supports to protect our engage
            my_eng = sum(1 for t in my_traits if "eng" in t[2])
            if my_eng >= 2 and "dis" in traits[2]:
                weight += 8

        candidates.append((name, weight))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[1], reverse=True)
    top     = candidates[:10]
    weights = [max(0.1, c[1]) for c in top]
    total   = sum(weights)
    r       = random.uniform(0, total)
    running = 0.0
    for name, w in top:
        running += w
        if r <= running:
            return name
    return top[0][0]


def ai_select_pick(draft: dict, needed_positions: list):
    """
    Delta-Analyzer based pick:
    Evaluates every available champion × every needed position using delta_analyzer,
    then picks from the top candidates via weighted random (adds slight variance).
    Fearless-excluded champions cannot be picked.
    """
    fearless     = set(draft.get("fearless_excluded", []))
    unavailable  = set(draft["banned_champions"] + draft["picked_champions"]) | fearless
    step         = draft["step"]
    my_picks     = draft["enemy_picks"]    # AI = "enemy"
    enemy_picks  = draft["user_picks"]     # User = opponent from AI's POV

    candidates = []
    for pos in needed_positions:
        for champ in get_meta_champions().get(pos, []):
            name = champ["name"]
            if name in unavailable:
                continue
            score = delta_analyzer(name, pos, my_picks, enemy_picks, needed_positions, step)
            candidates.append((name, pos, score))

    if not candidates:
        for pos, champs in get_meta_champions().items():
            for c in champs:
                if c["name"] not in unavailable:
                    return c["name"], pos
        return None, None

    candidates.sort(key=lambda x: x[2], reverse=True)
    top     = candidates[:6]
    weights = [max(0.1, c[2] + 10) for c in top]   # shift to keep weights positive
    total   = sum(weights)
    r       = random.uniform(0, total)
    running = 0.0
    for name, pos, w in top:
        running += w
        if r <= running:
            return name, pos
    return top[0][0], top[0][1]


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
async def draft_suggest():
    """
    Return top suggestions for the current user draft turn with Delta-Analyzer explanation.
    Includes comp_gain, counter targets, and reason label.
    """
    draft = GAME_STATE.get("draft_state")
    if not draft:
        raise HTTPException(status_code=400, detail="No draft in progress")

    step = draft["step"]
    if step >= len(DRAFT_SEQUENCE):
        return {"suggestions": [], "action": None}

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
            champ = ai_select_ban(draft)
            if champ:
                _draft_apply(draft, "enemy", "ban", champ)
        else:
            champ, pos = ai_select_pick(draft, _needed_positions(draft, "enemy"))
            if champ:
                _draft_apply(draft, "enemy", "pick", champ, pos)
        step += 1
        draft["step"] = step

    draft["phase"] = _draft_phase_name(draft)
    draft["current_turn"] = DRAFT_SEQUENCE[step][0] if step < len(DRAFT_SEQUENCE) else None

    return draft

# Training

class TrainingRequest(BaseModel):
    player_id: str
    training_type: str  # scrims, vod_review, bootcamp, rest

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


def _execute_training_plan(player: dict, team: dict) -> str | None:
    """Auto-apply a player's training_plan. Returns the plan actually applied, or None."""
    plan = player.get("training_plan")
    if not plan or player.get("training_done_this_week"):
        return None

    TRAINING_CONFIG = {
        "scrims":     {"fatigue": +10, "moral": -3,  "form_bonus": 2, "dev": {"mechanics": 2, "teamwork": 1},     "cost": 50000},
        "vod_review": {"fatigue": +4,  "moral": +3,  "form_bonus": 1, "dev": {"game_sense": 3, "consistency": 1}, "cost": 20000},
        "bootcamp":   {"fatigue": +18, "moral": -8,  "form_bonus": 3, "dev": {"mechanics": 2, "game_sense": 2},   "cost": 100000},
        "rest":       {"fatigue": -25, "moral": +12, "form_bonus": 1, "dev": {},                                  "cost": 0},
    }
    cfg = TRAINING_CONFIG.get(plan)
    if not cfg:
        return None

    # Check budget
    cost = cfg["cost"]
    applied_plan = plan
    if cost > 0:
        user_team = GAME_STATE["teams"].get(GAME_STATE.get("user_team", ""), {})
        if user_team.get("budget", 0) < cost:
            # Fall back to rest (free) — caller can detect this and notify the user
            cfg = TRAINING_CONFIG["rest"]
            cost = 0
            applied_plan = "rest"
        else:
            user_team["budget"] = user_team["budget"] - cost

    DEV_XP_THRESHOLD = 10

    player["fatigue"]    = max(0,   min(100, player.get("fatigue", 30) + cfg["fatigue"]))
    player["moral"]      = max(0,   min(100, player.get("moral",   75) + cfg["moral"]))
    player["form_bonus"] = min(6,   player.get("form_bonus", 0) + cfg["form_bonus"])

    for stat, xp_gain in cfg["dev"].items():
        xp_key = f"dev_xp_{stat}"
        player[xp_key] = player.get(xp_key, 0) + xp_gain
        while player[xp_key] >= DEV_XP_THRESHOLD:
            player[xp_key] -= DEV_XP_THRESHOLD
            gain_key = f"training_gain_{stat}"
            total_gain = player.get(gain_key, 0.0)
            if total_gain < 2.0:
                actual = min(0.3, 2.0 - total_gain)
                # Apply gain directly to rating — never recompute from sub-stats
                pot_cap = int(player.get("potential", 90) * 0.95)
                player["rating"] = min(pot_cap, player.get("rating", 75) + 1)
                player[gain_key] = round(total_gain + actual, 2)
    # rating stays as-is — no recalculation from sub-stats

    player["training_done_this_week"] = True
    return applied_plan


class TrainingPlanRequest(BaseModel):
    player_id: str
    training_type: str  # scrims, vod_review, bootcamp, rest, or "" to clear


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


# Roster Management

class RosterSwapRequest(BaseModel):
    player1_id: str
    player2_id: str

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
    transfers_done = []

    ai_teams = [t for t in GAME_STATE["teams"].values() if t["id"] != user_team_id]
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
    if not GAME_STATE["user_team"]:
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
    
    # 3 — Save current user roster BEFORE reinit (must survive the reset)
    saved_user_roster_ids = list(user_team.get("roster", []))
    saved_user_players = {
        pid: dict(GAME_STATE["players"][pid])
        for pid in saved_user_roster_ids
        if pid in GAME_STATE["players"]
    }
    # Age players by 0.5 year, reduce contract
    for p in saved_user_players.values():
        p["age"] = round(p.get("age", 22) + 0.5, 1)
        p["contract_years"] = max(0, p.get("contract_years", 1) - 1)
        # Slight natural rating evolution
        delta = random.randint(-2, 3)
        p["rating"] = max(50, min(99, p["rating"] + delta))
        p["potential"] = p.get("potential", p["rating"])
    
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
        
        if team["id"] == user_team_id:
            # Restore user's saved roster (no changes from split data)
            for pid, player in saved_user_players.items():
                player["team_id"] = user_team_id
                GAME_STATE["players"][pid] = player
            team["roster"] = list(saved_user_players.keys())
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


def _intl_sim(t1: dict, t2: dict, best_of: int, t1_boost: float = 0, t2_boost: float = 0) -> dict:
    wn = (best_of + 1) // 2
    w1 = w2 = 0
    games = []
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


class IntlSimRequest(BaseModel):
    match_id: str
    user_draft: Optional[dict] = None


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

    if intl["type"] == "msi":
        pi_ms = intl["play_in"]["matches"]; bk_ms = intl["bracket"]["matches"]
        if mid in pi_ms:
            m = pi_ms[mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            if m.get("locked"):    raise HTTPException(400, "Not ready")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            _msi_update_play_in(intl, mid, _intl_sim(m["team1"], m["team2"], m["best_of"], b1, b2))
        elif mid in bk_ms:
            m = bk_ms[mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            if m.get("locked"):    raise HTTPException(400, "Not ready")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            _msi_update_bracket(intl, mid, _intl_sim(m["team1"], m["team2"], m["best_of"], b1, b2))
        else: raise HTTPException(404, "Match not found")
    else:
        if mid == "pi_main":
            m = intl["play_in"]["match"]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            res = _intl_sim(m["team1"], m["team2"], 5, b1, b2)
            m.update(winner_id=res["winner_id"], score1=res["score1"], score2=res["score2"], games=res["games"])
            intl["play_in"]["qualified"] = res["winner_id"]; intl["play_in"]["completed"] = True
            q_team = next((t for t in intl["play_in"]["teams"] if t["id"] == res["winner_id"]), None)
            teams_16 = intl["swiss"]["pre_qualified"] + ([q_team] if q_team else [])
            for t in teams_16: t.update(sw_wins=0, sw_losses=0, sw_opponents=[], sw_advanced=False, sw_eliminated=False)
            intl["swiss"]["teams"] = teams_16; intl["stage"] = "swiss"
            _worlds_gen_swiss_round(intl)
        elif mid.startswith("sw_"):
            sw_rounds = intl["swiss"]["rounds"]
            if not sw_rounds: raise HTTPException(400, "Swiss not started")
            cur = sw_rounds[-1]
            if mid not in cur["matches"]: raise HTTPException(404, "Match not found")
            m = cur["matches"][mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            _worlds_update_swiss(intl, mid, _intl_sim(m["team1"], m["team2"], m["best_of"], b1, b2))
        else:
            km = intl["knockout"]["matches"]
            if mid not in km: raise HTTPException(404, "Match not found")
            m = km[mid]
            if m.get("winner_id"): raise HTTPException(400, "Already played")
            if m.get("locked"):    raise HTTPException(400, "Not ready")
            b1, b2 = _boost(m, m["team1"], m["team2"])
            _worlds_update_knockout(intl, mid, _intl_sim(m["team1"], m["team2"], 5, b1, b2))
    return intl

# ============ END INTERNATIONAL TOURNAMENT ============

# ============ TACTICS SYSTEM ============

DEFAULT_TACTICS = {
    "strong_side":    "bot",        # "top" | "mid" | "bot"
    "game_timing":    "mid",        # "early" | "mid" | "late"
    "jungle_style":   "ganker",     # "ganker" | "invader" | "farmer" | "enabler"
    "jungle_pathing": "top_to_bot", # "top_to_bot" | "bot_to_top"
    "lanes": {
        "TOP":     {"lane_style": "economy",       "tp_usage": "safety"},
        "MID":     {"lane_style": "lane_priority", "tp_usage": "objectives"},
        "ADC":     {"lane_style": "economy"},
        "SUPPORT": {"roaming": "play_lane"},
    },
}

# Coherence rules: list of (description, condition_fn, delta)
# condition_fn receives the full tactics dict and returns True if the rule applies.
COHERENCE_RULES = [
    ("Strong side bot avec lane style bot = Economy",
     lambda t: t["strong_side"] == "bot" and t["lanes"]["ADC"]["lane_style"] == "economy",
     -0.5),
    ("Strong side top avec lane style top = Economy",
     lambda t: t["strong_side"] == "top" and t["lanes"]["TOP"]["lane_style"] == "economy",
     -0.5),
    ("Economy sur le côté faible (top ≠ strong side)",
     lambda t: t["strong_side"] != "top" and t["lanes"]["TOP"]["lane_style"] == "economy",
     +0.5),
    ("Economy sur le côté faible (bot ≠ strong side)",
     lambda t: t["strong_side"] != "bot" and t["lanes"]["ADC"]["lane_style"] == "economy",
     +0.5),
    ("Support play lane + strong side bot",
     lambda t: t["strong_side"] == "bot" and t["lanes"]["SUPPORT"]["roaming"] == "play_lane",
     +0.5),
    ("Early game + Jungle Ganker",
     lambda t: t["game_timing"] == "early" and t["jungle_style"] == "ganker",
     +0.5),
    ("Late game + Jungle Farmer",
     lambda t: t["game_timing"] == "late" and t["jungle_style"] == "farmer",
     +0.5),
    ("Mid game + Jungle Invader",
     lambda t: t["game_timing"] == "mid" and t["jungle_style"] == "invader",
     +0.3),
    ("Mid lane priority + strong side mid",
     lambda t: t["strong_side"] == "mid" and t["lanes"]["MID"]["lane_style"] == "lane_priority",
     +0.4),
    ("Support roam top + strong side top",
     lambda t: t["strong_side"] == "top" and t["lanes"]["SUPPORT"]["roaming"] in ("roam_top", "roam_mid"),
     +0.4),
    ("Jungle pathing bot→top + strong side top",
     lambda t: t["strong_side"] == "top" and t["jungle_pathing"] == "bot_to_top",
     +0.3),
    ("Jungle pathing top→bot + strong side bot",
     lambda t: t["strong_side"] == "bot" and t["jungle_pathing"] == "top_to_bot",
     +0.3),
    ("Enabler jungle + Kill Pressure mid",
     lambda t: t["jungle_style"] == "enabler" and t["lanes"]["MID"]["lane_style"] == "kill_pressure",
     +0.4),
    ("Invader jungle + TP Safety top",
     lambda t: t["jungle_style"] == "invader" and t["lanes"]["TOP"]["tp_usage"] == "safety",
     -0.3),
]


def get_user_tactics() -> dict:
    """Return current user tactics, initializing to default if missing."""
    if "tactics" not in GAME_STATE or not GAME_STATE["tactics"]:
        GAME_STATE["tactics"] = {**DEFAULT_TACTICS, "lanes": {k: {**v} for k, v in DEFAULT_TACTICS["lanes"].items()}}
    return GAME_STATE["tactics"]


def evaluate_coherence(tactics: dict) -> dict:
    """Evaluate all coherence rules and return checks + net modifier."""
    checks = []
    net = 0.0
    for desc, condition, delta in COHERENCE_RULES:
        try:
            passed = condition(tactics)
        except (KeyError, TypeError):
            continue
        if passed:
            checks.append({"description": desc, "delta": delta, "passed": True})
            net += delta
    return {"checks": checks, "net": round(net, 2)}


def calculate_tactics_modifier(tactics: dict) -> float:
    """Convert coherence net modifier to a team power bonus (capped ±3)."""
    coherence = evaluate_coherence(tactics)
    raw = coherence["net"]
    return max(-3.0, min(3.0, raw * 1.5))


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

class _Mp2CreateBody(BaseModel):
    league: str
    username: str


class _Mp2JoinBody(BaseModel):
    code: str
    username: str


class _Mp2TeamBody(BaseModel):
    token: str
    team_id: str


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
            "info": _mp2_public_info(sess, token)}


@api_router.post("/mp2/join")
def mp2_join(body: _Mp2JoinBody):
    """Join an existing session by its short code."""
    try:
        sess, token = _sessions.join_session(body.code, body.username)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return {"sid": sess.sid, "code": sess.code, "token": token,
            "info": _mp2_public_info(sess, token)}


@api_router.get("/mp2/{sid}/info")
def mp2_info(sid: str, token: str | None = None):
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    return _mp2_public_info(sess, token)


@api_router.post("/mp2/{sid}/team")
def mp2_pick_team(sid: str, body: _Mp2TeamBody):
    sess = _sessions.get_session(sid)
    if sess is None:
        raise HTTPException(404, "Session introuvable")
    try:
        _sessions.assign_team(sess, body.token, body.team_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return _mp2_public_info(sess, body.token)


@api_router.get("/mp2/sessions")
def mp2_list():
    """Debug/health listing of active sessions."""
    return _sessions.list_sessions()


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

    async with _swap_lock:
        solo_snapshot = dict(GAME_STATE)
        GAME_STATE.clear()
        GAME_STATE.update(sess.state)
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
        try:
            response = await call_next(request)
            # Persist mutations back into the session, but keep user_team
            # at the session level (not the per-player view we swapped in).
            # Teams picked via /teams/select/{id} update session.players[token]
            # inside that handler, not via GAME_STATE, so this is safe.
            new_user_team = GAME_STATE.get("user_team")
            sess.state.clear()
            sess.state.update(GAME_STATE)
            # Restore the session-level user_team unless the handler set a new
            # value that differs from the per-player view. This keeps solo
            # semantics for endpoints that legitimately set user_team (/saves/load)
            # while not letting a per-player view leak into the stored state.
            if per_player_team and new_user_team == per_player_team:
                # No change made by handler — restore previous session-level value.
                if session_user_team_snapshot is not None:
                    sess.state["user_team"] = session_user_team_snapshot
                else:
                    sess.state.pop("user_team", None)
            _sessions.mark_dirty(sid)
            # Notify all subscribers so they refetch. Only on successful
            # mutating requests — GETs don't touch state, failures don't either.
            if mutating and 200 <= response.status_code < 300:
                try:
                    await _sessions.broadcast(sid, "state_changed", {
                        "path": request.url.path,
                        "method": request.method,
                    })
                except Exception:
                    logger.exception("broadcast state_changed failed (sid=%s)", sid[:8])
            return response
        finally:
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