"""Match simulation: pure functions with no direct GAME_STATE access.

Functions that need team/player data receive it via arguments.
"""
import math
import random
from typing import Optional


def simulate_match_phases(team1_power: float, team2_power: float) -> dict:
    """Granular 3-phase simulation returning winner, duration, phases and events."""
    phases = []
    events = []

    def win_prob(p1, p2, noise_scale=8):
        diff = p1 - p2 + random.gauss(0, noise_scale)
        return 1 / (1 + math.exp(-diff / 12))

    # ── EARLY GAME ──────────────────────────────────────────────────────────
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

    # ── MID GAME ─────────────────────────────────────────────────────────────
    egpm_mod = min(gold_early / 800.0, 5.0)
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
    if mid_win == 1:
        drakes_1 = random.randint(2, 4)
        drakes_2 = random.randint(0, min(3, max(0, 4 - (drakes_1 - 2))))
    else:
        drakes_2 = random.randint(2, 4)
        drakes_1 = random.randint(0, min(3, max(0, 4 - (drakes_2 - 2))))

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

    # ── LATE GAME ────────────────────────────────────────────────────────────
    egpm_late_mod = min(gold_mid / 3000.0, 3.0)
    momentum_late = 3 if mid_win == 1 else -3
    if mid_win == 1:
        late_p1 = mid_p1 + momentum_late + egpm_late_mod * 0.4 + random.gauss(0, 2)
        late_p2 = mid_p2 - momentum_late - egpm_late_mod * 0.2 + random.gauss(0, 2)
    else:
        late_p1 = mid_p1 + momentum_late - egpm_late_mod * 0.2 + random.gauss(0, 2)
        late_p2 = mid_p2 - momentum_late + egpm_late_mod * 0.4 + random.gauss(0, 2)

    if mid_win == 1:
        late_p2 += random.uniform(0, 5)
    else:
        late_p1 += random.uniform(0, 5)

    final_win = 1 if random.random() < win_prob(late_p1, late_p2, noise_scale=6) else 2

    same_phase_winner = (early_win == mid_win)
    game_duration = random.randint(24, 34) if same_phase_winner else random.randint(30, 44)

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
        "phase_wins": {
            1: sum(1 for ph in phases if ph["advantage"] == 1),
            2: sum(1 for ph in phases if ph["advantage"] == 2),
        },
    }


def generate_kill_totals(duration: int, team1_won: bool) -> tuple[int, int]:
    """Return (team1_kills, team2_kills) coherent with competitive rates."""
    total = max(10, int(duration * random.uniform(0.75, 1.3)))
    winner_share = random.uniform(0.55, 0.72)
    w_kills = max(4, round(total * winner_share))
    l_kills = max(2, total - w_kills)
    return (w_kills, l_kills) if team1_won else (l_kills, w_kills)


def generate_detailed_events(
    phases: list,
    team1_stats: list,
    team2_stats: list,
    duration: int,
    winner: int,
    base_events: list,
) -> tuple[list, list]:
    """Build chronological event timeline + per-minute gold snapshots.

    Returns (events, gold_timeline).
    """
    events: list[dict] = []

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
            desc = (
                f"First Blood ! {k_name} ({k_champ}) élimine {v_name}"
                + (f" ({v_champ})" if v_champ else "")
                if v_name
                else f"First Blood pour {k_name} ({k_champ}) !"
            )
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

    latest_allowed = max(60, end_sec - 20)
    latest_min = latest_allowed / 60.0
    total_kills_game = sum(_sum_budget(kills_budget[t]) for t in (1, 2))

    # First blood
    add_kill(fb_min_f, fb_team, "first_blood")

    last_drake_min: float = 0.0
    if phases:
        ph1 = phases[0]
        if ph1.get("first_tower") in (1, 2):
            add_obj(random.uniform(8, 13.5), ph1["first_tower"], "first_tower", "Première tour détruite")
        if ph1.get("first_drake") in (1, 2):
            drake_min = random.uniform(5.0, 9.5)
            add_obj(drake_min, ph1["first_drake"], "drake", "Premier Drake sécurisé")
            last_drake_min = drake_min

    early_kill_start = fb_min_f + 0.1
    remaining = sum(_sum_budget(kills_budget[t]) for t in (1, 2))
    early_target = max(0, int(round(total_kills_game * 0.22)) - 1)
    for _ in range(min(early_target, remaining)):
        t1_left = _sum_budget(kills_budget[1])
        t2_left = _sum_budget(kills_budget[2])
        if t1_left + t2_left == 0:
            break
        t = random.choices([1, 2], weights=[max(1, t1_left), max(1, t2_left)])[0]
        if _sum_budget(kills_budget[t]) == 0:
            t = 3 - t
        add_kill(random.uniform(early_kill_start, 13.8), t, "kill")

    if len(phases) >= 2:
        ph2 = phases[1]
        if ph2.get("rift_herald") in (1, 2):
            add_obj(random.uniform(9, 13), ph2["rift_herald"], "herald", "Rift Herald capturé")
        towers = ph2.get("towers_destroyed") or {}
        for tn in (1, 2):
            n = towers.get(tn) or towers.get(str(tn)) or 0
            for _ in range(int(n)):
                add_obj(random.uniform(14, 24.6), tn, "tower", "Tour détruite")

        DRAKE_MIN_GAP = 5.0
        drakes = ph2.get("drakes") or {}
        drake_entries: list[tuple[int, int]] = []
        for tn in (1, 2):
            n = drakes.get(tn) or drakes.get(str(tn)) or 0
            for i in range(int(n)):
                drake_entries.append((tn, i))
        random.shuffle(drake_entries)
        for tn_d, _ in drake_entries:
            earliest = max(last_drake_min + DRAKE_MIN_GAP, 12.0)
            latest = 24.5
            if earliest >= latest:
                earliest = latest - 0.5
            drake_min = random.uniform(earliest, latest)
            add_obj(drake_min, tn_d, "drake", "Drake sécurisé")
            last_drake_min = drake_min

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

    if len(phases) >= 3:
        ph3 = phases[2]
        if ph3.get("baron") in (1, 2):
            add_obj(random.uniform(25, max(26, min(duration - 2, 38))), ph3["baron"], "baron", "Baron Nashor !")
        if ph3.get("elder_drake") in (1, 2):
            add_obj(
                random.uniform(max(32, duration - 8), max(32, duration - 2)),
                ph3["elder_drake"], "elder", "Elder Dragon !",
            )
        inhibs = ph3.get("inhibitors_destroyed") or {}
        for tn in (1, 2):
            n = inhibs.get(tn) or inhibs.get(str(tn)) or 0
            for _ in range(int(n)):
                add_obj(random.uniform(28, max(29, duration - 1)), tn, "inhibitor", "Inhibiteur détruit")

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

    events.sort(key=lambda e: e["_sec"])
    for e in events:
        if e["_sec"] > latest_allowed:
            e["_sec"] = latest_allowed
            e["time"] = f"{latest_allowed // 60}:{latest_allowed % 60:02d}"

    # Multi-kill promotion
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
            if len(streak_idx) >= 2:
                n = min(len(streak_idx), 5)
                label = {2: "double_kill", 3: "triple_kill", 4: "quadra_kill", 5: "penta_kill"}[n]
                last_ev = events[streak_idx[-1]]
                last_ev["type"] = label
                k_name = last_ev.get("killer") or ""
                k_champ = last_ev.get("killer_champion") or ""
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
                    "penta_kill": "PENTAKILL",
                }[label]
                bang = "!!!" if label == "penta_kill" else ("!!" if label == "quadra_kill" else "!")
                last_ev["description"] = f"{prefix} — {k_name} ({k_champ}){killed_suffix}{bang}"
            i = (streak_idx[-1] if streak_idx else i) + 1
        else:
            i += 1

    events.append({
        "time": f"{end_sec // 60}:{end_sec % 60:02d}",
        "_sec": end_sec,
        "type": "game_end",
        "team": winner,
        "description": "Nexus détruit — fin de la partie !",
    })
    events.sort(key=lambda e: e["_sec"])
    for e in events:
        e.pop("_sec", None)

    # Gold timeline
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
        g1 += random.randint(-250, 250)
        g2 += random.randint(-250, 250)
        gold_timeline.append({"minute": m, "g1": max(0, g1), "g2": max(0, g2)})

    return events, gold_timeline


def _player_performance_score(player_stats: dict, won: bool, game_duration: float) -> float:
    kills = player_stats.get("kills", 0)
    deaths = player_stats.get("deaths", 0)
    assists = player_stats.get("assists", 0)
    cs = player_stats.get("cs", 0)
    pos = player_stats.get("position", "")

    kda = (kills + assists * 0.7) / max(1, deaths)
    kda_score = min(kda / 5.0, 1.0) * 40

    cs_per_min = cs / max(1, game_duration)
    if pos == "SUPPORT":
        cs_score = min(cs_per_min / 1.5, 1.0) * 10
    else:
        cs_score = min(cs_per_min / 9.0, 1.0) * 30

    win_bonus = 20 if won else 0
    vision = player_stats.get("vision_score", 30)
    vision_score = min(vision / 100.0, 1.0) * 10

    return round(kda_score + cs_score + win_bonus + vision_score, 1)


def generate_player_stats(
    team_data: dict,
    players_data: dict,
    team_id: str,
    won: bool,
    game_duration: int,
    team_kills: int,
    opp_kills: int,
    get_meta_champions_fn,
    draft_picks: list = None,
    excluded: set = None,
) -> list:
    """Generate realistic post-game stats for a team.

    Accepts team_data and players_data dicts instead of reading GAME_STATE directly,
    and get_meta_champions_fn as a callable to avoid circular dependency.
    """
    positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]

    team = team_data.get(team_id, {})
    roster = team.get("roster", [])

    player_by_position: dict[str, dict] = {}
    for player_id in roster:
        player = players_data.get(player_id, {})
        if player:
            pos = player.get("position", "")
            player_by_position[pos] = {
                "name": player.get("name", f"Player ({pos})"),
                "pool": player.get("champion_pool", []),
            }

    picks_by_position: dict[str, str] = {}
    if draft_picks:
        for pick in draft_picks:
            champ = pick.get("champion") if isinstance(pick, dict) else None
            pos = pick.get("position") if isinstance(pick, dict) else None
            if champ and pos:
                picks_by_position[pos] = champ

    used_champs: set[str] = set(picks_by_position.values()) | (excluded or set())

    kill_w = {"TOP": 0.18, "JUNGLE": 0.18, "MID": 0.24, "ADC": 0.28, "SUPPORT": 0.12}
    death_w = {"TOP": 0.22, "JUNGLE": 0.20, "MID": 0.15, "ADC": 0.15, "SUPPORT": 0.28}
    assist_w = {"TOP": 0.16, "JUNGLE": 0.22, "MID": 0.18, "ADC": 0.12, "SUPPORT": 0.32}

    def distribute(total, weights):
        result = {p: 0 for p in positions}
        for _ in range(max(0, total)):
            chosen = random.choices(positions, weights=[weights[p] for p in positions])[0]
            result[chosen] += 1
        return result

    total_assists = int(team_kills * random.uniform(2.0, 2.8))
    kills_by_pos = distribute(team_kills, kill_w)
    deaths_by_pos = distribute(opp_kills, death_w)
    assists_by_pos = distribute(total_assists, assist_w)

    meta_champions = get_meta_champions_fn()
    stats = []
    for pos in positions:
        kills = kills_by_pos[pos]
        deaths = deaths_by_pos[pos]
        assists = assists_by_pos[pos]

        if pos == "SUPPORT":
            cs = int(game_duration * random.uniform(0, 1.5))
        elif pos == "JUNGLE":
            cs = int(game_duration * random.uniform(6, 9))
        else:
            cs = int(game_duration * random.uniform(7.5, 10.5))

        info = player_by_position.get(pos, {"name": f"Player ({pos})", "pool": []})
        player_name = info["name"]

        champion = picks_by_position.get(pos)
        if not champion:
            pool = [c for c in info["pool"] if c not in used_champs]
            if not pool:
                meta_pool = [
                    c["name"] for c in meta_champions.get(pos, [])[:10]
                    if c["name"] not in used_champs
                ]
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
