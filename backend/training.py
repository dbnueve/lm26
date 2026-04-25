"""Training system: config, execution, and plan management."""
from app_state import GAME_STATE

TRAINING_CONFIG = {
    "scrims": {
        "fatigue": +10, "moral": -3,
        "form_bonus": 2,
        "dev": {"mechanics": 2, "teamwork": 1},
        "cost": 50000,
        "label": "Scrims",
    },
    "vod_review": {
        "fatigue": +4, "moral": +3,
        "form_bonus": 1,
        "dev": {"game_sense": 3, "consistency": 1},
        "cost": 20000,
        "label": "VOD Review",
    },
    "bootcamp": {
        "fatigue": +18, "moral": -8,
        "form_bonus": 3,
        "dev": {"mechanics": 2, "game_sense": 2},
        "cost": 100000,
        "label": "Bootcamp",
    },
    "rest": {
        "fatigue": -25, "moral": +12,
        "form_bonus": 1,
        "dev": {},
        "cost": 0,
        "label": "Repos",
    },
}

DEV_XP_THRESHOLD = 10
MAX_TRAINING_GAIN_PER_SPLIT = 2.0


def _apply_training_effects(player: dict, cfg: dict) -> dict:
    """Apply fatigue, moral, form_bonus and dev_xp from a training config. Returns stat_gains."""
    player["fatigue"] = max(0, min(100, player.get("fatigue", 30) + cfg["fatigue"]))
    player["moral"] = max(0, min(100, player.get("moral", 75) + cfg["moral"]))
    player["form_bonus"] = min(6, player.get("form_bonus", 0) + cfg["form_bonus"])

    stat_gains = {}
    for stat, xp_gain in cfg["dev"].items():
        xp_key = f"dev_xp_{stat}"
        player[xp_key] = player.get(xp_key, 0) + xp_gain
        while player[xp_key] >= DEV_XP_THRESHOLD:
            player[xp_key] -= DEV_XP_THRESHOLD
            gain_key = f"training_gain_{stat}"
            total_gain = player.get(gain_key, 0.0)
            if total_gain < MAX_TRAINING_GAIN_PER_SPLIT:
                actual = min(0.3, MAX_TRAINING_GAIN_PER_SPLIT - total_gain)
                pot_cap = int(player.get("potential", 90) * 0.95)
                player["rating"] = min(pot_cap, player.get("rating", 75) + 1)
                player[gain_key] = round(total_gain + actual, 2)
                stat_gains[stat] = round(actual, 2)
    return stat_gains


def execute_training_apply(player: dict, training_type: str) -> dict:
    """Apply a one-off training session. Returns result dict (no save_state)."""
    cfg = TRAINING_CONFIG.get(training_type)
    if not cfg:
        return {"error": "Type d'entraînement inconnu"}

    stat_gains = _apply_training_effects(player, cfg)
    player["training_done_this_week"] = True

    return {
        "success": True,
        "player": player,
        "form_bonus_added": cfg["form_bonus"],
        "stat_gains": stat_gains,
        "effects_summary": {
            "fatigue": cfg["fatigue"],
            "moral": cfg["moral"],
            "form_bonus": cfg["form_bonus"],
        },
    }


def execute_training_plan(player: dict, team: dict) -> str | None:
    """Auto-apply a player's training_plan. Returns the plan actually applied, or None."""
    plan = player.get("training_plan")
    if not plan or player.get("training_done_this_week"):
        return None

    cfg = TRAINING_CONFIG.get(plan)
    if not cfg:
        return None

    cost = cfg["cost"]
    applied_plan = plan
    if cost > 0:
        user_team = GAME_STATE["teams"].get(GAME_STATE.get("user_team", ""), {})
        if user_team.get("budget", 0) < cost:
            cfg = TRAINING_CONFIG["rest"]
            cost = 0
            applied_plan = "rest"
        else:
            user_team["budget"] = user_team["budget"] - cost

    _apply_training_effects(player, cfg)
    player["training_done_this_week"] = True
    return applied_plan
