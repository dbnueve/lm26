"""Inbox system: message creation and match/weekly narrative generation."""
import random
import uuid
from app_state import GAME_STATE


def add_inbox_message(msg_type: str, sender: str, subject: str, body: str, week: int = None) -> dict:
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
    user_id = GAME_STATE.get("user_team")
    played = sorted(
        [m for m in GAME_STATE.get("schedule", [])
         if m.get("played") and (m["team1"] == user_id or m["team2"] == user_id)],
        key=lambda m: m.get("week", 0),
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
    if not stats:
        return None
    best = max(
        stats,
        key=lambda p: (p.get("kills", 0) + p.get("assists", 0)) / max(p.get("deaths", 1), 1),
    )
    return best.get("name") or best.get("player")


def generate_match_inbox_messages(
    winner_id: str,
    loser_id: str,
    match_result: dict,
    w_stats: list = None,
    l_stats: list = None,
    week: int = None,
):
    """Generate board + soloq inbox messages after the user plays a match."""
    user_id = GAME_STATE.get("user_team")
    if not user_id:
        return
    user_won = winner_id == user_id
    opp_id = loser_id if user_won else winner_id
    opp_team = GAME_STATE["teams"].get(opp_id, {})
    opp_name = opp_team.get("name", "l'adversaire")
    opp_abbr = opp_team.get("abbr", opp_name[:3].upper())
    user_team_obj = GAME_STATE["teams"].get(user_id, {})
    wins = user_team_obj.get("wins", 0)
    losses = user_team_obj.get("losses", 0)
    week_num = week or GAME_STATE.get("current_week", 0)
    duration = match_result.get("duration", 30)
    phases = match_result.get("phases", [])
    gold_diff = abs(phases[-1].get("gold_diff", 0)) if phases else 0

    streak_type, streak_count = _get_user_streak()
    user_mvp = _get_mvp_name(w_stats if user_won else l_stats)
    mvp_mention = f" {user_mvp} a été exceptionnel." if user_mvp else ""

    if user_won and streak_count >= 3:
        streak_note = f" {streak_count} victoires consécutives — l'élan est indéniable."
    elif not user_won and streak_count >= 3:
        streak_note = f" {streak_count} défaites de suite — la situation est préoccupante."
    else:
        streak_note = ""

    total = wins + losses
    wr = round(wins / total * 100) if total else 0
    league_ids = [t["id"] for t in sorted(
        GAME_STATE["teams"].values(),
        key=lambda t: (-t.get("wins", 0), t.get("losses", 0)),
    )]
    rank = (league_ids.index(user_id) + 1) if user_id in league_ids else "?"

    if user_won:
        if gold_diff > 10000:
            board_pool = [
                ("Direction Sportive", f"Victoire écrasante contre {opp_name}",
                 f"Performance de grande classe ce soir contre {opp_abbr} en {duration}min (différence d'or : {gold_diff:,}).{mvp_mention} L'équipe est 1ère au classement si elle continue ainsi. Bilan : {wins}V-{losses}D."),
                ("Président", f"Domination totale — Semaine {week_num}",
                 f"Je n'ai pas grand-chose à dire, laissez le jeu parler de lui-même. {opp_abbr} n'a jamais eu le match en main.{mvp_mention} Bilan {wins}V-{losses}D — nous sommes #{rank}."),
                ("Sponsor Principal", f"Nos partenaires sont conquis",
                 f"La domination contre {opp_abbr} en {duration}min a généré un pic d'engagement record.{mvp_mention} Sponsors ravis. Bilan {wins}V-{losses}D."),
            ]
        elif streak_count >= 3 and streak_type == "win":
            board_pool = [
                ("Manager Général", f"Série de {streak_count} — Semaine {week_num}",
                 f"Encore une victoire contre {opp_abbr} !{mvp_mention}{streak_note} Le groupe est en feu. #{rank} au classement, {wins}V-{losses}D."),
                ("Direction Sportive", f"Série en cours — {streak_count} victoires consécutives",
                 f"L'équipe confirme sa régularité.{mvp_mention} Victoire contre {opp_abbr} en {duration}min.{streak_note} #{rank} au classement avec {wins}V-{losses}D."),
            ]
        else:
            board_pool = [
                ("Direction Sportive", f"Victoire acquise contre {opp_name}",
                 f"Bonne victoire contre {opp_abbr} en {duration}min.{mvp_mention} L'essentiel est là. #{rank} au classement — bilan {wins}V-{losses}D."),
                ("Manager Général", f"Résultat positif — Semaine {week_num}",
                 f"Victoire contre {opp_name} confirmée. Match équilibré mais bien géré.{mvp_mention} On reste sur la bonne trajectoire : {wins}V-{losses}D (#{rank})."),
                ("Analyste Tactique", f"Post-match vs {opp_abbr}",
                 f"La lecture mid-game a fait la différence contre {opp_abbr}.{mvp_mention} {duration}min, match maîtrisé. Bilan {wins}V-{losses}D."),
            ]
        soloq_pool = [
            ("@LoLAnalyst_EU", f"Thread : {opp_abbr} battu",
             f"Performance solide ce soir. Victoire en {duration}min montre une bonne lecture du jeu.{(' ' + user_mvp + ' MVP.') if user_mvp else ''} #LoLEsports"),
            ("LeagueFanatic42", f"Quelle victoire contre {opp_abbr} !",
             f"Victoire en {duration}min{(' — ' + user_mvp + ' dominant') if user_mvp else ''} — let's go ! {wins}V-{losses}D"),
            ("EsportsInsider", f"Analyse post-match vs {opp_abbr}",
             f"Cohérence tactique notable. #{rank} au classement.{(' ' + user_mvp + ' en grande forme.') if user_mvp else ''} {wins}V-{losses}D"),
            ("@ProScoutWatch", f"{opp_abbr} neutralisé — les chiffres",
             f"Victoire en {duration}min contre {opp_abbr}.{(' ' + user_mvp + ' : KDA hors normes.') if user_mvp else ''} {wins}V-{losses}D #Analytics"),
        ]
    else:
        if streak_count >= 3 and streak_type == "loss":
            board_pool = [
                ("Président", f"URGENT — Série noire : {streak_count} défaites",
                 f"Je ne peux plus rester silencieux. {streak_count} défaites consécutives dont ce soir contre {opp_abbr}. Bilan {wins}V-{losses}D (#{rank}). Une réunion de crise est convoquée."),
                ("Manager Général", f"Crise de résultats — Action immédiate requise",
                 f"La série de {streak_count} défaites exige une réponse. {wins}V-{losses}D. #{rank} au classement — les playoffs s'éloignent."),
            ]
        elif losses > wins:
            board_pool = [
                ("Manager Général", f"Défaite préoccupante — URGENT",
                 f"Cette défaite contre {opp_abbr} est difficile à accepter. Avec {wins}V-{losses}D (#{rank}), notre position devient critique."),
                ("Président", f"Réunion de situation demandée",
                 f"Suite à la défaite contre {opp_name} — bilan {wins}V-{losses}D, #{rank}. J'attends un retour d'analyse sous 48h."),
            ]
        else:
            board_pool = [
                ("Direction Sportive", f"Défaite contre {opp_name} — Analyse requise",
                 f"Défaite ce soir contre {opp_abbr} en {duration}min. Bilan toujours positif : {wins}V-{losses}D (#{rank})."),
                ("Manager Général", f"Retour sur la défaite — S{week_num}",
                 f"Résultat décevant contre {opp_name} en {duration}min. Bilan : {wins}V-{losses}D (#{rank}) — les points se rattrapent encore."),
                ("Analyste Tactique", f"Points à corriger vs {opp_abbr}",
                 f"Défaite en {duration}min contre {opp_abbr}. La gestion des objectifs a posé problème. Bilan : {wins}V-{losses}D."),
            ]
        soloq_pool = [
            ("@CriticalCoach", f"Analyse défaite vs {opp_abbr}",
             f"Difficile à regarder ce soir. La défaite en {duration}min est symptomatique de problèmes récurrents.{streak_note} #LoLEsports"),
            ("LoLFan_Frustrated", f"Qu'est-ce qui se passe ???",
             f"Comment on perd contre {opp_abbr} comme ça en {duration}min...{streak_note} {wins}V-{losses}D c'est pas acceptable."),
            ("EsportsBetting", f"Post-match {opp_abbr} — Côtes révisées",
             f"La défaite contre {opp_abbr} impacte les prévisions playoff. {wins}V-{losses}D (#{rank})."),
            ("@ProScoutWatch", f"Analyse froide : {opp_abbr} a dominé",
             f"{opp_abbr} a contrôlé le tempo en {duration}min.{streak_note} #{rank} au classement, {wins}V-{losses}D. #Analytics"),
        ]

    b = random.choice(board_pool)
    s = random.choice(soloq_pool)
    add_inbox_message("board", b[0], b[1], b[2], week_num)
    add_inbox_message("soloq", s[0], s[1], s[2], week_num)


def generate_weekly_board_message(week: int):
    """Board message at the start of each new week with standings context."""
    user_id = GAME_STATE.get("user_team")
    if not user_id:
        return
    user_team_obj = GAME_STATE["teams"].get(user_id, {})
    wins = user_team_obj.get("wins", 0)
    losses = user_team_obj.get("losses", 0)
    total = wins + losses
    if total == 0:
        return

    wr = round(wins / total * 100)
    league_sorted = sorted(
        GAME_STATE["teams"].values(),
        key=lambda t: (-t.get("wins", 0), t.get("losses", 0)),
    )
    rank = next((i + 1 for i, t in enumerate(league_sorted) if t["id"] == user_id), "?")
    n_teams = len(league_sorted)
    playoff_spots = 6
    remaining = max(0, 9 - total)

    if week <= 3:
        phase_ctx = "début de split"
    elif week <= 6:
        phase_ctx = "mi-saison"
    else:
        phase_ctx = "sprint final"

    if wr >= 70:
        pool = [
            (f"Semaine {week} — Objectifs dépassés",
             f"Bilan {wins}V-{losses}D ({wr}%) en {phase_ctx}. #{rank}/{n_teams} au classement. "
             f"Les playoffs semblent assurés si l'élan se maintient."),
            (f"Point hebdomadaire — Semaine {week}",
             f"#{rank} au classement avec {wins}V-{losses}D ({wr}%). Excellente régularité en {phase_ctx}. "
             f"{remaining} match(s) restant(s) — continuez à capitaliser."),
        ]
        sender = "Direction Sportive"
    elif wr >= 50:
        pool = [
            (f"Bilan semaine {week} — En bonne voie",
             f"#{rank}/{n_teams} avec {wins}V-{losses}D ({wr}%) — bilan satisfaisant en {phase_ctx}. "
             f"Les prochains matchs seront décisifs pour la qualification ({playoff_spots} places)."),
            (f"Point hebdomadaire — Semaine {week}",
             f"Bilan {wins}V-{losses}D, #{rank} au classement. {remaining} match(s) restant(s). "
             f"La qualification reste à portée — pas de relâchement."),
        ]
        sender = "Manager Général"
    elif rank <= playoff_spots:
        pool = [
            (f"Semaine {week} — Position précaire",
             f"#{rank}/{n_teams} avec {wins}V-{losses}D ({wr}%). Encore dans les playoffs, "
             f"mais la marge est mince. {remaining} match(s) pour consolider."),
            (f"Point hebdomadaire — Semaine {week}",
             f"Bilan {wins}V-{losses}D. #{rank} — dans la zone playoffs mais sous pression. "
             f"Il faut une réaction en {phase_ctx}."),
        ]
        sender = "Manager Général"
    else:
        pool = [
            (f"ALERTE — Semaine {week} : playoffs compromis",
             f"#{rank}/{n_teams} avec {wins}V-{losses}D ({wr}%) — hors des {playoff_spots} premières places. "
             f"{remaining} match(s) restant(s). Des victoires consécutives sont indispensables."),
            (f"Point de crise — Semaine {week}",
             f"Bilan {wins}V-{losses}D, #{rank}/{n_teams}. En {phase_ctx}, la qualification devient critique."),
        ]
        sender = "Président"

    subject, body = random.choice(pool)
    add_inbox_message("board", sender, subject, body, week)
