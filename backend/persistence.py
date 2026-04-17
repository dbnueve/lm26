"""Persistence layer for LM26: save/load GAME_STATE to JSON slots.

Post-load hooks let server.py register callbacks without creating
a circular import (persistence ← app_state, server ← persistence).
"""

import json
import logging
from typing import Callable

from app_state import GAME_STATE, state
from save_paths import get_save_path, _read_active_slot_file

_post_load_hooks: list[Callable[[], None]] = []


def register_post_load_hook(fn: Callable[[], None]) -> None:
    _post_load_hooks.append(fn)


def save_state() -> None:
    if state.active_slot is None:
        return
    try:
        path = get_save_path(state.active_slot)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(GAME_STATE, f)
        tmp.replace(path)  # atomic on same filesystem — prevents corruption on crash
        state.worker_mtime = path.stat().st_mtime
    except Exception as e:
        logging.error(f"Failed to save slot {state.active_slot}: {e}")


def load_state() -> bool:
    """Load state from the active slot (or last known slot on restart)."""
    slot = state.active_slot if state.active_slot is not None else _read_active_slot_file()
    if slot is None:
        return False
    path = get_save_path(slot)
    if not path.exists():
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        GAME_STATE.update(data)
        GAME_STATE["meta_champions"] = None  # Force league-specific baseline on next access
        state.active_slot = slot
        state.worker_mtime = path.stat().st_mtime
        for hook in _post_load_hooks:
            hook()
        return True
    except Exception as e:
        logging.error(f"Failed to load slot {slot}: {e}")
        return False


def _sync_state_if_stale() -> None:
    """If the active save file was written by another worker, reload it."""
    slot = _read_active_slot_file()
    if slot is None:
        return
    path = get_save_path(slot)
    if not path.exists():
        return
    try:
        mtime = path.stat().st_mtime
        if slot != state.active_slot or mtime > state.worker_mtime:
            state.active_slot = slot
            load_state()
    except Exception as e:
        logging.debug(f"_sync_state_if_stale: {e}")
