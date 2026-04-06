"""
Generate csv_erl_data.py from Oracle's Elixir CSV data.

Sources:
  - LCKC  (LCK Challengers)    2026 split 1  → LCK scouting pool
  - NACL  (NA Challengers)     2026 Spring   → LCS scouting pool
  - EM    (European Masters)   2026 Winter   → LEC scouting pool
  - CD    (CBLOL Academy)      2026          → CBLOL scouting pool
  - LRS   (Liga Respawn)       2026 Split 1  → CBLOL scouting pool
  - DCup  (LPL Dev Cup / LDL proxy) 2025     → LPL scouting pool

Run:  python generate_erl_data.py
Output: csv_erl_data.py
"""

import csv
import random
import statistics
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CSV_DIR = SCRIPT_DIR.parent  # CSVs live in project root, not backend/

POS_MAP = {"top": "TOP", "jng": "JUNGLE", "mid": "MID", "bot": "ADC", "sup": "SUPPORT"}

# Default nationality by league
LEAGUE_NATIONALITY = {
    "LCKC":  "KR",
    "NACL":  "US",
    "EM":    "EU",   # mixed; will try to refine per team region
    "CD":    "BR",
    "LRS":   "BR",
    "DCup":  "CN",
}

# scouting_for: which main league uses this pool
LEAGUE_SCOUT_FOR = {
    "LCKC":  "LCK",
    "NACL":  "LCS",
    "EM":    "LEC",
    "CD":    "CBLOL",
    "LRS":   "CBLOL",
    "DCup":  "LPL",
}

# (league, csv_year, split_filter_or_None)
SOURCES = [
    ("LCKC",  "2026", None),         # Kickoff + Rounds 1-2
    ("NACL",  "2026", None),         # Spring
    ("EM",    "2026", None),         # Winter
    ("CD",    "2026", None),         # Split 1
    ("LRS",   "2026", "Split 1"),
    ("DCup",  "2025", None),         # LPL dev proxy (LDL not in OraclesElixir)
]

# CSPM expectations per position (for normalisation)
CSPM_EXPECT = {"TOP": 8.5, "JUNGLE": 7.0, "MID": 8.8, "ADC": 9.0, "SUPPORT": 0.9}
CSPM_STDDEV = {"TOP": 1.0, "JUNGLE": 0.8, "MID": 0.9, "ADC": 0.9, "SUPPORT": 0.5}

# DPM expectations per position
DPM_EXPECT  = {"TOP": 420, "JUNGLE": 380, "MID": 520, "ADC": 580, "SUPPORT": 180}
DPM_STDDEV  = {"TOP": 120, "JUNGLE": 100, "MID": 130, "ADC": 150, "SUPPORT":  80}


def safe_float(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def safe_int(val, default=0):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def load_rows(league: str, year: str, split_filter):
    fname = CSV_DIR / f"{year}_LoL_esports_match_data_from_OraclesElixir.csv"
    with open(fname, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = [r for r in reader if r.get("league") == league]
    if split_filter:
        rows = [r for r in rows if r.get("split") == split_filter]
    # Only individual player rows (not team aggregate rows)
    rows = [r for r in rows if r.get("position") not in ("team", "")]
    return rows


def aggregate_player(rows: list) -> dict:
    """Aggregate per-game rows into per-player career stats."""
    if not rows:
        return {}
    first = rows[0]
    games = len(rows)
    wins  = sum(safe_int(r["result"]) for r in rows)

    kills   = sum(safe_int(r["kills"])   for r in rows)
    deaths  = sum(safe_int(r["deaths"])  for r in rows)
    assists = sum(safe_int(r["assists"]) for r in rows)

    cspm_vals = [safe_float(r["cspm"]) for r in rows if safe_float(r["cspm"]) > 0]
    dpm_vals  = [safe_float(r["dpm"])  for r in rows if safe_float(r["dpm"])  > 0]
    gpm_vals  = [safe_float(r.get("earned gpm", 0)) for r in rows if safe_float(r.get("earned gpm", 0)) > 0]

    kda = (kills + assists) / max(deaths, 1)
    cspm = statistics.mean(cspm_vals) if cspm_vals else 0.0
    dpm  = statistics.mean(dpm_vals)  if dpm_vals  else 0.0
    gpm  = statistics.mean(gpm_vals)  if gpm_vals  else 0.0
    wr   = wins / games

    return {
        "playername": first["playername"],
        "teamname":   first["teamname"],
        "position":   POS_MAP.get(first["position"], first["position"].upper()),
        "games":      games,
        "wins":       wins,
        "kda":        round(kda, 2),
        "cspm":       round(cspm, 2),
        "dpm":        round(dpm, 1),
        "gpm":        round(gpm, 1),
        "winrate":    round(wr, 3),
    }


def compute_rating(stats: dict) -> int:
    """
    Convert aggregated stats into a 65–82 game rating.

    Components:
      - KDA component   (40%): normalised against typical pro-level KDA 1.5–6.5
      - CSPM component  (25%): z-score vs role expectation, clipped to ±2σ
      - DPM component   (20%): z-score vs role expectation
      - Winrate         (15%): 50% → 0 bonus, each % above/below ±0.15 pts
    Result mapped to [65, 82].
    """
    pos = stats.get("position", "MID")

    # KDA: ERL range ~1.0–7.0, mid point ~3.0
    kda = stats["kda"]
    kda_score = max(0.0, min(100.0, (kda - 1.0) / 6.0 * 100))

    # CSPM z-score  (support treated separately)
    cspm = stats.get("cspm", 0)
    exp_cspm = CSPM_EXPECT.get(pos, 8.0)
    std_cspm = CSPM_STDDEV.get(pos, 1.0)
    cspm_z = max(-2.0, min(2.0, (cspm - exp_cspm) / std_cspm))
    cspm_score = 50 + cspm_z * 25  # maps ±2σ → [0, 100]

    # DPM z-score
    dpm = stats.get("dpm", 0)
    exp_dpm = DPM_EXPECT.get(pos, 400)
    std_dpm = DPM_STDDEV.get(pos, 100)
    dpm_z = max(-2.0, min(2.0, (dpm - exp_dpm) / std_dpm))
    dpm_score = 50 + dpm_z * 25

    # Winrate bonus/penalty
    wr = stats.get("winrate", 0.5)
    wr_score = (wr - 0.5) * 100 + 50  # 50% → 50, 60% → 60, 40% → 40

    composite = kda_score * 0.40 + cspm_score * 0.25 + dpm_score * 0.20 + wr_score * 0.15
    # Map 0–100 composite → 65–82
    rating = int(65 + (composite / 100) * 17)
    return max(65, min(82, rating))


def compute_potential(rating: int, age: int, kda: float) -> int:
    """
    Potential = rating + age-based ceiling + small talent bonus.
    Range: rating+3 to rating+18, capped at 92.
    """
    if age <= 19:
        ceiling = random.randint(13, 18)
    elif age <= 21:
        ceiling = random.randint(9, 14)
    elif age <= 23:
        ceiling = random.randint(6, 11)
    elif age <= 25:
        ceiling = random.randint(3, 8)
    else:
        ceiling = random.randint(1, 5)

    # High performers get a small talent bonus
    if kda >= 5.0:
        ceiling = min(ceiling + 3, 20)
    elif kda >= 4.0:
        ceiling = min(ceiling + 1, 20)

    return min(92, rating + ceiling)


def age_for_league(league: str) -> int:
    """Development league players trend 18-23."""
    if league == "EM":
        return random.randint(19, 26)
    if league in ("LCKC", "NACL"):
        return random.randint(18, 23)
    return random.randint(18, 24)


def nationality_for(league: str, teamname: str) -> str:
    """Infer nationality from league default; EM gets refined by team country clues."""
    if league != "EM":
        return LEAGUE_NATIONALITY[league]
    # Rough EM country inference from team name keywords
    team = teamname.lower()
    if any(k in team for k in ("fnatic", "g2", "excel", "bds", "koi", "vitality", "heretics",
                                "giantx", "sk", "karmine", "solary", "misa", "ldlc")):
        country_map = {
            "fnatic": "UK", "excel": "UK",
            "g2": "DE", "bds": "FR", "sk gaming": "DE",
            "karmine": "FR", "solary": "FR", "misa": "FR", "ldlc": "FR",
            "koi": "ES", "heretics": "ES",
            "vitality": "FR", "giantx": "ES",
        }
        for kw, nat in country_map.items():
            if kw in team:
                return nat
    if any(k in team for k in ("unicorns", "blink", "nexus", "nordics", "nip",
                                "samsung", "big", "kcorp", "pmt", "macko")):
        return random.choice(["DE", "PL", "CZ", "HU", "RO", "SE", "DK", "FI"])
    return random.choice(["FR", "DE", "ES", "PL", "UK", "SE", "DK", "BE", "NL"])


def process_league(league: str, year: str, split_filter, min_games: int = 3) -> list:
    """
    Parse CSV for one league → return list of ERL player dicts.
    Filters players with fewer than min_games.
    """
    rows = load_rows(league, year, split_filter)
    if not rows:
        print(f"  WARNING: no rows found for {league} {year} split={split_filter}")
        return []

    # Group by (playername, teamname, position)
    grouped = defaultdict(list)
    for row in rows:
        key = (row["playername"], row["teamname"], row["position"])
        grouped[key].append(row)

    players = []
    for (pname, tname, csv_pos), p_rows in grouped.items():
        if len(p_rows) < min_games:
            continue
        pos = POS_MAP.get(csv_pos, csv_pos.upper())
        if pos not in POS_MAP.values():
            continue  # skip unknown positions

        stats  = aggregate_player(p_rows)
        rating = compute_rating(stats)
        age    = age_for_league(league)
        pot    = compute_potential(rating, age, stats["kda"])
        nat    = nationality_for(league, tname)

        players.append({
            "name":        pname,
            "position":    pos,
            "nationality": nat,
            "age":         age,
            "rating":      rating,
            "potential":   pot,
            "league":      league,
            "team":        tname,
            "scouting_for": LEAGUE_SCOUT_FOR[league],
            # Extra stat context (used by generate_erl_player to seed real stats)
            "csv_kda":     stats["kda"],
            "csv_cspm":    stats["cspm"],
            "csv_dpm":     stats["dpm"],
            "csv_games":   stats["games"],
            "csv_winrate": stats["winrate"],
        })

    print(f"  {league} ({year} {split_filter or 'all'}): {len(rows)} rows -> {len(players)} players")
    return players


def write_output(all_players: list):
    out_path = SCRIPT_DIR / "csv_erl_data.py"
    lines = [
        '"""',
        'ERL / Academy scouting player pool — auto-generated from Oracle\'s Elixir CSV data.',
        '',
        'Sources (first split of 2026 unless noted):',
        '  LCKC  → LCK scouting   (2026 Kickoff + Rounds 1-2)',
        '  NACL  → LCS scouting   (2026 Spring)',
        '  EM    → LEC scouting   (2026 Winter)',
        '  CD    → CBLOL scouting (2026 Split 1)',
        '  LRS   → CBLOL scouting (2026 Split 1)',
        '  DCup  → LPL scouting   (2025 Dev Cup — LDL not in Oracle\'s Elixir dataset)',
        '',
        'Note on LDL: Oracle\'s Elixir does not track LDL as a separate league.',
        'DCup (Development Cup) is the closest available proxy: it is a Chinese domestic',
        'development tournament contested by LPL reserve/academy rosters.',
        '"""',
        '',
        'SCOUTING_PLAYERS = [',
    ]

    for p in sorted(all_players, key=lambda x: (x["scouting_for"], x["league"], x["team"], x["position"])):
        line = (
            f'    {{"name": {p["name"]!r}, "position": {p["position"]!r}, '
            f'"nationality": {p["nationality"]!r}, "age": {p["age"]}, '
            f'"rating": {p["rating"]}, "potential": {p["potential"]}, '
            f'"league": {p["league"]!r}, "team": {p["team"]!r}, '
            f'"scouting_for": {p["scouting_for"]!r}, '
            f'"csv_kda": {p["csv_kda"]}, "csv_cspm": {p["csv_cspm"]}, '
            f'"csv_dpm": {p["csv_dpm"]}, "csv_games": {p["csv_games"]}, '
            f'"csv_winrate": {p["csv_winrate"]}}},'
        )
        lines.append(line)

    lines.append(']')
    lines.append('')

    with open(out_path, "w", encoding="utf-8") as f:
        f.write('\n'.join(lines))

    print(f"\nWrote {len(all_players)} players to {out_path}")


def main():
    random.seed(42)  # reproducible ratings
    all_players = []
    for league, year, split_filter in SOURCES:
        print(f"Processing {league} ({year}, split={split_filter})...")
        players = process_league(league, year, split_filter)
        all_players.extend(players)

    # Stats summary
    from collections import Counter
    by_scout = Counter(p["scouting_for"] for p in all_players)
    print("\nPlayers per scouting pool:")
    for pool, count in sorted(by_scout.items()):
        print(f"  {pool}: {count}")

    write_output(all_players)


if __name__ == "__main__":
    main()
