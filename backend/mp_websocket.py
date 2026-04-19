"""
WebSocket connection manager for LM26 multiplayer.

Maintains a map: session_id → {token → WebSocket}
Provides broadcast and targeted send helpers.

Event format (always JSON):
  {"type": "...", "payload": {...}}

Event types:
  state_update      — full session state refresh
  player_joined     — a new player joined
  player_ready      — a player marked ready
  team_picked       — a player picked a team
  draft_action      — ban or pick in the shared draft
  match_result      — a match was simulated
  week_advanced     — week number incremented
  chat              — in-session chat message
  error             — server-side error for this player
  ping              — keepalive
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        # session_id → {token → WebSocket}
        self._sessions: dict[str, dict[str, WebSocket]] = {}

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, session_id: str, token: str, ws: WebSocket) -> None:
        await ws.accept()
        if session_id not in self._sessions:
            self._sessions[session_id] = {}
        self._sessions[session_id][token] = ws
        logger.info(f"WS connected: session={session_id[:8]} token={token[:8]}")

    def disconnect(self, session_id: str, token: str) -> None:
        session_conns = self._sessions.get(session_id, {})
        session_conns.pop(token, None)
        if not session_conns:
            self._sessions.pop(session_id, None)
        logger.info(f"WS disconnected: session={session_id[:8]} token={token[:8]}")

    def is_connected(self, session_id: str, token: str) -> bool:
        return token in self._sessions.get(session_id, {})

    def connected_tokens(self, session_id: str) -> list[str]:
        return list(self._sessions.get(session_id, {}).keys())

    def session_count(self) -> int:
        return len(self._sessions)

    # ── Send helpers ──────────────────────────────────────────────────────────

    async def send_to(self, session_id: str, token: str, event_type: str,
                      payload: dict) -> None:
        ws = self._sessions.get(session_id, {}).get(token)
        if ws is None:
            return
        try:
            await ws.send_text(json.dumps({"type": event_type, "payload": payload}))
        except Exception as e:
            logger.warning(f"send_to failed {session_id[:8]}/{token[:8]}: {e}")
            self.disconnect(session_id, token)

    async def broadcast(self, session_id: str, event_type: str,
                        payload: dict, exclude_token: str | None = None) -> None:
        conns = dict(self._sessions.get(session_id, {}))
        msg = json.dumps({"type": event_type, "payload": payload})
        dead: list[str] = []
        for token, ws in conns.items():
            if token == exclude_token:
                continue
            try:
                await ws.send_text(msg)
            except Exception as e:
                logger.warning(f"broadcast failed {session_id[:8]}/{token[:8]}: {e}")
                dead.append(token)
        for t in dead:
            self.disconnect(session_id, t)

    async def send_error(self, session_id: str, token: str, message: str) -> None:
        await self.send_to(session_id, token, "error", {"message": message})

    async def send_ping(self, session_id: str, token: str) -> None:
        await self.send_to(session_id, token, "ping", {})


# Singleton used across the app
manager = ConnectionManager()
