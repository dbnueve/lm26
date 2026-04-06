# ⚡ LM — Esports Manager

> Une application web fullstack de gestion d'équipe esports, avec système de draft, simulation de matchs et négociations de transferts. Interface "Control Room" dark/neon.

---

## 📋 Table des matières

- [Aperçu](#aperçu)
- [Stack technique](#stack-technique)
- [Structure du projet](#structure-du-projet)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Lancement](#lancement)
- [Fonctionnalités](#fonctionnalités)
- [Design System](#design-system)


---

## Aperçu

**LM** est un simulateur de management d'équipe esports pensé pour les amateurs de League of Legends et titres similaires. L'application permet de gérer un roster de joueurs, d'orchestrer des sessions de draft (système Fearless Draft), de simuler des matchs en temps réel et de négocier des transferts.

L'interface s'inspire des salles de contrôle professionnelles : densité maximale d'information, thème sombre navy/neon, typographie condensée et accents lumineux.

---

## Stack technique

### Backend
- **Python** (FastAPI ou Flask)
- API RESTful avec gestion de matchs, joueurs et équipes

### Frontend
- **React** (JavaScript `.jsx`)
- **Tailwind CSS** pour le styling
- **Shadcn UI** avec surcharges de style (border-radius réduit à 0–2px)
- **Phosphor Icons** (`@phosphor-icons/react`) pour des icônes au look esports
- **Yarn** comme gestionnaire de paquets

---

## Structure du projet

```
lm/
├── backend/              # Serveur Python (API)
├── frontend/             # Application React
│   └── src/
│       └── components/   # Composants React (.js / .jsx)
├── memory/               # Persistance d'état entre sessions
├── tests/                # Tests automatisés
└── yarn.lock
```

---

## Prérequis

- **Node.js** >= 18 et **Yarn**
- **Python** >= 3.10 et **pip**

---

## Installation

### Backend

```bash
cd backend
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
yarn install
yarn add @phosphor-icons/react
```

---

## Lancement

### Démarrer le backend

```bash
cd backend
python server.py
# L'API tourne sur http://localhost:8001 (ou le port configuré)
```

### Démarrer le frontend

```bash
cd frontend
yarn start
# L'interface est accessible sur http://localhost:3000
```

---

## Fonctionnalités

### 🏆 Gestion du roster
Visualisation et gestion de l'équipe avec cartes joueurs en clip-path hexagonal. Chaque fiche affiche les stats clés, le salaire et le rôle.

### 🎯 Système de Draft 
Interface interactive en grille. Les picks sont affichés avec des bordures or/bleu, les bans apparaissent en portraits hexagonaux grisés avec croix rouge.

### ⚔️ Simulation de matchs
Disposition "Control Room" : graphiques principaux en `col-span-2`, log d'événements latéral. Timeline horizontale segmentée (bleu = événements alliés, rouge = ennemis).

### 💼 Négociations de transferts
Dialogues Shadcn avec sliders de salaire et champs de clauses personnalisées. Gestion des offres entrantes et sortantes.

---

## Design System

Le fichier `design_guidelines.json` centralise tous les tokens visuels.

| Token | Valeur |
|---|---|
| Background | `#050814` |
| Surface | `#0B1224` |
| Primary | `#0A84FF` |
| Secondary (gold) | `#FFB800` |
| Danger | `#FF3366` |
| Success | `#00E676` |
| Font titres | Barlow Condensed |
| Font body | Manrope |
| Font stats | Rajdhani |

Effets visuels : grille hexagonale en SVG (opacité 3%), glows sur les éléments actifs, portraits joueurs en clip-path hexagonal.

---


## Licence

Ce projet est open source. Voir le fichier `LICENSE` pour les détails.