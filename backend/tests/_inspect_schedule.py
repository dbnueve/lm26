import httpx, asyncio, json

async def main():
    async with httpx.AsyncClient(base_url="http://localhost:8002/api", timeout=10) as c:
        r = (await c.post("/mp/create", json={"league":"LEC","username":"aa","max_players":2})).json()
        sid, ta, code = r["session_id"], r["token"], r["code"]
        tb = (await c.post("/mp/join", json={"code": code, "username":"bb"})).json()["token"]
        await c.post(f"/mp/{sid}/team", json={"token": ta, "team_id":"g2"})
        await c.post(f"/mp/{sid}/team", json={"token": tb, "team_id":"kc"})
        st = (await c.get(f"/mp/{sid}/state", params={"token": ta})).json()
        sched = st["schedule"]
        hvh = [m for m in sched if m["is_human_vs_human"]]
        print(f"{len(sched)} matchs, {len(hvh)} H vs H:")
        for m in hvh:
            print(f"  w{m['week']:2}: {m['team1']} vs {m['team2']}  completed={m['result_json'] is not None}")

asyncio.run(main())
