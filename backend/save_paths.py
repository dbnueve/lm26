"""
Helpers I/O pour le système de 3 slots de sauvegarde.
Pur : aucune dépendance sur GAME_STATE.
Extrait de server.py — Étape 1 du refactor.
"""
from __future__ import annotations

import logging
from pathlib import Path

ROOT_DIR = Path(__file__).parent


def get_save_path(slot: int) -> Path:
    """Retourne le chemin du fichier de sauvegarde pour un slot donné."""
    return ROOT_DIR / f"game_save_{slot}.json"


def _read_active_slot_file() -> int | None:
    """Lit le slot actif depuis active_slot.txt. Retourne None si absent/invalide."""
    try:
        p = ROOT_DIR / "active_slot.txt"
        if p.exists():
            v = int(p.read_text().strip())
            return v if v in (1, 2, 3) else None
    except Exception:
        return None
    return None


def _write_active_slot_file(slot: int) -> None:
    """Persiste le slot actif. Slot invalide = no-op avec log d'erreur."""
    if slot not in (1, 2, 3):
        logging.error(f"_write_active_slot_file: slot invalide {slot}")
        return
    try:
        (ROOT_DIR / "active_slot.txt").write_text(str(slot))
    except Exception as e:
        logging.error(f"Failed to write active_slot.txt: {e}")
