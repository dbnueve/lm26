"""Tactics system: constants, evaluation, and modifier calculation."""
from app_state import GAME_STATE

DEFAULT_TACTICS = {
    "strong_side":    "bot",
    "game_timing":    "mid",
    "jungle_style":   "ganker",
    "jungle_pathing": "top_to_bot",
    "lanes": {
        "TOP":     {"lane_style": "economy",       "tp_usage": "safety"},
        "MID":     {"lane_style": "lane_priority", "tp_usage": "objectives"},
        "ADC":     {"lane_style": "economy"},
        "SUPPORT": {"roaming": "play_lane"},
    },
}

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
    if "tactics" not in GAME_STATE or not GAME_STATE["tactics"]:
        GAME_STATE["tactics"] = {
            **DEFAULT_TACTICS,
            "lanes": {k: {**v} for k, v in DEFAULT_TACTICS["lanes"].items()},
        }
    return GAME_STATE["tactics"]


def evaluate_coherence(tactics: dict) -> dict:
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
    coherence = evaluate_coherence(tactics)
    raw = coherence["net"]
    return max(-3.0, min(3.0, raw * 1.5))
