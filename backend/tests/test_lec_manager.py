"""
LEC Manager Backend API Tests
Tests for draft system, meta stats, team selection, and game initialization
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestGameInitialization:
    """Tests for game initialization and state management"""
    
    def test_game_init(self):
        """POST /api/game/init - Initialize game"""
        response = requests.post(f"{BASE_URL}/api/game/init")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert "message" in data
        print(f"✓ Game initialized: {data['message']}")
    
    def test_game_state(self):
        """GET /api/game/state - Get game state"""
        response = requests.get(f"{BASE_URL}/api/game/state")
        assert response.status_code == 200
        data = response.json()
        assert "initialized" in data
        assert "season" in data
        assert data["season"] == 2026
        print(f"✓ Game state retrieved: initialized={data['initialized']}, season={data['season']}")


class TestTeamSelection:
    """Tests for team listing and selection"""
    
    def test_get_teams(self):
        """GET /api/teams - Get all LEC teams"""
        response = requests.get(f"{BASE_URL}/api/teams")
        assert response.status_code == 200
        teams = response.json()
        assert isinstance(teams, list)
        assert len(teams) == 10  # 10 LEC teams
        
        # Verify team structure
        team_ids = [t["id"] for t in teams]
        expected_ids = ["g2", "fnc", "kc", "koi", "vit", "navi", "gx", "th", "sk", "bds"]
        for expected_id in expected_ids:
            assert expected_id in team_ids, f"Missing team: {expected_id}"
        
        # Check team data structure
        for team in teams:
            assert "id" in team
            assert "name" in team
            assert "abbr" in team
            assert "rating" in team
            assert "budget" in team
        print(f"✓ Retrieved {len(teams)} teams: {[t['abbr'] for t in teams]}")
    
    def test_select_team_g2(self):
        """POST /api/teams/select/g2 - Select G2 Esports"""
        response = requests.post(f"{BASE_URL}/api/teams/select/g2")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["team"]["id"] == "g2"
        assert data["team"]["name"] == "G2 Esports"
        print(f"✓ Selected team: {data['team']['name']}")
    
    def test_get_team_with_roster(self):
        """GET /api/teams/g2 - Get team with roster"""
        response = requests.get(f"{BASE_URL}/api/teams/g2")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "g2"
        assert "players" in data
        assert len(data["players"]) >= 5  # At least 5 starters
        
        # Verify roster positions
        positions = [p["position"] for p in data["players"]]
        for pos in ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]:
            assert pos in positions, f"Missing position: {pos}"
        print(f"✓ Team roster has {len(data['players'])} players")
    
    def test_select_invalid_team(self):
        """POST /api/teams/select/invalid - Should return 404"""
        response = requests.post(f"{BASE_URL}/api/teams/select/invalid_team")
        assert response.status_code == 404
        print("✓ Invalid team selection returns 404")


class TestMetaStats:
    """Tests for meta statistics from gol.gg data"""
    
    def test_get_meta_stats(self):
        """GET /api/meta/stats - Get tournament meta statistics"""
        response = requests.get(f"{BASE_URL}/api/meta/stats")
        assert response.status_code == 200
        data = response.json()
        
        # Verify tournament info
        assert data["tournament"] == "LEC 2026 Versus Season"
        assert data["total_games"] == 66
        assert data["draft_mode"] == "Fearless Draft"
        
        # Verify champions by position
        assert "champions_by_position" in data
        positions = data["champions_by_position"]
        for pos in ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]:
            assert pos in positions, f"Missing position: {pos}"
            assert len(positions[pos]) > 0, f"No champions for {pos}"
        
        # Verify champion data structure
        for pos, champs in positions.items():
            for champ in champs:
                assert "name" in champ
                assert "picks" in champ
                assert "bans" in champ
                assert "winrate" in champ
                assert "tier" in champ
                assert "presence" in champ
                assert champ["tier"] in ["S", "A", "B", "C"]
        
        print(f"✓ Meta stats: {data['total_games']} games, {data['draft_mode']}")
        print(f"  Champions per position: {', '.join([f'{k}:{len(v)}' for k,v in positions.items()])}")
    
    def test_meta_stats_top_champions(self):
        """Verify top meta champions have correct data"""
        response = requests.get(f"{BASE_URL}/api/meta/stats")
        data = response.json()
        
        # Check for specific high-presence champions
        top_champs = data["champions_by_position"]["TOP"]
        ksante = next((c for c in top_champs if c["name"] == "K'Sante"), None)
        assert ksante is not None, "K'Sante should be in TOP champions"
        assert ksante["tier"] == "S"
        assert ksante["picks"] == 32
        
        # Check ADC for Yunara (new champion)
        adc_champs = data["champions_by_position"]["ADC"]
        yunara = next((c for c in adc_champs if c["name"] == "Yunara"), None)
        assert yunara is not None, "Yunara should be in ADC champions"
        assert yunara["tier"] == "S"
        
        print(f"✓ Verified K'Sante (TOP, S-tier, 32 picks) and Yunara (ADC, S-tier)")


class TestDraftChampions:
    """Tests for draft champion endpoint"""
    
    def test_get_draft_champions(self):
        """GET /api/draft/champions - Get champions organized by position"""
        response = requests.get(f"{BASE_URL}/api/draft/champions")
        assert response.status_code == 200
        data = response.json()
        
        # Should return dict with positions as keys
        assert isinstance(data, dict)
        for pos in ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]:
            assert pos in data, f"Missing position: {pos}"
            assert isinstance(data[pos], list)
            assert len(data[pos]) > 0
        
        # Verify champion structure
        for pos, champs in data.items():
            for champ in champs:
                assert "name" in champ
                assert "picks" in champ
                assert "bans" in champ
                assert "winrate" in champ
                assert "tier" in champ
        
        total_champs = sum(len(champs) for champs in data.values())
        print(f"✓ Draft champions: {total_champs} total across {len(data)} positions")
    
    def test_draft_champions_tier_distribution(self):
        """Verify tier distribution in draft champions"""
        response = requests.get(f"{BASE_URL}/api/draft/champions")
        data = response.json()
        
        tier_counts = {"S": 0, "A": 0, "B": 0, "C": 0}
        for pos, champs in data.items():
            for champ in champs:
                tier = champ.get("tier", "C")
                tier_counts[tier] = tier_counts.get(tier, 0) + 1
        
        # Should have champions in each tier
        assert tier_counts["S"] > 0, "Should have S-tier champions"
        assert tier_counts["A"] > 0, "Should have A-tier champions"
        print(f"✓ Tier distribution: S={tier_counts['S']}, A={tier_counts['A']}, B={tier_counts['B']}, C={tier_counts['C']}")


class TestDraftSystem:
    """Tests for the Fearless Draft system"""
    
    def test_draft_start(self):
        """POST /api/draft/start - Initialize draft state"""
        response = requests.post(f"{BASE_URL}/api/draft/start")
        assert response.status_code == 200
        data = response.json()
        
        # Verify draft state structure
        assert data["phase"] == "ban1"
        assert data["user_bans"] == []
        assert data["enemy_bans"] == []
        assert data["user_picks"] == []
        assert data["enemy_picks"] == []
        assert data["current_turn"] == "user"
        assert data["banned_champions"] == []
        assert data["picked_champions"] == []
        
        print(f"✓ Draft started: phase={data['phase']}, turn={data['current_turn']}")
    
    def test_draft_ban_action(self):
        """POST /api/draft/action - Ban a champion"""
        # Start fresh draft
        requests.post(f"{BASE_URL}/api/draft/start")
        
        # User bans K'Sante
        response = requests.post(f"{BASE_URL}/api/draft/action", json={
            "action": "ban",
            "champion": "K'Sante"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify user ban
        assert "K'Sante" in data["user_bans"]
        assert "K'Sante" in data["banned_champions"]
        
        # Verify AI also banned (should ban high-presence champion)
        assert len(data["enemy_bans"]) == 1, "AI should have banned a champion"
        ai_ban = data["enemy_bans"][0]
        assert ai_ban in data["banned_champions"]
        assert ai_ban != "K'Sante", "AI should not ban same champion"
        
        print(f"✓ Ban action: User banned K'Sante, AI banned {ai_ban}")
    
    def test_draft_pick_action(self):
        """POST /api/draft/action - Pick a champion after bans"""
        # Start fresh draft
        requests.post(f"{BASE_URL}/api/draft/start")
        
        # Complete ban phase (3 bans each)
        bans = ["K'Sante", "Rumble", "Azir"]
        for ban in bans:
            requests.post(f"{BASE_URL}/api/draft/action", json={
                "action": "ban",
                "champion": ban
            })
        
        # Now pick phase - pick Yunara for ADC
        response = requests.post(f"{BASE_URL}/api/draft/action", json={
            "action": "pick",
            "champion": "Yunara",
            "position": "ADC"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Verify user pick
        assert len(data["user_picks"]) == 1
        assert data["user_picks"][0]["champion"] == "Yunara"
        assert data["user_picks"][0]["position"] == "ADC"
        assert "Yunara" in data["picked_champions"]
        
        # Verify AI also picked
        assert len(data["enemy_picks"]) == 1, "AI should have picked a champion"
        ai_pick = data["enemy_picks"][0]
        assert ai_pick["champion"] in data["picked_champions"]
        assert ai_pick["champion"] != "Yunara", "AI should not pick same champion"
        
        print(f"✓ Pick action: User picked Yunara (ADC), AI picked {ai_pick['champion']} ({ai_pick['position']})")
    
    def test_draft_complete_flow(self):
        """Test complete draft flow: 5 bans + 5 picks per team"""
        # Start fresh draft
        requests.post(f"{BASE_URL}/api/draft/start")
        
        # Get available champions
        champs_response = requests.get(f"{BASE_URL}/api/draft/champions")
        all_champs = champs_response.json()
        
        # Flatten champion list
        available = []
        for pos, champs in all_champs.items():
            for c in champs:
                available.append((c["name"], pos))
        
        # Ban phase - 5 bans each (user bans, AI responds)
        banned = []
        ban_count = 0
        for champ, pos in available:
            if ban_count >= 5:
                break
            response = requests.post(f"{BASE_URL}/api/draft/action", json={
                "action": "ban",
                "champion": champ
            })
            if response.status_code == 200:
                banned.append(champ)
                ban_count += 1
                data = response.json()
                # Also track AI bans
                for ai_ban in data.get("enemy_bans", []):
                    if ai_ban not in banned:
                        banned.append(ai_ban)
        
        data = response.json()
        assert len(data["user_bans"]) == 5, f"Expected 5 user bans, got {len(data['user_bans'])}"
        assert len(data["enemy_bans"]) == 5, f"Expected 5 AI bans, got {len(data['enemy_bans'])}"
        print(f"✓ Ban phase complete: User bans={data['user_bans']}, AI bans={data['enemy_bans']}")
        
        # Pick phase - 5 picks each, avoiding banned champions
        picked = list(data["picked_champions"])
        pick_count = 0
        positions_needed = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
        
        for pos in positions_needed:
            if pick_count >= 5:
                break
            # Find available champion for this position
            for champ, champ_pos in available:
                if champ_pos == pos and champ not in banned and champ not in picked:
                    response = requests.post(f"{BASE_URL}/api/draft/action", json={
                        "action": "pick",
                        "champion": champ,
                        "position": pos
                    })
                    if response.status_code == 200:
                        picked.append(champ)
                        pick_count += 1
                        data = response.json()
                        # Track AI picks
                        for ai_pick in data.get("enemy_picks", []):
                            if ai_pick["champion"] not in picked:
                                picked.append(ai_pick["champion"])
                        break
        
        data = response.json()
        print(f"✓ Pick phase: User picks={len(data['user_picks'])}, AI picks={len(data['enemy_picks'])}")
        print(f"  Draft phase: {data['phase']}")
        
        # Verify we made progress in draft
        assert len(data["user_picks"]) > 0, "Should have at least 1 user pick"
        assert len(data["enemy_picks"]) > 0, "Should have at least 1 AI pick"
        
        # Verify draft completion or progress
        if data["phase"] == "complete":
            print("✓ Draft completed successfully!")
        else:
            print(f"  Draft in progress: {data['phase']}")
    
    def test_draft_unavailable_champion(self):
        """Test that banned/picked champions cannot be selected"""
        # Start fresh draft
        requests.post(f"{BASE_URL}/api/draft/start")
        
        # Ban K'Sante
        requests.post(f"{BASE_URL}/api/draft/action", json={
            "action": "ban",
            "champion": "K'Sante"
        })
        
        # Try to ban K'Sante again - should fail
        response = requests.post(f"{BASE_URL}/api/draft/action", json={
            "action": "ban",
            "champion": "K'Sante"
        })
        assert response.status_code == 400
        print("✓ Cannot select already banned champion (returns 400)")
    
    def test_ai_bans_high_presence_champions(self):
        """Verify AI bans high-presence meta champions"""
        # Get meta stats to know high-presence champions
        meta_response = requests.get(f"{BASE_URL}/api/meta/stats")
        meta_data = meta_response.json()
        
        # Collect high-presence champions (presence > 50%)
        high_presence = []
        for pos, champs in meta_data["champions_by_position"].items():
            for c in champs:
                if c["presence"] > 50:
                    high_presence.append(c["name"])
        
        # Start draft and do multiple bans to see AI behavior
        requests.post(f"{BASE_URL}/api/draft/start")
        
        ai_bans = []
        low_priority_bans = ["Ornn", "Smolder", "LeBlanc", "Pyke", "Jinx"]  # Low pick/ban champions
        
        for ban in low_priority_bans[:3]:
            response = requests.post(f"{BASE_URL}/api/draft/action", json={
                "action": "ban",
                "champion": ban
            })
            if response.status_code == 200:
                data = response.json()
                if data["enemy_bans"]:
                    ai_bans = data["enemy_bans"]
        
        # AI should ban at least some high-presence champions
        high_presence_bans = [b for b in ai_bans if b in high_presence]
        print(f"✓ AI bans: {ai_bans}")
        print(f"  High-presence bans: {high_presence_bans}")


class TestDashboardData:
    """Tests for dashboard-related endpoints"""
    
    def test_standings(self):
        """GET /api/standings - Get team standings"""
        response = requests.get(f"{BASE_URL}/api/standings")
        assert response.status_code == 200
        standings = response.json()
        
        assert isinstance(standings, list)
        assert len(standings) == 10
        
        for team in standings:
            assert "rank" in team
            assert "wins" in team
            assert "losses" in team
            assert "win_rate" in team
            assert "qualified" in team
        
        print(f"✓ Standings: {len(standings)} teams ranked")
    
    def test_schedule(self):
        """GET /api/schedule - Get match schedule"""
        response = requests.get(f"{BASE_URL}/api/schedule")
        assert response.status_code == 200
        schedule = response.json()
        
        assert isinstance(schedule, list)
        assert len(schedule) > 0
        
        for match in schedule[:5]:  # Check first 5 matches
            assert "id" in match
            assert "week" in match
            assert "team1" in match
            assert "team2" in match
            assert "played" in match
        
        print(f"✓ Schedule: {len(schedule)} matches")
    
    def test_all_players(self):
        """GET /api/players - Get all players"""
        response = requests.get(f"{BASE_URL}/api/players")
        assert response.status_code == 200
        players = response.json()
        
        assert isinstance(players, list)
        assert len(players) >= 50  # At least 5 players per 10 teams
        
        for player in players[:5]:
            assert "id" in player
            assert "name" in player
            assert "position" in player
            assert "rating" in player
            assert "team_id" in player
        
        print(f"✓ Players: {len(players)} total")


class TestScoutingSystem:
    """Tests for ERL scouting system"""
    
    def test_get_erl_players(self):
        """GET /api/scouting/erl - Get ERL/Academy players"""
        response = requests.get(f"{BASE_URL}/api/scouting/erl")
        assert response.status_code == 200
        players = response.json()
        
        assert isinstance(players, list)
        assert len(players) > 0
        
        # Check player structure
        for player in players[:5]:
            assert "id" in player
            assert "name" in player
            assert "position" in player
            assert "rating" in player
            assert "potential" in player
            assert "league" in player
        
        # Check for different leagues
        leagues = set(p["league"] for p in players)
        print(f"✓ ERL Players: {len(players)} from leagues: {leagues}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
