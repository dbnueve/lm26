"""International tournament logic (MSI & Worlds).

Pure helper functions that do NOT access GAME_STATE directly.
`_intl_pick_top_n` and `_get_playoff_top_n` stay in server.py because
they require GAME_STATE and LEAGUES_DATA.
"""

import random

from simulation import simulate_match_phases


# ── Shared helpers ────────────────────────────────────────────────────────────

def intl_make_match(mid: str, round_name: str, best_of: int = 5,
                    t1=None, t2=None) -> dict:
    return {
        "id": mid, "round": round_name, "best_of": best_of,
        "team1": t1, "team2": t2,
        "winner_id": None, "score1": 0, "score2": 0, "games": [],
        "locked": t1 is None or t2 is None,
    }


def intl_set_slot(match: dict, slot: int, team: dict) -> None:
    match["team1" if slot == 1 else "team2"] = team
    if match["team1"] is not None and match["team2"] is not None:
        match["locked"] = False


def intl_sim(t1: dict, t2: dict, best_of: int,
             t1_boost: float = 0, t2_boost: float = 0,
             start_score: tuple[int, int] = (0, 0),
             prev_games: list = None) -> dict:
    """Simulate a full BO (or finish a partial one) until one team reaches wins_needed."""
    wn = (best_of + 1) // 2
    w1, w2 = start_score
    games = list(prev_games or [])
    t1_form = random.gauss(0, 3.0)
    t2_form = random.gauss(0, 3.0)
    t1_power = max(30, min(100, t1["rating"] + t1_boost + t1_form))
    t2_power = max(30, min(100, t2["rating"] + t2_boost + t2_form))
    while w1 < wn and w2 < wn:
        r = simulate_match_phases(t1_power, t2_power)
        if r["winner"] == 1:
            w1 += 1
        else:
            w2 += 1
        games.append({
            "winner": t1["id"] if r["winner"] == 1 else t2["id"],
            "duration": r["duration"],
        })
    return {"winner_id": t1["id"] if w1 > w2 else t2["id"],
            "score1": w1, "score2": w2, "games": games}


def intl_sim_one_game(t1: dict, t2: dict,
                      t1_boost: float = 0, t2_boost: float = 0) -> dict:
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


def intl_apply_one_game(m: dict, game: dict) -> dict:
    """Append a game to a match, update score1/score2, and return a status dict."""
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


# ── MSI ───────────────────────────────────────────────────────────────────────

def create_msi(pick_top_n_fn, user_league: str, user_champ_id) -> dict:
    """Create a fresh MSI tournament structure.

    `pick_top_n_fn(league, n)` must return a list of team dicts — injected
    by server.py so this module stays free of GAME_STATE.
    """
    s = {lg: pick_top_n_fn(lg, 2) for lg in ["LCK", "LPL", "LEC", "LCS", "CBLOL"]}
    pi_teams    = [s["LEC"][1], s["LPL"][1], s["LCS"][1], s["CBLOL"][1]]
    bracket_pre = [s["LCK"][0], s["LCK"][1], s["LPL"][0],
                   s["LEC"][0], s["LCS"][0], s["CBLOL"][0]]
    pi_ms = {
        "pi_ub1": intl_make_match("pi_ub1", "Play-In · UB R1",    5, pi_teams[0], pi_teams[1]),
        "pi_ub2": intl_make_match("pi_ub2", "Play-In · UB R1",    5, pi_teams[2], pi_teams[3]),
        "pi_ubf": intl_make_match("pi_ubf", "Play-In · UB Final", 5),
        "pi_lb1": intl_make_match("pi_lb1", "Play-In · LB R1",    5),
        "pi_lbf": intl_make_match("pi_lbf", "Play-In · LB Final", 5),
    }
    return {
        "type": "msi", "name": "MSI", "stage": "play_in",
        "completed": False, "winner": None,
        "user_league": user_league, "user_champ_id": user_champ_id,
        "play_in":  {"teams": pi_teams, "matches": pi_ms,
                     "qualified": [], "completed": False},
        "bracket":  {"pre_seeded": bracket_pre, "teams": None,
                     "matches": {}, "winner": None, "completed": False},
    }


MSI_BRACKET_FLOW: dict = {
    "ub1_1": {"w": ("ub2_1", 1), "l": ("lb1_1", 1)},
    "ub1_2": {"w": ("ub2_1", 2), "l": ("lb1_2", 1)},
    "ub1_3": {"w": ("ub2_2", 1), "l": ("lb1_1", 2)},
    "ub1_4": {"w": ("ub2_2", 2), "l": ("lb1_2", 2)},
    "ub2_1": {"w": ("ubf",   1), "l": ("lb2_1", 2)},
    "ub2_2": {"w": ("ubf",   2), "l": ("lb2_2", 2)},
    "ubf":   {"w": ("gf",    1), "l": ("lbf",   2)},
    "lb1_1": {"w": ("lb2_1", 1), "l": None},
    "lb1_2": {"w": ("lb2_2", 1), "l": None},
    "lb2_1": {"w": ("lb3",   1), "l": None},
    "lb2_2": {"w": ("lb3",   2), "l": None},
    "lb3":   {"w": ("lbf",   1), "l": None},
    "lbf":   {"w": ("gf",    2), "l": None},
    "gf":    {"w": None, "l": None},
}

_MSI_ROUND_LABELS: dict = {
    "ub1_1": "Bracket · UB R1", "ub1_2": "Bracket · UB R1",
    "ub1_3": "Bracket · UB R1", "ub1_4": "Bracket · UB R1",
    "ub2_1": "Bracket · UB Semifinal", "ub2_2": "Bracket · UB Semifinal",
    "ubf":   "Bracket · UB Final",
    "lb1_1": "Bracket · LB R1", "lb1_2": "Bracket · LB R1",
    "lb2_1": "Bracket · LB Quarterfinal", "lb2_2": "Bracket · LB Quarterfinal",
    "lb3":   "Bracket · LB Semifinal",
    "lbf":   "Bracket · LB Final",
    "gf":    "Bracket · Grand Final",
}


def msi_setup_bracket(msi: dict, teams: list) -> None:
    t = sorted(teams, key=lambda x: x.get("rating", 0), reverse=True)
    bm = msi["bracket"]["matches"]
    bm["ub1_1"] = intl_make_match("ub1_1", _MSI_ROUND_LABELS["ub1_1"], 5, t[0], t[7])
    bm["ub1_2"] = intl_make_match("ub1_2", _MSI_ROUND_LABELS["ub1_2"], 5, t[3], t[4])
    bm["ub1_3"] = intl_make_match("ub1_3", _MSI_ROUND_LABELS["ub1_3"], 5, t[2], t[5])
    bm["ub1_4"] = intl_make_match("ub1_4", _MSI_ROUND_LABELS["ub1_4"], 5, t[1], t[6])
    for mid in ["ub2_1", "ub2_2", "ubf", "lb1_1", "lb1_2",
                "lb2_1", "lb2_2", "lb3", "lbf", "gf"]:
        bm[mid] = intl_make_match(mid, _MSI_ROUND_LABELS[mid], 5)
    msi["bracket"]["teams"] = t


def msi_update_play_in(msi: dict, mid: str, res: dict) -> None:
    pi = msi["play_in"]
    ms = pi["matches"]
    m  = ms[mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"],
             score2=res["score2"], games=res["games"])
    w = m["team1"] if res["winner_id"] == m["team1"]["id"] else m["team2"]
    l = m["team2"] if res["winner_id"] == m["team1"]["id"] else m["team1"]
    if mid == "pi_ub1":
        intl_set_slot(ms["pi_ubf"], 1, w); intl_set_slot(ms["pi_lb1"], 1, l)
    elif mid == "pi_ub2":
        intl_set_slot(ms["pi_ubf"], 2, w); intl_set_slot(ms["pi_lb1"], 2, l)
    elif mid == "pi_ubf":
        pi["qualified"].append(w["id"]); intl_set_slot(ms["pi_lbf"], 1, l)
    elif mid == "pi_lb1":
        intl_set_slot(ms["pi_lbf"], 2, w)
    elif mid == "pi_lbf":
        pi["qualified"].append(w["id"])
        pi["completed"] = True
        q_teams = [t for t in pi["teams"] if t["id"] in pi["qualified"]]
        msi_setup_bracket(msi, msi["bracket"]["pre_seeded"] + q_teams)
        msi["stage"] = "bracket"


def msi_update_bracket(msi: dict, mid: str, res: dict) -> None:
    bm = msi["bracket"]["matches"]
    m  = bm[mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"],
             score2=res["score2"], games=res["games"])
    w    = m["team1"] if res["winner_id"] == m["team1"]["id"] else m["team2"]
    l    = m["team2"] if res["winner_id"] == m["team1"]["id"] else m["team1"]
    flow = MSI_BRACKET_FLOW.get(mid, {})
    if flow.get("w"):
        intl_set_slot(bm[flow["w"][0]], flow["w"][1], w)
    else:
        msi["bracket"]["winner"]    = w["id"]
        msi["bracket"]["completed"] = True
        msi.update(completed=True, winner=w["id"], stage="completed")
    if flow.get("l"):
        intl_set_slot(bm[flow["l"][0]], flow["l"][1], l)


# ── Worlds ────────────────────────────────────────────────────────────────────

def create_worlds(pick_top_n_fn, user_league: str, user_champ_id) -> dict:
    """Create a fresh Worlds tournament structure.

    `pick_top_n_fn(league, n)` must return a list of team dicts.
    """
    s = {
        "LCK":   pick_top_n_fn("LCK",   4),
        "LPL":   pick_top_n_fn("LPL",   4),
        "LCS":   pick_top_n_fn("LCS",   3),
        "LEC":   pick_top_n_fn("LEC",   3),
        "CBLOL": pick_top_n_fn("CBLOL", 3),
    }
    pi_teams  = [s["LCS"][2], s["CBLOL"][2]]
    pre_swiss = (s["LCK"] + s["LPL"] + s["LCS"][:2]
                 + s["LEC"] + s["CBLOL"][:2])  # 4+4+2+3+2 = 15
    return {
        "type": "worlds", "name": "Worlds", "stage": "play_in",
        "completed": False, "winner": None,
        "user_league": user_league, "user_champ_id": user_champ_id,
        "play_in": {
            "teams": pi_teams,
            "match": intl_make_match("pi_main", "Play-In", 5, pi_teams[0], pi_teams[1]),
            "qualified": None, "completed": False,
        },
        "swiss": {
            "pre_qualified": pre_swiss, "teams": None,
            "rounds": [], "current_round": 0,
            "advanced": [], "eliminated": [], "completed": False,
        },
        "knockout": {"teams": None, "matches": {}, "winner": None, "completed": False},
    }


def intl_pair_no_rematch(teams: list) -> list:
    by_id = {t["id"]: t for t in teams}
    rem   = [t["id"] for t in teams]
    pairs = []
    while len(rem) >= 2:
        t1_id = rem.pop(0)
        t1    = by_id[t1_id]
        opp   = next((oid for oid in rem
                      if oid not in t1.get("sw_opponents", [])), rem[0])
        rem.remove(opp)
        pairs.append((t1, by_id[opp]))
    return pairs


def worlds_gen_swiss_round(worlds: dict) -> None:
    sw = worlds["swiss"]
    active = [t for t in sw["teams"]
              if not t["sw_advanced"] and not t["sw_eliminated"]]
    if not active:
        sw["completed"] = True
        worlds_start_knockout(worlds)
        return
    rnum = sw["current_round"] + 1
    sw["current_round"] = rnum
    groups: dict = {}
    for t in active:
        groups.setdefault((t["sw_wins"], t["sw_losses"]), []).append(t)
    ordered: list = []
    for key in sorted(groups):
        grp = groups[key]
        random.shuffle(grp)
        ordered.extend(grp)
    pairs = intl_pair_no_rematch(ordered)
    rnd_ms: dict = {}
    for i, (t1, t2) in enumerate(pairs):
        t1.setdefault("sw_opponents", []).append(t2["id"])
        t2.setdefault("sw_opponents", []).append(t1["id"])
        bo = (3 if (t1["sw_wins"] == 2 and t2["sw_wins"] == 2)
              or (t1["sw_losses"] == 2 and t2["sw_losses"] == 2)
              else 1)
        mid = f"sw_r{rnum}_m{i+1}"
        rnd_ms[mid] = intl_make_match(mid, f"Swiss · Round {rnum}", bo, t1, t2)
    sw["rounds"].append({"round": rnum, "matches": rnd_ms, "completed": False})


def worlds_update_swiss(worlds: dict, mid: str, res: dict) -> None:
    sw  = worlds["swiss"]
    cur = sw["rounds"][-1]
    m   = cur["matches"][mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"],
             score2=res["score2"], games=res["games"])
    loser_id = (m["team1"]["id"] if res["winner_id"] == m["team2"]["id"]
                else m["team2"]["id"])
    for t in sw["teams"]:
        if t["id"] == res["winner_id"]:
            t["sw_wins"] += 1
            if t["sw_wins"] >= 3 and not t["sw_advanced"]:
                t["sw_advanced"] = True
                sw["advanced"].append(t["id"])
        elif t["id"] == loser_id:
            t["sw_losses"] += 1
            if t["sw_losses"] >= 3 and not t["sw_eliminated"]:
                t["sw_eliminated"] = True
                sw["eliminated"].append(t["id"])
    if all(m2["winner_id"] for m2 in cur["matches"].values()):
        cur["completed"] = True
        active = [t for t in sw["teams"]
                  if not t["sw_advanced"] and not t["sw_eliminated"]]
        if len(sw["advanced"]) >= 8 or sw["current_round"] >= 5 or not active:
            while len(sw["advanced"]) < 8 and active:
                best = sorted(active,
                              key=lambda t2: (-t2["sw_wins"], t2["sw_losses"]))[0]
                best["sw_advanced"] = True
                sw["advanced"].append(best["id"])
                active = [t for t in active if not t["sw_advanced"]]
            sw["completed"] = True
            worlds_start_knockout(worlds)
        else:
            worlds_gen_swiss_round(worlds)


def worlds_start_knockout(worlds: dict) -> None:
    sw   = worlds["swiss"]
    by_id = {t["id"]: t for t in sw["teams"]}
    adv  = sorted([by_id[tid] for tid in sw["advanced"][:8]],
                  key=lambda t: (-t["sw_wins"], t["sw_losses"]))
    worlds["knockout"]["teams"] = adv
    s  = adv
    km = worlds["knockout"]["matches"]
    km["qf1"] = intl_make_match("qf1", "Knockout · Quart de finale", 5, s[0], s[7])
    km["qf2"] = intl_make_match("qf2", "Knockout · Quart de finale", 5, s[3], s[4])
    km["qf3"] = intl_make_match("qf3", "Knockout · Quart de finale", 5, s[2], s[5])
    km["qf4"] = intl_make_match("qf4", "Knockout · Quart de finale", 5, s[1], s[6])
    km["sf1"] = intl_make_match("sf1", "Knockout · Demi-finale", 5)
    km["sf2"] = intl_make_match("sf2", "Knockout · Demi-finale", 5)
    km["gf"]  = intl_make_match("gf",  "Knockout · Grande Finale", 5)
    worlds["stage"] = "knockout"


WORLDS_KO_FLOW: dict = {
    "qf1": {"w": ("sf1", 1)}, "qf2": {"w": ("sf1", 2)},
    "qf3": {"w": ("sf2", 1)}, "qf4": {"w": ("sf2", 2)},
    "sf1": {"w": ("gf",  1)}, "sf2": {"w": ("gf",  2)},
    "gf":  {},
}


def worlds_update_knockout(worlds: dict, mid: str, res: dict) -> None:
    km = worlds["knockout"]["matches"]
    m  = km[mid]
    m.update(winner_id=res["winner_id"], score1=res["score1"],
             score2=res["score2"], games=res["games"])
    w    = m["team1"] if res["winner_id"] == m["team1"]["id"] else m["team2"]
    flow = WORLDS_KO_FLOW.get(mid, {})
    if flow.get("w"):
        intl_set_slot(km[flow["w"][0]], flow["w"][1], w)
    else:
        worlds["knockout"].update(winner=w["id"], completed=True)
        worlds.update(completed=True, winner=w["id"], stage="completed")
