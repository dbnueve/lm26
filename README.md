# LM26 — Esport Manager

Manager d'esport League of Legends : draftez, simulez et gérez votre équipe à travers les saisons compétitives (LEC, LCK, LCS, CBLOL, LPL) basées sur les données réelles d'Oracle's Elixir.

## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Lancement](#lancement)
- [Configuration](#configuration)
- [Structure du projet](#structure-du-projet)
- [Sauvegardes](#sauvegardes)
- [Multijoueur](#multijoueur)
- [Données](#données)
- [Développement](#développement)

---

## Fonctionnalités

- **5 ligues majeures** avec rosters réels — LEC, LCK, LCS, CBLOL, LPL
- **Saison complète** : Spring Split → MSI → Summer Split → Worlds
- **Draft picks/bans** avec meta dynamique par ligue
- **Simulation de match** détaillée : timeline d'événements, kills, towers, dragons
- **Système ELO custom** pour le classement des équipes
- **Playoffs et compétitions internationales** (MSI, Worlds)
- **Mode multijoueur** : drafts partagés, lobbies, sauvegardes persistantes
- **3 slots de sauvegarde** indépendants
- **Négociations de transferts** et gestion de roster
- **Entraînements** pour faire progresser les joueurs

---

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, CRA + Craco, Tailwind, Radix UI, Axios, Framer Motion |
| Backend | FastAPI, Uvicorn (Python 3.10+) |
| Persistance solo | JSON fichier (écriture atomique) |
| Persistance multi | SQLite (`backend/multiplayer.db`) |
| ELO | Système custom (`backend/elo_system.py`) |
| Données | CSV Oracle's Elixir 2025 / 2026 |

---

## Prérequis

- Python 3.10+
- Node.js 18+
- npm

---

## Installation

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

---

## Lancement

**Backend** — port `8002` :
```bash
cd backend
uvicorn server:app --reload --port 8002
```

**Frontend** — port `3000` :
```bash
cd frontend
npm start
```

L'application est accessible sur [http://localhost:3000](http://localhost:3000).

> Si le port `8002` est occupé sous Windows :
> ```bash
> netstat -ano | grep :8002
> taskkill /PID <pid> /F
> ```

---

## Configuration

- `frontend/.env` → `REACT_APP_BACKEND_URL` (vide = proxy Craco vers `localhost:8002`)
- Backend CORS : whitelist `http://localhost:3000` en dev ; variable `CORS_ORIGINS` en prod
- Tous les appels API passent par l'instance `API` exportée depuis [src/shared.js](frontend/src/shared.js)

---

## Structure du projet

```
lm26/
├── backend/
│   ├── server.py              # API FastAPI (54 endpoints)
│   ├── elo_system.py          # Calcul ELO custom
│   ├── league_meta_data.py    # Meta champions par ligue
│   ├── multiplayer.py         # Logique multijoueur
│   ├── mp_websocket.py        # WebSocket multijoueur
│   ├── mp_db.py               # Persistance SQLite multijoueur
│   ├── mp_logic.py            # Règles métier multijoueur
│   ├── app_state.py           # GAME_STATE global
│   ├── game_save_*.json       # Sauvegardes solo (3 slots)
│   ├── active_slot.txt        # Slot actif
│   └── *.csv                  # Données Oracle's Elixir
└── frontend/
    └── src/
        ├── App.js                       # Routing + orchestration
        ├── shared.js                    # API client + contextes
        ├── hooks/
        │   └── useMultiplayerSocket.js  # WebSocket client
        └── components/                  # 36+ composants React
            ├── MultiplayerLobby.js
            ├── MultiplayerGame.js
            ├── MultiplayerHub.js
            ├── SaveSelectionPage.js
            ├── DraftSystem.js
            ├── MatchSimulation.js
            └── ...
```

---

## Sauvegardes

### Solo
Les parties sont stockées dans `backend/game_save_{1,2,3}.json`. Le slot actif est suivi via `backend/active_slot.txt`. Les écritures utilisent un pattern atomique `tmp + rename` pour éviter la corruption.

### Multijoueur
Les parties multijoueur sont conservées dans `backend/multiplayer.db` (SQLite) et persistent entre redémarrages du backend. Elles apparaissent à côté des saves solo dans la page de sélection.

---

## Multijoueur

Le mode multijoueur permet à plusieurs joueurs de partager une même save, avec drafts coordonnés en temps réel via WebSocket.

> **Important** : pour le support WebSocket, installer un backend compatible :
> ```bash
> pip install 'uvicorn[standard]'
> # ou
> pip install websockets
> ```

Reprise de session : à l'actualisation, la save multijoueur est restaurée automatiquement depuis SQLite.

---

## Données

Le projet utilise les datasets publics d'Oracle's Elixir :
- `2025_LoL_esports_match_data_from_OraclesElixir.csv` (~76 MB)
- `2026_LoL_esports_match_data_from_OraclesElixir.csv` (~19 MB)

**Ne pas modifier** ces fichiers — ils servent de source de vérité pour les rosters, métas et stats historiques.

---

## Développement

Voir [CLAUDE.md](CLAUDE.md) pour :
- Conventions de code (immutabilité, taille des fichiers, cleanup React)
- Zones fragiles connues (`server.py`, simulation, sauvegardes atomiques)
- Règles d'édition prudente sur les gros fichiers
- Style de réponse et workflow attendu

### Commandes utiles

```bash
# Tests backend
cd backend && pytest

# Build frontend
cd frontend && npm run build
```

---

## Licence

Projet personnel. Données Oracle's Elixir © leurs auteurs respectifs.
