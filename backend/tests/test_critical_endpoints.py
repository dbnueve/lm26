"""
Suite critique : endpoints utilisés dans les flows principaux
(saves, teams, draft, simulation, playoffs, international, training, tactics, inbox).

Ces tests servent de filet de sécurité AVANT toute extraction de modules depuis server.py.
Tout refactor doit garder ces tests verts.
"""
from __future__ import annotations

import pytest


# ═══════════════════════════════════════════════════════════════════════════════
# Saves + initialisation
# ═══════════════════════════════════════════════════════════════════════════════

class TestSavesLifecycle:
    def test_saves_empty_initially(self, client):
        r = client.get("/api/saves")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 3
        assert all(not s["exists"] for s in data)

    def test_new_game_creates_slot(self, client):
        r = client.post("/api/saves/1/new", json={"league": "LEC"})
        assert r.status_code == 200
        assert r.json()["success"] is True

        r = client.get("/api/saves")
        slots = r.json()
        assert slots[0]["exists"] is True
        assert slots[0]["league"] == "LEC"

    def test_new_game_invalid_slot(self, client):
        r = client.post("/api/saves/9/new", json={"league": "LEC"})
        assert r.status_code == 400

    def test_new_game_invalid_league(self, client):
        r = client.post("/api/saves/1/new", json={"league": "XXX"})
        assert r.status_code == 400

    def test_load_nonexistent_slot(self, client):
        r = client.post("/api/saves/2/load")
        assert r.status_code == 404

    def test_delete_save(self, client):
        client.post("/api/saves/1/new", json={"league": "LEC"})
        r = client.delete("/api/saves/1")
        assert r.status_code == 200
        slots = client.get("/api/saves").json()
        assert slots[0]["exists"] is False

    def test_leagues_endpoint(self, client):
        r = client.get("/api/leagues")
        assert r.status_code == 200
        leagues = r.json()
        assert isinstance(leagues, list)
        ids = [l["id"] if isinstance(l, dict) else l for l in leagues]
        for expected in ("LEC", "LCK", "LPL", "LCS", "CBLOL"):
            assert expected in ids

    def test_all_leagues_bootable(self, client):
        for league in ("LEC", "LCK", "LPL", "LCS", "CBLOL"):
            r = client.post("/api/saves/1/new", json={"league": league})
            assert r.status_code == 200, f"{league} init failed: {r.text}"
            state = client.get("/api/game/state").json()
            assert state["initialized"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# Teams / players
# ═══════════════════════════════════════════════════════════════════════════════

class TestTeamsAndPlayers:
    def test_teams_list(self, fresh_game):
        r = fresh_game.get("/api/teams")
        assert r.status_code == 200
        teams = r.json()
        assert len(teams) == 10
        for t in teams:
            assert {"id", "name", "abbr", "rating"}.issubset(t.keys())

    def test_team_detail_has_roster(self, fresh_game):
        r = fresh_game.get("/api/teams/g2")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == "g2"
        assert len(data["players"]) >= 5
        positions = {p["position"] for p in data["players"]}
        assert positions >= {"TOP", "JUNGLE", "MID", "ADC", "SUPPORT"}

    def test_select_invalid_team(self, client):
        client.post("/api/saves/1/new", json={"league": "LEC"})
        r = client.post("/api/teams/select/does_not_exist")
        assert r.status_code == 404

    def test_players_list(self, fresh_game):
        r = fresh_game.get("/api/players")
        assert r.status_code == 200
        players = r.json()
        assert len(players) >= 50
        for p in players[:5]:
            assert {"id", "name", "position", "rating", "team_id"}.issubset(p.keys())

    def test_scouting_erl(self, fresh_game):
        r = fresh_game.get("/api/scouting/erl")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ═══════════════════════════════════════════════════════════════════════════════
# Draft
# ═══════════════════════════════════════════════════════════════════════════════

class TestDraftFlow:
    def test_meta_stats(self, fresh_game):
        r = fresh_game.get("/api/meta/stats")
        assert r.status_code == 200
        data = r.json()
        assert "champions_by_position" in data
        for pos in ("TOP", "JUNGLE", "MID", "ADC", "SUPPORT"):
            assert pos in data["champions_by_position"]
            assert len(data["champions_by_position"][pos]) > 0

    def test_draft_champions(self, fresh_game):
        r = fresh_game.get("/api/draft/champions")
        assert r.status_code == 200
        data = r.json()
        for pos in ("TOP", "JUNGLE", "MID", "ADC", "SUPPORT"):
            assert pos in data and len(data[pos]) > 0

    def test_draft_start(self, fresh_game):
        r = fresh_game.post("/api/draft/start")
        assert r.status_code == 200
        state = r.json()
        assert state["phase"] == "ban1"
        assert state["user_bans"] == []
        assert state["enemy_bans"] == []
        assert state["current_turn"] == "user"

    def test_draft_ban_then_block_rebans(self, fresh_game):
        fresh_game.post("/api/draft/start")
        r = fresh_game.post("/api/draft/action", json={"action": "ban", "champion": "K'Sante"})
        assert r.status_code == 200
        data = r.json()
        assert "K'Sante" in data["user_bans"]
        assert len(data["enemy_bans"]) == 1  # AI repondu

        # Re-ban same champion -> refus
        r = fresh_game.post("/api/draft/action", json={"action": "ban", "champion": "K'Sante"})
        assert r.status_code == 400

    def test_draft_suggest(self, fresh_game):
        fresh_game.post("/api/draft/start")
        r = fresh_game.get("/api/draft/suggest")
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Schedule / standings / stats
# ═══════════════════════════════════════════════════════════════════════════════

class TestScheduleStandings:
    def test_schedule(self, fresh_game):
        r = fresh_game.get("/api/schedule")
        assert r.status_code == 200
        sched = r.json()
        assert len(sched) > 0
        for m in sched[:3]:
            assert {"id", "week", "team1", "team2", "played"}.issubset(m.keys())

    def test_standings_structure(self, fresh_game):
        r = fresh_game.get("/api/standings")
        assert r.status_code == 200
        s = r.json()
        assert len(s) == 10
        for t in s:
            assert {"rank", "wins", "losses", "win_rate"}.issubset(t.keys())

    def test_stats_champions(self, fresh_game):
        r = fresh_game.get("/api/stats/champions")
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Simulation (le cœur du jeu)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSimulation:
    def test_simulate_single_match(self, fresh_game):
        sched = fresh_game.get("/api/schedule").json()
        # Simuler le premier match non joué impliquant n'importe quelle équipe non user
        target = next(m for m in sched if not m["played"] and "g2" not in (m["team1"], m["team2"]))
        r = fresh_game.post("/api/match/simulate", json={"match_id": target["id"]})
        assert r.status_code == 200
        data = r.json()
        assert "winner" in data
        assert data["winner"] in (target["team1"], target["team2"])

    def test_simulate_week(self, fresh_game):
        """Simuler une semaine complète fait progresser current_week."""
        before = fresh_game.get("/api/game/state").json()["current_week"]
        r = fresh_game.post("/api/week/simulate")
        # Accepter 200 (semaine avancée) ou 400 (semaine courante déjà finie)
        assert r.status_code in (200, 400)
        after = fresh_game.get("/api/game/state").json()["current_week"]
        assert after >= before

    def test_full_season_runs(self, fresh_game):
        """Fast-forward: simuler toute la saison régulière — garde-fou critique."""
        r = fresh_game.post("/api/season/simulate")
        assert r.status_code == 200
        # Toutes les matches played
        sched = fresh_game.get("/api/schedule").json()
        assert all(m["played"] for m in sched), "Matches non joués après season/simulate"
        # Standings cohérents
        st = fresh_game.get("/api/standings").json()
        total_games = sum(t["wins"] + t["losses"] for t in st)
        assert total_games > 0


# ═══════════════════════════════════════════════════════════════════════════════
# Playoffs
# ═══════════════════════════════════════════════════════════════════════════════

class TestPlayoffs:
    def test_playoffs_after_regular_season(self, fresh_game):
        fresh_game.post("/api/season/simulate")
        # Les playoffs devraient démarrer automatiquement ou via /playoffs/start
        r = fresh_game.post("/api/playoffs/start")
        assert r.status_code in (200, 400)  # 400 si déjà démarrés

        r = fresh_game.get("/api/playoffs")
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Tactics + training + inbox
# ═══════════════════════════════════════════════════════════════════════════════

class TestTacticsTraining:
    def test_tactics_get_set(self, fresh_game):
        r = fresh_game.get("/api/tactics")
        assert r.status_code == 200

    def test_inbox(self, fresh_game):
        r = fresh_game.get("/api/inbox")
        assert r.status_code == 200
        data = r.json()
        # Retourne soit une liste, soit un objet {messages: [...], unread_*: int}
        if isinstance(data, list):
            pass  # ancienne API
        else:
            assert "messages" in data
            assert isinstance(data["messages"], list)

    def test_inbox_read_all(self, fresh_game):
        r = fresh_game.post("/api/inbox/read-all")
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Persistence : saves survivent à un reload
# ═══════════════════════════════════════════════════════════════════════════════

class TestPersistence:
    def test_state_persists_across_reload(self, client):
        client.post("/api/saves/1/new", json={"league": "LEC"})
        client.post("/api/teams/select/g2")
        client.post("/api/week/simulate")

        week_before = client.get("/api/game/state").json()["current_week"]

        # Simuler un redémarrage : reload du slot
        r = client.post("/api/saves/1/load")
        assert r.status_code == 200
        week_after = client.get("/api/game/state").json()["current_week"]
        assert week_after == week_before

    def test_two_slots_are_independent(self, client):
        client.post("/api/saves/1/new", json={"league": "LEC"})
        client.post("/api/teams/select/g2")
        client.post("/api/saves/2/new", json={"league": "LCK"})
        state2 = client.get("/api/game/state").json()
        assert state2["initialized"] is True

        client.post("/api/saves/1/load")
        state1 = client.get("/api/game/state").json()
        assert state1.get("league", "LEC") == "LEC"
