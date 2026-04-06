"""
Team ELO / Glicko-inspired rating system for LEC Manager.

Rationale: Without a dynamic rating system, teams have static power values
all season — wins/losses never update relative team strength. This makes
standings purely deterministic and roster management meaningless.

Design choices vs available tools:
- K-Weighted ELO (chakrakan/lol-esports-predictions): uses EGPM/vision/gold as
  K multipliers. We adopt the K-weighting concept but derive it from our own
  match phase data (gold_diff, phase_wins) since we don't have live EGPM feeds.
- Glicko-2 would add Rating Deviation (uncertainty) which is valuable for a
  multi-season game but adds complexity for a single-season scope. Using
  Glicko-style K decay instead (confidence increases after more games).

ELO range: 800–1400 (initialized from team.rating × 10 + 200)
  - Rating 70 team → ELO 900 (low tier)
  - Rating 87 team → ELO 1070 (LEC average)
  - Rating 95 team → ELO 1150 (world-class)

Win probability formula (standard ELO):
  expected = 1 / (1 + 10^((opponent_elo - my_elo) / 400))

K-factor (dynamic, inspired by K-Weighted ELO):
  base_k = 32
  × dominance_factor  (1.0–1.5 based on gold diff and phase wins)
  × stage_factor      (1.0 regular season, 1.3 playoffs)
  × confidence_decay  (decays from 1.0 toward 0.6 as games_played → 30)
"""

import math
from typing import Optional


# ── Constants ─────────────────────────────────────────────────────────────────

BASE_K = 32
ELO_CENTER = 1000
ELO_SCALE = 400          # Standard ELO divisor
STAGE_FACTOR_REGULAR = 1.0
STAGE_FACTOR_PLAYOFFS = 1.3
MIN_K = 12               # Floor so experienced teams can still swing
CONFIDENCE_FLOOR = 0.6   # K multiplier at max games played
CONFIDENCE_GAMES = 30    # Games needed to reach confidence floor


# ── ELO Initialization ────────────────────────────────────────────────────────

def initial_elo(team_rating: int) -> float:
    """
    Convert a team's static attribute rating (70-99) to an initial ELO.
    team_rating=87 (LEC average) → ELO 1070.
    """
    return float(team_rating * 10 + 200)


def _expected_score(elo_a: float, elo_b: float) -> float:
    """Standard ELO expected score for team A vs team B."""
    return 1.0 / (1.0 + math.pow(10, (elo_b - elo_a) / ELO_SCALE))


# ── K-factor Calculation ──────────────────────────────────────────────────────

def _dominance_factor(gold_diff: int, phase_wins_winner: int) -> float:
    """
    Inspired by K-Weighted ELO: dominant wins award more ELO.

    gold_diff       : final game gold difference (from match phases)
    phase_wins_winner: how many of the 3 phases the winner dominated (1-3)

    Returns a multiplier in [1.0, 1.5]:
    - Close win (1 phase, low gold)   → ~1.0
    - Dominant win (3 phases, 8k+ gold) → ~1.5
    """
    # Gold component: 0.0–0.25 bonus (8000 gold = full bonus)
    gold_bonus = min(0.25, gold_diff / 32_000)

    # Phase sweep component: 0.0–0.25 bonus
    phase_bonus = (phase_wins_winner - 1) / 2 * 0.25

    return 1.0 + gold_bonus + phase_bonus


def _confidence_decay(games_played: int) -> float:
    """
    Glicko-inspired: early games count more (high uncertainty), later games less.
    Decays from 1.0 toward CONFIDENCE_FLOOR over CONFIDENCE_GAMES.
    """
    t = min(games_played, CONFIDENCE_GAMES) / CONFIDENCE_GAMES
    return 1.0 - t * (1.0 - CONFIDENCE_FLOOR)


def compute_k(
    games_played: int,
    gold_diff: int,
    phase_wins_winner: int,
    is_playoffs: bool = False,
) -> float:
    stage = STAGE_FACTOR_PLAYOFFS if is_playoffs else STAGE_FACTOR_REGULAR
    dominance = _dominance_factor(gold_diff, phase_wins_winner)
    decay = _confidence_decay(games_played)
    k = BASE_K * stage * dominance * decay
    return max(MIN_K, k)


# ── ELO Update ────────────────────────────────────────────────────────────────

def update_elo(
    winner_elo: float,
    loser_elo: float,
    winner_games_played: int,
    loser_games_played: int,
    gold_diff: int,
    phase_wins_winner: int,
    is_playoffs: bool = False,
) -> tuple[float, float]:
    """
    Compute updated ELOs for winner and loser after a match.

    Returns:
        (new_winner_elo, new_loser_elo)
    """
    expected_winner = _expected_score(winner_elo, loser_elo)
    expected_loser  = 1.0 - expected_winner

    k_winner = compute_k(winner_games_played, gold_diff, phase_wins_winner, is_playoffs)
    k_loser  = compute_k(loser_games_played,  gold_diff, 3 - phase_wins_winner, is_playoffs)

    new_winner = winner_elo + k_winner * (1.0 - expected_winner)
    new_loser  = loser_elo  + k_loser  * (0.0 - expected_loser)

    return round(new_winner, 1), round(new_loser, 1)


# ── Win Probability ───────────────────────────────────────────────────────────

def win_probability(team_elo: float, opponent_elo: float) -> float:
    """Return the probability [0, 1] that team wins against opponent based on ELO."""
    return _expected_score(team_elo, opponent_elo)


def elo_power_modifier(team_elo: float, league_avg_elo: float = ELO_CENTER) -> float:
    """
    Convert ELO delta vs league average into a power modifier for simulate_match_phases.

    Range: approximately -8 to +8 added to team power.
    At ELO 1200 (130 above average 1070): +4.2 modifier
    At ELO 900  (170 below average 1070): -5.5 modifier

    Formula keeps the modifier bounded so ELO alone can't overcome a massive
    skill gap — it supplements, not replaces, the player-attribute power calc.
    """
    delta = team_elo - league_avg_elo
    # Soft-clip: full benefit in ±200 range, diminishing returns beyond
    modifier = math.copysign(min(abs(delta) / 25.0, 8.0), delta)
    return round(modifier, 2)


# ── Team ELO State Helpers ────────────────────────────────────────────────────

def ensure_team_elo(team: dict) -> float:
    """Return team ELO, initializing from team.rating if not yet set."""
    if "elo" not in team:
        team["elo"] = initial_elo(team.get("rating", 80))
        team["elo_games"] = 0
    return team["elo"]


def get_league_avg_elo(teams: dict) -> float:
    """Compute mean ELO across all teams in the active league."""
    elos = [t.get("elo", initial_elo(t.get("rating", 80))) for t in teams.values()]
    return sum(elos) / max(len(elos), 1) if elos else ELO_CENTER


def apply_match_elo(
    winner_team: dict,
    loser_team: dict,
    gold_diff: int,
    phase_wins_winner: int,
    is_playoffs: bool = False,
) -> dict:
    """
    Update ELO on winner and loser team dicts in-place.

    Returns a summary dict with ELO changes for logging/display.
    """
    w_elo = ensure_team_elo(winner_team)
    l_elo = ensure_team_elo(loser_team)

    w_games = winner_team.get("elo_games", 0)
    l_games = loser_team.get("elo_games", 0)

    new_w, new_l = update_elo(
        w_elo, l_elo, w_games, l_games,
        gold_diff, phase_wins_winner, is_playoffs
    )

    delta_w = round(new_w - w_elo, 1)
    delta_l = round(new_l - l_elo, 1)

    winner_team["elo"] = new_w
    loser_team["elo"]  = new_l
    winner_team["elo_games"] = w_games + 1
    loser_team["elo_games"]  = l_games + 1

    return {
        "winner_elo_before": w_elo,
        "winner_elo_after":  new_w,
        "winner_delta":      delta_w,
        "loser_elo_before":  l_elo,
        "loser_elo_after":   new_l,
        "loser_delta":       delta_l,
    }
