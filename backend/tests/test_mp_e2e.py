"""E2E smoke test for LM26 multiplayer (2 players, full flow via HTTP)."""
from __future__ import annotations

import asyncio
import json
import sys
import time

import httpx

BASE = "http://localhost:8002/api"


async def main() -> int:
    async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as c:
        print("─── 1. Joueur 1 crée une session LEC ───")
        r = await c.post("/mp/create", json={"league": "LEC", "username": "alice", "max_players": 2})
        r.raise_for_status()
        s1 = r.json()
        session_id, code, token_a = s1["session_id"], s1["code"], s1["token"]
        print(f"   session={session_id[:8]} code={code}")

        print("─── 2. Joueur 2 rejoint via code ───")
        r = await c.post("/mp/join", json={"code": code, "username": "bob"})
        r.raise_for_status()
        token_b = r.json()["token"]
        print(f"   bob token={token_b[:8]}")

        print("─── 3. État initial ───")
        r = await c.get(f"/mp/{session_id}/state", params={"token": token_a})
        r.raise_for_status()
        st = r.json()
        print(f"   phase={st['phase']}  players={len(st['players'])}  my_side={st['my_side']}")
        assert st["phase"] == "team_pick", f"attendu team_pick, eu {st['phase']}"

        print("─── 4. Liste des équipes LEC ───")
        r = await c.get("/mp/league-teams/LEC")
        teams = r.json()
        team_a = teams[0]["id"]
        team_b = teams[1]["id"]
        print(f"   {len(teams)} équipes. Alice → {team_a}, Bob → {team_b}")

        print("─── 5. Les deux joueurs choisissent leur équipe ───")
        r = await c.post(f"/mp/{session_id}/team", json={"token": token_a, "team_id": team_a})
        r.raise_for_status()
        r = await c.post(f"/mp/{session_id}/team", json={"token": token_b, "team_id": team_b})
        r.raise_for_status()

        print("─── 6. État après team pick (doit être regular) ───")
        r = await c.get(f"/mp/{session_id}/state", params={"token": token_a})
        st = r.json()
        print(f"   phase={st['phase']}  week={st['week']}  my_team={st['my_team']}")
        assert st["phase"] == "regular", f"attendu regular, eu {st['phase']}"
        assert st["my_team"] == team_a

        print("─── 7. Rosters chargés ───")
        r = await c.get(f"/mp/{session_id}/team", params={"token": token_a})
        td = r.json()
        print(f"   {td['team'].get('name', team_a)} — {len(td['players'])} joueurs")
        assert len(td["players"]) >= 5, "roster trop petit"

        print("─── 8. Boucle regular : ready+advance par semaine ───")
        weeks_played = 0
        drafts_resolved = 0
        for i in range(30):  # safety max
            r = await c.get(f"/mp/{session_id}/state", params={"token": token_a})
            st = r.json()
            phase = st["phase"]
            if i == 0:
                print(f"   iter0 phase={phase} week={st['week']} players_ready={[p['ready'] for p in st['players']]}")
            if phase != "regular":
                print(f"   iter{i}: sortie boucle, phase={phase}")
                break

            active = st.get("active_draft")
            draft_ready = active and active.get("draft_json") is not None
            print(f"   iter{i}: active_draft={active is not None} draft_ready={draft_ready} week={st['week']}")

            # Si un draft H vs H est actif ET initialisé → le résoudre
            if draft_ready:
                d = active
                match_id = d["id"]
                raw = json.loads(d["draft_json"])
                step = raw["step"]
                # On pick des champions uniques (C0, C1, ...) pour chaque action
                champion_pool = [f"Champ{k}" for k in range(20)]
                used = set()
                if raw:
                    for side in ("1", "2"):
                        used.update(raw["bans"].get(side, []) + raw["picks"].get(side, []))
                # Liste ordonnée de champions disponibles
                available = [c for c in champion_pool if c not in used]

                # Déterminer qui doit jouer (côté attendu)
                seq = raw["sequence"] if raw else []
                while step < len(seq):
                    action_type, expected_side = seq[step]
                    tok = token_a if int(expected_side) == 1 else token_b
                    champ = available.pop(0)
                    rr = await c.post(
                        f"/mp/{session_id}/draft/action",
                        json={"token": tok, "match_id": match_id, "champion": champ},
                    )
                    if rr.status_code != 200:
                        print(f"   ERROR draft: {rr.status_code} {rr.text[:200]}")
                        return 1
                    res = rr.json()
                    step = res["step"]
                    if res["completed"]:
                        drafts_resolved += 1
                        print(f"   draft résolu (match_id={match_id}, winner={res['match_result']['winner']})")
                        break
                continue  # refetch state pour voir la semaine avancée

            # Pas de draft → les 2 joueurs marquent ready
            r1 = await c.post(f"/mp/{session_id}/ready", json={"token": token_a})
            if r1.status_code != 200:
                print(f"   ERROR ready alice: {r1.status_code} {r1.text[:200]}")
                return 1
            r2 = await c.post(f"/mp/{session_id}/ready", json={"token": token_b})
            if r2.status_code != 200:
                print(f"   ERROR ready bob: {r2.status_code} {r2.text[:200]}")
                return 1
            weeks_played += 1
            data = r2.json()
            if data.get("week_result"):
                wr = data["week_result"]
                print(f"   semaine {wr['week']}: {len(wr['results'])} matchs sim, {len(wr['pending_drafts'])} drafts pending")

        print(f"─── 9. Stats : {weeks_played} semaines jouées, {drafts_resolved} drafts résolus ───")

        r = await c.get(f"/mp/{session_id}/state", params={"token": token_a})
        st = r.json()
        print(f"   phase finale={st['phase']}  week={st['week']}")

        # Test endpoint reset-ready (nouveau)
        print("─── 10. Test endpoint /reset-ready ───")
        r = await c.post(f"/mp/{session_id}/reset-ready", json={"token": token_a})
        assert r.status_code in (200, 400), f"reset-ready inattendu: {r.status_code} {r.text}"
        if r.status_code == 200:
            print("   reset-ready OK")
        else:
            print(f"   reset-ready rejeté (phase={st['phase']}): {r.text[:150]}")

        # Test WebSocket connect + ping/pong + heartbeat
        print("─── 11. Test WebSocket (connect + ping/pong) ───")
        import websockets
        ws_url = f"ws://localhost:8002/ws/mp/{session_id}?token={token_a}"
        async with websockets.connect(ws_url) as ws:
            # Premier message attendu: state_update
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            parsed = json.loads(msg)
            assert parsed["type"] == "state_update", f"attendu state_update, eu {parsed['type']}"
            print(f"   WS: state_update reçu (phase={parsed['payload']['phase']})")

            # Envoie ping, attend pong
            await ws.send(json.dumps({"type": "ping"}))
            got_pong = False
            for _ in range(3):
                m = await asyncio.wait_for(ws.recv(), timeout=3.0)
                p = json.loads(m)
                if p["type"] == "pong":
                    got_pong = True
                    break
            assert got_pong, "pas de pong reçu après ping"
            print("   WS: pong reçu après ping")

        print("\n✅ Smoke test E2E OK — multijoueur jouable de bout en bout")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
