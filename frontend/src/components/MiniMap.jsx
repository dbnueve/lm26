import React, { useMemo, useState } from "react";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import { parseSec, KILL_TYPES } from "./timelineHelpers";
import mapBg from "./lol_map.jpg";

/* ═══════════════════════════════════════════════════════════════
   VITESSE DE DÉPLACEMENT
   LoL map ≈ 14500 unités. Champion base speed ≈ 340 u/s.
   340/14500 ≈ 2.34% de la carte par seconde.
   On réduit à ~0.32%/s pour coller à l'échelle visuelle minimap.
═══════════════════════════════════════════════════════════════ */
const SPEED = 0.32; // %/s

/* ═══════════════════════════════════════════════════════════════
   POSITIONS CLÉS — calibrées sur la carte fournie
   Origine : haut-gauche (0,0) → bas-droit (100,100)

   Repères visuels identifiés sur l'image :
   - Spawn Blue  : bas-gauche, zone grise ~(8, 87)
   - Spawn Red   : haut-droit, zone grise ~(92, 9)
   - Baron Pit   : haut-gauche rivière ~(24, 32)
   - Drake Pit   : bas-droite rivière  ~(74, 68)
   - Top lane    : longe le bord gauche/haut
   - Bot lane    : longe le bord droit/bas
   - Mid lane    : diagonale centre
═══════════════════════════════════════════════════════════════ */
const POS = {
  // ── Spawns ──
  spawn_blue: { x: 8,  y: 87 },
  spawn_red:  { x: 92, y: 10 },

  // ── Objectifs majeurs ──
  baron:      { x: 24, y: 32 },  // fosse Baron (haut-gauche rivière)
  herald:     { x: 24, y: 32 },  // même fosse avant 20min
  drake:      { x: 74, y: 68 },  // fosse Drake (bas-droite rivière)
  elder:      { x: 74, y: 68 },

  // ── Scuttles (rivière) ──
  scuttle_top: { x: 38, y: 44 }, // crabe rivière top-mid
  scuttle_bot: { x: 62, y: 56 }, // crabe rivière bot-mid

  // ── Top lane — jalons (côté blue = longe bord gauche vers haut) ──
  blue_top_base:   { x: 12, y: 80 }, // sortie de base vers top
  blue_top_t2:     { x: 14, y: 58 }, // entre t2 et t1
  blue_top_t1:     { x: 15, y: 43 }, // tour T1 top blue
  blue_top_mid:    { x: 17, y: 30 }, // milieu top lane
  blue_top_push:   { x: 20, y: 18 }, // sous tour T1 rouge top

  red_top_base:    { x: 88, y: 20 }, // sortie base rouge vers top
  red_top_t2:      { x: 60, y: 13 }, // entre t2 t1 rouge top
  red_top_t1:      { x: 44, y: 13 }, // tour T1 top rouge
  red_top_mid:     { x: 32, y: 14 },
  red_top_push:    { x: 22, y: 15 }, // sous tour T1 blue top

  // ── Mid lane ──
  blue_mid_base:   { x: 18, y: 82 }, // sortie base bleue vers mid
  blue_mid_t1:     { x: 36, y: 64 }, // tour mid T1 blue
  blue_mid_center: { x: 50, y: 50 }, // centre mid
  blue_mid_push:   { x: 62, y: 38 }, // sous tour mid rouge

  red_mid_base:    { x: 82, y: 18 },
  red_mid_t1:      { x: 64, y: 36 },
  red_mid_center:  { x: 50, y: 50 },
  red_mid_push:    { x: 38, y: 62 },

  // ── Bot lane — jalons (côté blue = longe bord bas vers droite) ──
  blue_bot_base:   { x: 20, y: 88 }, // sortie base bleue vers bot
  blue_bot_t2:     { x: 52, y: 88 }, // entre t2 t1 bot blue
  blue_bot_t1:     { x: 58, y: 87 }, // tour bot T1 blue
  blue_bot_mid:    { x: 72, y: 84 }, // milieu bot lane
  blue_bot_push:   { x: 84, y: 75 }, // sous tour T1 rouge bot

  red_bot_base:    { x: 80, y: 12 },
  red_bot_t2:      { x: 85, y: 55 },
  red_bot_t1:      { x: 87, y: 57 },
  red_bot_mid:     { x: 85, y: 70 },
  red_bot_push:    { x: 75, y: 82 }, // sous tour T1 bleue bot

  // ── Jungle Blue (quadrant bas-gauche) ──
  blue_gromp:    { x: 16, y: 73 },
  blue_bluebuff: { x: 24, y: 64 },
  blue_wolves:   { x: 28, y: 55 },
  blue_raptors:  { x: 33, y: 63 },
  blue_redbuff:  { x: 31, y: 72 },
  blue_krugs:    { x: 37, y: 79 },

  // ── Jungle Red (quadrant haut-droit) ──
  red_gromp:    { x: 84, y: 27 },
  red_bluebuff: { x: 76, y: 36 },
  red_wolves:   { x: 72, y: 45 },
  red_raptors:  { x: 67, y: 37 },
  red_redbuff:  { x: 69, y: 28 },
  red_krugs:    { x: 63, y: 21 },

  // ── Zones de regroupement ──
  mid_river_blue: { x: 44, y: 56 }, // rivière côté blue mid
  mid_river_red:  { x: 56, y: 44 }, // rivière côté red mid
};

/* ═══════════════════════════════════════════════════════════════
   COORDONNÉES DES ÉVÉNEMENTS sur la carte
═══════════════════════════════════════════════════════════════ */
const EVENT_COORDS = {
  drake:    POS.drake,
  elder:    POS.elder,
  baron:    POS.baron,
  herald:   POS.herald,
  mid_lane: POS.blue_mid_center,

  blue_tower_top_t1: POS.blue_top_t1,
  blue_tower_top_t2: POS.blue_top_t2,
  blue_tower_mid_t1: POS.blue_mid_t1,
  blue_tower_bot_t1: POS.blue_bot_t1,
  blue_inhib_top:    { x: 13, y: 78 },
  blue_inhib_mid:    { x: 22, y: 79 },
  blue_inhib_bot:    { x: 23, y: 88 },

  red_tower_top_t1:  POS.red_top_t1,
  red_tower_top_t2:  POS.red_top_t2,
  red_tower_mid_t1:  POS.red_mid_t1,
  red_tower_bot_t1:  POS.red_bot_t1,
  red_inhib_top:     { x: 77, y: 13 },
  red_inhib_mid:     { x: 78, y: 22 },
  red_inhib_bot:     { x: 87, y: 23 },

  spawn_blue: POS.spawn_blue,
  spawn_red:  POS.spawn_red,
};

const EVENT_ICONS = {
  kill:        "⚔️",
  first_blood: "🩸",
  drake:       "🐉",
  elder:       "🟣",
  baron:       "👑",
  herald:      "🔮",
  tower:       "🏯",
  first_tower: "🏯",
  inhibitor:   "💠",
  game_end:    "🏆",
};

const EVENT_PING_COLOR = {
  kill:        "#ef4444",
  first_blood: "#dc2626",
  drake:       "#f97316",
  elder:       "#a855f7",
  baron:       "#eab308",
  herald:      "#6366f1",
  tower:       "#94a3b8",
  first_tower: "#64748b",
  inhibitor:   "#22d3ee",
  game_end:    "#facc15",
};

const ROLE_LABELS = ["TOP", "JGL", "MID", "BOT", "SUP"];
const MAJOR_OBJECTIVES = new Set(["drake", "baron", "elder", "herald"]);
const TOWER_EVENTS     = new Set(["tower", "first_tower", "inhibitor"]);

/* ═══════════════════════════════════════════════════════════════
   ROUTES DE JUNGLE avec durée réaliste par camp
═══════════════════════════════════════════════════════════════ */
const JUNGLE_BLUE_ROUTE = [
  { pos: POS.blue_gromp,    dur: 22, travel: 5 },
  { pos: POS.blue_bluebuff, dur: 20, travel: 4 },
  { pos: POS.blue_wolves,   dur: 14, travel: 4 },
  { pos: POS.blue_raptors,  dur: 20, travel: 5 },
  { pos: POS.blue_redbuff,  dur: 20, travel: 4 },
  { pos: POS.blue_krugs,    dur: 26, travel: 6 },
];

const JUNGLE_RED_ROUTE = [
  { pos: POS.red_gromp,    dur: 22, travel: 5 },
  { pos: POS.red_bluebuff, dur: 20, travel: 4 },
  { pos: POS.red_wolves,   dur: 14, travel: 4 },
  { pos: POS.red_raptors,  dur: 20, travel: 5 },
  { pos: POS.red_redbuff,  dur: 20, travel: 4 },
  { pos: POS.red_krugs,    dur: 26, travel: 6 },
];

/* ═══════════════════════════════════════════════════════════════
   UTILITAIRES
═══════════════════════════════════════════════════════════════ */
function getEventCoords(item) {
  if (item.x != null && item.y != null) return { x: item.x, y: item.y };
  if (EVENT_COORDS[item.type]) return EVENT_COORDS[item.type];

  const desc   = (item.description || "").toLowerCase();
  const isBlue = item.team === 1 || item.team === 100;
  const side   = isBlue ? "blue" : "red";

  if (item.type === "tower" || item.type === "first_tower") {
    if (desc.includes("top") || desc.includes("haut")) return EVENT_COORDS[`${side}_tower_top_t1`] ?? POS.blue_mid_center;
    if (desc.includes("bot") || desc.includes("bas"))  return EVENT_COORDS[`${side}_tower_bot_t1`] ?? POS.blue_mid_center;
    return EVENT_COORDS[`${side}_tower_mid_t1`] ?? POS.blue_mid_center;
  }
  if (item.type === "inhibitor") {
    if (desc.includes("top") || desc.includes("haut")) return EVENT_COORDS[`${side}_inhib_top`];
    if (desc.includes("bot") || desc.includes("bas"))  return EVENT_COORDS[`${side}_inhib_bot`];
    return EVENT_COORDS[`${side}_inhib_mid`];
  }
  if (item.type === "game_end") return isBlue ? EVENT_COORDS.spawn_red : EVENT_COORDS.spawn_blue;
  return POS.blue_mid_center;
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function moveTowards(cur, tgt, speed, dt) {
  const d = dist(cur, tgt);
  const step = speed * dt;
  if (d <= step || d === 0) return { ...tgt };
  return {
    x: cur.x + (tgt.x - cur.x) * (step / d),
    y: cur.y + (tgt.y - cur.y) * (step / d),
  };
}

function calcDeathTimer(deathSec) {
  const min = deathSec / 60;
  let t = 10;
  if (min >= 45) t = 58 + Math.floor((min - 45) * 2.5);
  else if (min >= 30) t = 28 + Math.floor((min - 30) * 2.0);
  else if (min >= 15) t = 10 + Math.floor((min - 15) * 1.2);
  return Math.min(t, 90);
}

/* ═══════════════════════════════════════════════════════════════
   CALCUL DU TEMPS DE TRAJET entre deux points
   Utilisé pour l'anticipation des déplacements.
═══════════════════════════════════════════════════════════════ */
function travelTime(from, to) {
  return dist(from, to) / SPEED;
}

/* ═══════════════════════════════════════════════════════════════
   PRÉ-CALCUL : TIMELINE D'ÉVÉNEMENTS ENRICHIE
   Pour chaque événement majeur, on calcule quand chaque rôle
   doit commencer à se déplacer pour arriver à temps.

   Logique LoL réaliste :
   - L'objectif "se forme" (respawn timer) ~5 min avant d'être pris
   - Les champions commencent à se regrouper ~45-90s avant l'objectif
   - Le délai dépend de la distance de chaque joueur à l'objectif
═══════════════════════════════════════════════════════════════ */
function buildObjectiveTimeline(enrichedEvents) {
  return enrichedEvents
    .filter(ev => MAJOR_OBJECTIVES.has(ev.type))
    .map(ev => ({
      ...ev,
      sec: parseSec(ev.time),
      dest: { x: ev.mapX, y: ev.mapY },
    }));
}

/* ═══════════════════════════════════════════════════════════════
   DESTINATION CIBLE pour un rôle à un instant t
   Prend en compte l'anticipation des objectifs futurs proches.
═══════════════════════════════════════════════════════════════ */
function getTargetPos(roleIndex, currentSec, isBlue, enrichedEvents, allDeaths, objectiveTimeline) {
  const gameMin = currentSec / 60;
  const spawn   = isBlue ? POS.spawn_blue : POS.spawn_red;

  // ── Mort → base ──
  const dying = allDeaths.find(d => currentSec >= d.deathSec && currentSec < d.respawnSec);
  if (dying) return spawn;

  // ── Post-respawn : reste en base ~7s (animation de respawn + début déplacement) ──
  const freshRespawn = allDeaths.find(d => currentSec >= d.respawnSec && currentSec < d.respawnSec + 7);
  if (freshRespawn) return spawn;

  /* ──────────────────────────────────────────────────────────
     ANTICIPATION DES OBJECTIFS
     On cherche le prochain objectif majeur dans les 120s.
     Si le champion doit partir maintenant pour y arriver à temps,
     on lui donne l'objectif comme destination.
  ────────────────────────────────────────────────────────── */
  const upcomingObjective = objectiveTimeline.find(obj => {
    if (obj.sec <= currentSec) return false; // déjà passé
    const timeUntil = obj.sec - currentSec;
    // Fenêtre d'anticipation : 90s + temps de trajet estimé depuis la zone mid
    const anticipationWindow = 90;
    return timeUntil <= anticipationWindow;
  });

  // ── JUNGLER ──
  if (roleIndex === 1) {
    // Objectif passé récemment (< 25s) → le jungler est encore dans la zone
    const recentObj = objectiveTimeline.find(obj => {
      const age = currentSec - obj.sec;
      return age >= 0 && age < 25;
    });
    if (recentObj) return recentObj.dest;

    // Objectif à venir proche → se déplacer vers l'objectif
    if (upcomingObjective) return upcomingObjective.dest;

    // Sinon → route de jungle cyclique (démarre à 1:40)
    const JUNGLE_START = 100;
    if (currentSec < JUNGLE_START) return spawn;

    const route = isBlue ? JUNGLE_BLUE_ROUTE : JUNGLE_RED_ROUTE;
    const totalCycle = route.reduce((s, c) => s + c.dur + c.travel, 0);
    const elapsed = (currentSec - JUNGLE_START) % totalCycle;

    let acc = 0;
    for (let i = 0; i < route.length; i++) {
      const campEnd = acc + route[i].dur;
      const travelEnd = campEnd + route[i].travel;
      if (elapsed < campEnd) return route[i].pos;
      if (elapsed < travelEnd) return route[(i + 1) % route.length].pos;
      acc = travelEnd;
    }
    return route[0].pos;
  }

  // ── LANERS (TOP=0, MID=2, BOT=3, SUP=4) ──

  // Positions de lane par rôle
  const LANE_DEST = {
    0: isBlue ? POS.blue_top_mid  : POS.red_top_mid,
    2: isBlue ? POS.blue_mid_center : POS.red_mid_center,
    3: isBlue ? POS.blue_bot_mid  : POS.red_bot_mid,
    4: isBlue ? POS.blue_bot_mid  : POS.red_bot_mid,
  };
  const LANE_PUSH = {
    0: isBlue ? POS.blue_top_push : POS.red_top_push,
    2: isBlue ? POS.blue_mid_push : POS.red_mid_push,
    3: isBlue ? POS.blue_bot_push : POS.red_bot_push,
    4: isBlue ? POS.blue_bot_push : POS.red_bot_push,
  };

  // ── PHASE LANING (< 14 min) ──
  if (gameMin < 14) {
    const dest   = LANE_DEST[roleIndex]  ?? POS.blue_mid_center;
    const pushed = LANE_PUSH[roleIndex]  ?? POS.blue_mid_center;

    // Cycle : 3min push progressif + 1min recall
    const CYCLE    = 240;
    const PUSH_DUR = 175;
    const phase = currentSec % CYCLE;

    if (phase < PUSH_DUR) {
      const t = Math.min(phase / PUSH_DUR, 1);
      const smooth = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      return {
        x: dest.x + (pushed.x - dest.x) * smooth,
        y: dest.y + (pushed.y - dest.y) * smooth,
      };
    }
    return spawn; // recall
  }

  // ── MID/LATE GAME ──

  // Objectif passé récemment → champion encore autour
  const recentObj = objectiveTimeline.find(obj => {
    const age = currentSec - obj.sec;
    return age >= 0 && age < 30;
  });

  if (recentObj) {
    const isMajor = MAJOR_OBJECTIVES.has(recentObj.type);
    if (isMajor) {
      // Top reste en split en général, sauf s'il était déjà en route
      if (roleIndex === 0) return isBlue ? POS.blue_top_push : POS.red_top_push;
      // Mid : souvent en side-lane opposée
      if (roleIndex === 2) return isBlue ? POS.blue_bot_push : POS.red_bot_push;
      return recentObj.dest;
    }
  }

  // Objectif à venir → se déplacer vers l'objectif
  if (upcomingObjective) {
    const isMajor = MAJOR_OBJECTIVES.has(upcomingObjective.type);
    if (isMajor) {
      if (roleIndex === 0) return isBlue ? POS.blue_top_push : POS.red_top_push;
      if (roleIndex === 2) return isBlue ? POS.blue_bot_push : POS.red_bot_push;
      return upcomingObjective.dest;
    }
  }

  // Événement tour/inhibiteur récent
  const recentTowerEv = [...enrichedEvents].reverse().find(ev => {
    const evSec = parseSec(ev.time);
    const age = currentSec - evSec;
    return age >= 0 && age < 35 && TOWER_EVENTS.has(ev.type);
  });

  if (recentTowerEv) {
    const desc = (recentTowerEv.description || "").toLowerCase();
    const isTop = desc.includes("top") || desc.includes("haut");
    const isBot = desc.includes("bot") || desc.includes("bas");
    const evPos = { x: recentTowerEv.mapX, y: recentTowerEv.mapY };
    if (isTop && roleIndex === 0) return evPos;
    if (isBot && (roleIndex === 3 || roleIndex === 4)) return evPos;
    return POS.blue_mid_center; // les autres convergent mid
  }

  // Comportement par défaut : pression de lane
  if (roleIndex === 0) return isBlue ? POS.blue_top_push  : POS.red_top_push;
  if (roleIndex === 2) {
    // Mid alterne entre mid et side-lane toutes les 3min
    const sidePhase = Math.floor(gameMin / 3) % 2;
    return sidePhase === 1
      ? (isBlue ? POS.blue_bot_push : POS.red_bot_push)
      : POS.blue_mid_center;
  }
  if (roleIndex === 3 || roleIndex === 4) {
    // Botlane : pression bot ou regroupement mid
    const phase = Math.floor(gameMin / 4) % 3;
    return phase === 0
      ? (isBlue ? POS.blue_bot_push : POS.red_bot_push)
      : POS.blue_mid_center;
  }

  return POS.blue_mid_center;
}

/* ═══════════════════════════════════════════════════════════════
   SIMULATION PAS-À-PAS — moteur de position physique
   On simule second par second depuis t=0.
   Chaque champion se déplace physiquement vers sa cible
   à vitesse constante, exactement comme sur la minimap LoL.
═══════════════════════════════════════════════════════════════ */
function simulatePos(roleIndex, matchSec, isBlue, enrichedEvents, allDeaths, objectiveTimeline) {
  const spawn = isBlue ? POS.spawn_blue : POS.spawn_red;
  let pos = { ...spawn };
  const steps = Math.floor(matchSec);

  for (let t = 0; t <= steps; t++) {
    // Mort instantanée → téléporte à la base
    const isDyingNow = allDeaths.some(d => t >= d.deathSec && t < d.deathSec + 1);
    if (isDyingNow) {
      pos = { ...spawn };
      continue;
    }

    const target = getTargetPos(roleIndex, t, isBlue, enrichedEvents, allDeaths, objectiveTimeline);
    pos = moveTowards(pos, target, SPEED, 1);
  }

  // Interpolation sub-seconde pour la frame courante
  const subDt = matchSec - steps;
  if (subDt > 0) {
    const target = getTargetPos(roleIndex, matchSec, isBlue, enrichedEvents, allDeaths, objectiveTimeline);
    pos = moveTowards(pos, target, SPEED, subDt);
  }

  // Micro-jitter organique très discret
  const seed = (roleIndex + 1) * 137.5 + (isBlue ? 0 : 73);
  return {
    x: Math.max(2, Math.min(98, pos.x + Math.sin(seed + matchSec * 0.09) * 0.8)),
    y: Math.max(2, Math.min(98, pos.y + Math.cos(seed + matchSec * 0.07) * 0.8)),
  };
}

/* ═══════════════════════════════════════════════════════════════
   COMPOSANT PING
═══════════════════════════════════════════════════════════════ */
function PingEffect({ x, y, size, color, id }) {
  return (
    <>
      <div style={{
        position: "absolute",
        left: `${x}%`, top: `${y}%`,
        transform: "translate(-50%, -50%)",
        width: size * 0.38, height: size * 0.38,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        animation: "pingExpand 1.6s ease-out forwards",
        pointerEvents: "none", zIndex: 20,
      }} />
      <div style={{
        position: "absolute",
        left: `${x}%`, top: `${y}%`,
        transform: "translate(-50%, -50%)",
        width: size * 0.18, height: size * 0.18,
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        animation: "pingExpand 1.6s ease-out 0.25s forwards",
        pointerEvents: "none", zIndex: 20,
      }} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COMPOSANT CHAMPION AVATAR
═══════════════════════════════════════════════════════════════ */
function ChampionAvatar({
  player, roleIndex, isBlue, matchSec,
  deathData, allDeaths, enrichedEvents, objectiveTimeline,
  size, iconSize,
}) {
  const [hovered, setHovered] = useState(false);

  // Recalcul à 2 fps pour la perf (arrondi à 0.5s)
  const pos = useMemo(
    () => simulatePos(roleIndex, matchSec, isBlue, enrichedEvents, allDeaths, objectiveTimeline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleIndex, Math.round(matchSec * 2) / 2, isBlue, enrichedEvents, allDeaths, objectiveTimeline]
  );

  const ddKey     = toDDragonKey(player.champion || "");
  const isDead    = deathData && matchSec >= deathData.deathSec && matchSec < deathData.respawnSec;
  const remainSec = isDead ? Math.ceil(deathData.respawnSec - matchSec) : 0;
  const totalTimer = isDead ? Math.max(1, calcDeathTimer(deathData.deathSec)) : 1;
  const timerPct  = isDead ? remainSec / totalTimer : 0;

  const displayPos = isDead ? (isBlue ? POS.spawn_blue : POS.spawn_red) : pos;
  const px = (displayPos.x / 100) * size - iconSize / 2;
  const py = (displayPos.y / 100) * size - iconSize / 2;

  const ring    = isBlue ? "#3b82f6" : "#ef4444";
  const arcR    = iconSize / 2 + 3;
  const arcC    = 2 * Math.PI * arcR;
  const arcDash = arcC * timerPct;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        top: 0, left: 0,
        transform: `translate(${px}px, ${py}px)`,
        width: iconSize, height: iconSize,
        transition: isDead
          ? "transform 0s, opacity 0.3s 0.15s"
          : "transform 0.5s linear, opacity 0.3s",
        zIndex: hovered ? 50 : 10,
        cursor: "pointer",
        pointerEvents: "auto",
      }}
    >
      {/* Arc timer mort */}
      {isDead && (
        <svg style={{
          position: "absolute",
          top: -(arcR - iconSize / 2) - 1,
          left: -(arcR - iconSize / 2) - 1,
          width: arcR * 2 + 2, height: arcR * 2 + 2,
          pointerEvents: "none", zIndex: 12,
        }}
          viewBox={`0 0 ${arcR * 2 + 2} ${arcR * 2 + 2}`}
        >
          <circle cx={arcR + 1} cy={arcR + 1} r={arcR}
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
          <circle cx={arcR + 1} cy={arcR + 1} r={arcR}
            fill="none"
            stroke={remainSec <= 5 ? "#fbbf24" : "#ef4444"}
            strokeWidth="2"
            strokeDasharray={`${arcDash} ${arcC}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${arcR + 1} ${arcR + 1})`}
          />
        </svg>
      )}

      {/* Anneau équipe */}
      <div style={{
        position: "absolute", inset: -2,
        borderRadius: "50%",
        border: `2px solid ${isDead ? "rgba(255,255,255,0.07)" : ring}`,
        boxShadow: isDead ? "none"
          : hovered ? `0 0 10px ${ring}, 0 0 18px ${ring}44`
          : `0 0 5px ${ring}88`,
        pointerEvents: "none",
        transition: "box-shadow 0.3s",
      }} />

      {/* Avatar champion */}
      <img
        src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${ddKey}.png`}
        alt={player.champion}
        style={{
          width: "100%", height: "100%",
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          filter: isDead ? "grayscale(1) brightness(0.18)" : "none",
          transition: "filter 0.4s",
        }}
        onError={e => { e.currentTarget.style.display = "none"; }}
      />

      {/* Timer de mort */}
      {isDead && (
        <div style={{
          position: "absolute", inset: 0,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.8)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontSize: Math.max(6, iconSize * 0.36),
            fontFamily: "'Courier New', monospace",
            fontWeight: 900,
            color: remainSec <= 5 ? "#fbbf24" : "#ef4444",
            lineHeight: 1,
            animation: remainSec <= 5 ? "urgentPulse 0.6s ease-in-out infinite" : "none",
          }}>
            {remainSec}
          </span>
        </div>
      )}

      {/* Tooltip survol */}
      {hovered && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(3,7,18,0.95)",
          border: `1px solid ${ring}44`,
          borderRadius: 4,
          padding: "3px 7px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 100,
          backdropFilter: "blur(6px)",
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: ring, letterSpacing: 0.5 }}>
            {ROLE_LABELS[roleIndex]}
          </div>
          <div style={{ fontSize: 8, color: "#e2e8f0", marginTop: 1 }}>
            {player.player_name}
          </div>
          <div style={{ fontSize: 8, color: "#64748b" }}>
            {player.champion}
          </div>
          {isDead && (
            <div style={{ fontSize: 8, color: "#ef4444", marginTop: 1 }}>
              ☠ {remainSec}s
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WRAPPER : flash de mort + respawn propre
═══════════════════════════════════════════════════════════════ */
function ChampionWithFade(props) {
  const { matchSec, deathData } = props;
  // Flash invisible 0.3s juste après la mort pour éviter le glissement visuel
  const justDied = deathData &&
    matchSec >= deathData.deathSec &&
    matchSec < deathData.deathSec + 0.3;

  return (
    <div style={{
      position: "absolute", inset: 0,
      pointerEvents: "none",
      opacity: justDied ? 0 : 1,
      transition: justDied ? "opacity 0s" : "opacity 0.25s",
    }}>
      <ChampionAvatar {...props} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONSTANTES OBJECTIFS (timings LoL)
═══════════════════════════════════════════════════════════════ */
const HERALD_SPAWN_SEC   = 8 * 60;   // 8:00
const HERALD_DESPAWN_SEC = 19 * 60 + 45; // ~19:45
const DRAKE_FIRST_SEC    = 5 * 60;   // 5:00
const DRAKE_RESPAWN_SEC  = 5 * 60;   // 5 min
const BARON_SPAWN_SEC    = 25 * 60;  // 25:00
const BARON_RESPAWN_SEC  = 6 * 60;   // 6 min
const ELDER_SPAWN_SEC    = 35 * 60;  // 35:00 (après 4 drakes)

function nextRespawn(lastTakenSec, respawnDur, firstSpawn, matchSec) {
  if (lastTakenSec == null) {
    // Pas encore pris
    return matchSec < firstSpawn ? firstSpawn : null; // null = disponible maintenant
  }
  const next = lastTakenSec + respawnDur;
  return matchSec < next ? next : null;
}

function fmtCountdown(sec) {
  if (sec == null) return "UP";
  const remain = Math.max(0, Math.round(sec));
  const m = Math.floor(remain / 60);
  const s = remain % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ═══════════════════════════════════════════════════════════════
   OBJECTIVE TRACKER — carte des prochains spawns
═══════════════════════════════════════════════════════════════ */
export function ObjectiveTracker({ events = [], matchSec = 0 }) {
  const state = useMemo(() => {
    const sorted = [...events].sort((a, b) => parseSec(a.time) - parseSec(b.time));
    const last = { drake: null, elder: null, baron: null, herald: null };
    const count = { drake: 0, elder: 0, baron: 0, herald: 0 };
    sorted.forEach(ev => {
      if (parseSec(ev.time) > matchSec) return;
      if (ev.type in last) {
        last[ev.type] = parseSec(ev.time);
        count[ev.type] += 1;
      }
    });
    return { last, count };
  }, [events, matchSec]);

  const totalDrakes = state.count.drake + state.count.elder;
  const elderUnlocked = totalDrakes >= 4 && matchSec >= ELDER_SPAWN_SEC;
  const drakeTarget = elderUnlocked ? "elder" : "drake";
  const drakeNext = drakeTarget === "elder"
    ? nextRespawn(state.last.elder, DRAKE_RESPAWN_SEC, ELDER_SPAWN_SEC, matchSec)
    : nextRespawn(state.last.drake, DRAKE_RESPAWN_SEC, DRAKE_FIRST_SEC, matchSec);

  const heraldActive = matchSec < HERALD_DESPAWN_SEC;
  const heraldNext = heraldActive
    ? nextRespawn(state.last.herald, DRAKE_RESPAWN_SEC, HERALD_SPAWN_SEC, matchSec)
    : "GONE";

  const baronAvail = matchSec >= BARON_SPAWN_SEC && !heraldActive;
  const baronNext = baronAvail
    ? nextRespawn(state.last.baron, BARON_RESPAWN_SEC, BARON_SPAWN_SEC, matchSec)
    : (matchSec < BARON_SPAWN_SEC ? BARON_SPAWN_SEC - matchSec + matchSec : null);

  const Pill = ({ icon, label, value, color, dim }) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "4px 8px", borderRadius: 4,
      background: "rgba(2,6,23,0.82)",
      border: `1px solid ${dim ? "rgba(255,255,255,0.06)" : color + "55"}`,
      boxShadow: dim ? "none" : `0 0 10px ${color}22, inset 0 0 0 1px ${color}18`,
      opacity: dim ? 0.45 : 1,
      minWidth: 62,
    }}>
      <span style={{ fontSize: 13, lineHeight: 1, filter: dim ? "grayscale(1)" : "none" }}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.8, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>{label}</span>
        <span style={{
          fontSize: 11, fontWeight: 800, fontFamily: "'Chakra Petch', 'Courier New', monospace",
          color: value === "UP" ? color : "var(--text-1, #f8fafc)",
          fontVariantNumeric: "tabular-nums",
          textShadow: value === "UP" ? `0 0 6px ${color}` : "none",
        }}>
          {value === "UP" ? "UP" : value === "GONE" ? "—" : fmtCountdown(value - matchSec)}
        </span>
      </div>
    </div>
  );

  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "center", justifyContent: "center",
      padding: "4px 0",
    }}>
      <Pill
        icon="🔮"
        label="Herald"
        value={heraldActive ? heraldNext : "GONE"}
        color="#6366f1"
        dim={!heraldActive}
      />
      <Pill
        icon={drakeTarget === "elder" ? "🟣" : "🐉"}
        label={drakeTarget === "elder" ? "Elder" : "Drake"}
        value={drakeNext}
        color={drakeTarget === "elder" ? "#a855f7" : "#f97316"}
      />
      <Pill
        icon="👑"
        label="Baron"
        value={matchSec < BARON_SPAWN_SEC ? BARON_SPAWN_SEC : baronNext}
        color="#eab308"
        dim={!baronAvail && matchSec < BARON_SPAWN_SEC - 30}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OBJECTIVE SCOREBOARD — pile d'icônes (tours, drakes, inhibs)
═══════════════════════════════════════════════════════════════ */
export function ObjectiveScoreboard({ events = [], teamNum = 1, side = "left" }) {
  const data = useMemo(() => {
    const towers = [], drakes = [], inhibs = [];
    let baron = 0, herald = 0, elder = 0;
    events.forEach(ev => {
      if (ev.team !== teamNum) return;
      if (ev.type === "tower" || ev.type === "first_tower") towers.push(ev);
      else if (ev.type === "drake") drakes.push(ev);
      else if (ev.type === "elder") elder += 1;
      else if (ev.type === "inhibitor") inhibs.push(ev);
      else if (ev.type === "baron") baron += 1;
      else if (ev.type === "herald") herald += 1;
    });
    return { towers, drakes, inhibs, baron, herald, elder };
  }, [events, teamNum]);

  const color = teamNum === 1 ? "#3b82f6" : "#ef4444";
  const align = side === "left" ? "flex-end" : "flex-start";

  const Row = ({ icon, count, max, filledColor, title, showItems }) => (
    <div
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        justifyContent: align, flexDirection: side === "left" ? "row-reverse" : "row",
      }}
    >
      <span style={{ fontSize: 11, lineHeight: 1 }}>{icon}</span>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: 1,
            background: i < count ? filledColor : "rgba(255,255,255,0.08)",
            border: `1px solid ${i < count ? filledColor : "rgba(255,255,255,0.12)"}`,
            boxShadow: i < count ? `0 0 4px ${filledColor}88` : "none",
          }} />
        ))}
      </div>
    </div>
  );

  const DrakeIcons = () => {
    const items = [...data.drakes];
    if (data.elder > 0) items.push({ type: "elder" });
    if (!items.length) return null;
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 3,
        justifyContent: align, flexDirection: side === "left" ? "row-reverse" : "row",
        flexWrap: "wrap", maxWidth: 70,
      }}>
        {items.map((d, i) => {
          const desc = (d.description || "").toLowerCase();
          let icon = "🐉";
          if (d.type === "elder" || desc.includes("elder")) icon = "🟣";
          else if (desc.includes("infernal")) icon = "🔥";
          else if (desc.includes("mountain")) icon = "🪨";
          else if (desc.includes("ocean"))    icon = "🌊";
          else if (desc.includes("cloud"))    icon = "💨";
          else if (desc.includes("hextech"))  icon = "⚡";
          else if (desc.includes("chemtech")) icon = "☣️";
          return (
            <span key={i} style={{
              fontSize: 13, lineHeight: 1,
              filter: `drop-shadow(0 0 3px ${color}aa)`,
            }}>
              {icon}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      padding: "8px 10px",
      minWidth: 100,
      background: "linear-gradient(180deg, rgba(2,6,23,0.88), rgba(2,6,23,0.72))",
      border: `1px solid ${color}33`,
      borderRadius: 6,
      boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.03), 0 4px 18px rgba(0,0,0,0.6)`,
      alignItems: align,
    }}>
      <Row
        icon="🏯"
        count={data.towers.length}
        max={11}
        filledColor={color}
        title={`${data.towers.length} / 11 tours`}
      />
      <Row
        icon="💠"
        count={data.inhibs.length}
        max={3}
        filledColor="#22d3ee"
        title={`${data.inhibs.length} / 3 inhibiteurs`}
      />
      <DrakeIcons />
      {(data.baron > 0 || data.herald > 0) && (
        <div style={{
          display: "flex", gap: 4, justifyContent: align,
          flexDirection: side === "left" ? "row-reverse" : "row",
        }}>
          {Array.from({ length: data.herald }).map((_, i) => (
            <span key={`h${i}`} style={{ fontSize: 12, filter: "drop-shadow(0 0 3px #6366f1aa)" }}>🔮</span>
          ))}
          {Array.from({ length: data.baron }).map((_, i) => (
            <span key={`b${i}`} style={{ fontSize: 12, filter: "drop-shadow(0 0 3px #eab308aa)" }}>👑</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MINIMAP — COMPOSANT PRINCIPAL
═══════════════════════════════════════════════════════════════ */
export default function MiniMap({
  leftStats     = [],
  rightStats    = [],
  leftNum       = 1,
  rightNum      = 2,
  visibleEvents = [],
  matchSec      = 0,
  size          = 160,
}) {
  const isLeftBlue  = leftNum  === 1 || leftNum  === 100;
  const isRightBlue = rightNum === 1 || rightNum === 100;

  // Enrichissement des événements avec leurs coords carte
  const enrichedEvents = useMemo(() =>
    visibleEvents.map(ev => {
      const c = getEventCoords(ev);
      return { ...ev, mapX: c.x, mapY: c.y };
    }),
    [visibleEvents]
  );

  // Timeline des objectifs pour l'anticipation
  const objectiveTimeline = useMemo(
    () => buildObjectiveTimeline(enrichedEvents),
    [enrichedEvents]
  );

  // Timeline complète des morts par champion (pour la simulation)
  const deathTimelineByChamp = useMemo(() => {
    const map = {};
    [...visibleEvents]
      .sort((a, b) => parseSec(a.time) - parseSec(b.time))
      .forEach(ev => {
        if (KILL_TYPES.has(ev.type) && ev.victim_champion) {
          const deathSec    = parseSec(ev.time);
          const respawnSec  = deathSec + calcDeathTimer(deathSec);
          if (!map[ev.victim_champion]) map[ev.victim_champion] = [];
          map[ev.victim_champion].push({ deathSec, respawnSec });
        }
      });
    return map;
  }, [visibleEvents]);

  // Mort active (pour l'affichage du timer)
  const currentDeaths = useMemo(() => {
    const map = {};
    Object.entries(deathTimelineByChamp).forEach(([champ, deaths]) => {
      const active = deaths.find(d => matchSec >= d.deathSec && matchSec < d.respawnSec);
      if (active) map[champ] = active;
    });
    return map;
  }, [deathTimelineByChamp, matchSec]);

  const iconSize = Math.round(size * 0.12);

  // Icônes d'événements récents (fenêtre 8s)
  const mapIcons = useMemo(() =>
    enrichedEvents.filter(ev => {
      const evSec = parseSec(ev.time);
      return (
        matchSec >= evSec &&
        matchSec <= evSec + 8 &&
        EVENT_ICONS[ev.type] &&
        ev.mapX != null
      );
    }),
    [enrichedEvents, matchSec]
  );

  // Pings (fenêtre 3s)
  const pingEvents = useMemo(() =>
    enrichedEvents.filter(ev => {
      const evSec = parseSec(ev.time);
      return matchSec >= evSec && matchSec <= evSec + 3 && ev.mapX != null;
    }),
    [enrichedEvents, matchSec]
  );

  // Flash global déclenché par objectif majeur récent
  const majorFlash = useMemo(() => {
    const recent = enrichedEvents.find(ev => {
      const age = matchSec - parseSec(ev.time);
      return age >= 0 && age < 2 && MAJOR_OBJECTIVES.has(ev.type);
    });
    if (!recent) return null;
    return {
      baron:  "#eab308",
      elder:  "#a855f7",
      drake:  "#f97316",
      herald: "#6366f1",
    }[recent.type] || null;
  }, [enrichedEvents, matchSec]);

  return (
    <div style={{
      position: "relative",
      width: size, height: size,
      flexShrink: 0,
      borderRadius: 4,
      overflow: "hidden",
      border: "1px solid rgba(34,197,94,0.35)",
      boxShadow: majorFlash
        ? `0 0 0 1px ${majorFlash}, 0 0 24px ${majorFlash}88, 0 0 60px ${majorFlash}44, inset 0 0 30px ${majorFlash}22`
        : "0 0 0 1px rgba(0,0,0,0.9), 0 0 18px rgba(34,197,94,0.18), 0 4px 28px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.04)",
      transition: "box-shadow 0.4s ease",
      clipPath: "polygon(0 8px, 8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px))",
    }}>

      {/* Coins HUD esports */}
      {[
        { top: 0, left: 0, rotate: 0 },
        { top: 0, right: 0, rotate: 90 },
        { bottom: 0, right: 0, rotate: 180 },
        { bottom: 0, left: 0, rotate: 270 },
      ].map((c, i) => (
        <div key={i} style={{
          position: "absolute",
          top: c.top, left: c.left, right: c.right, bottom: c.bottom,
          width: 18, height: 18,
          borderTop: "2px solid #22C55E",
          borderLeft: "2px solid #22C55E",
          transform: `rotate(${c.rotate}deg)`,
          transformOrigin: "top left",
          pointerEvents: "none",
          zIndex: 30,
          opacity: 0.85,
          filter: "drop-shadow(0 0 3px #22C55Eaa)",
        }} />
      ))}

      {/* Fond de carte */}
      <img src={mapBg} alt="map" style={{
        position: "absolute", inset: 0,
        width: "100%", height: "100%",
        objectFit: "cover", display: "block",
        pointerEvents: "none",
      }} />

      {/* Vignette bords */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.52) 100%)",
        pointerEvents: "none", zIndex: 2,
      }} />

      {/* Pings */}
      {pingEvents.map((ev, i) => (
        <PingEffect
          key={`ping-${i}-${parseSec(ev.time)}`}
          x={ev.mapX} y={ev.mapY}
          size={size}
          color={EVENT_PING_COLOR[ev.type] || "#fff"}
          id={i}
        />
      ))}

      {/* Icônes événements */}
      {mapIcons.map((ev, i) => {
        const evSec = parseSec(ev.time);
        const age   = matchSec - evSec;
        return (
          <div key={`ev-${i}-${evSec}`} style={{
            position: "absolute",
            left: `${ev.mapX}%`, top: `${ev.mapY}%`,
            transform: "translate(-50%, -50%)",
            fontSize: Math.round(iconSize * 0.85),
            zIndex: 25,
            pointerEvents: "none",
            filter: "drop-shadow(0 0 4px rgba(0,0,0,0.95))",
            opacity: Math.max(0, 1 - age / 8),
            transition: "opacity 0.5s",
            animation: age < 0.5 ? "mapIconPop 0.35s cubic-bezier(0.34,1.56,0.64,1)" : "none",
          }}>
            {EVENT_ICONS[ev.type]}
          </div>
        );
      })}

      {/* Équipe gauche */}
      {leftStats.map((p, i) => (
        <ChampionWithFade
          key={`L-${i}`}
          player={p} roleIndex={i}
          isBlue={isLeftBlue}
          matchSec={matchSec}
          deathData={currentDeaths[p.champion]}
          allDeaths={deathTimelineByChamp[p.champion] || []}
          enrichedEvents={enrichedEvents}
          objectiveTimeline={objectiveTimeline}
          size={size} iconSize={iconSize*0.85}
        />
      ))}

      {/* Équipe droite */}
      {rightStats.map((p, i) => (
        <ChampionWithFade
          key={`R-${i}`}
          player={p} roleIndex={i}
          isBlue={isRightBlue}
          matchSec={matchSec}
          deathData={currentDeaths[p.champion]}
          allDeaths={deathTimelineByChamp[p.champion] || []}
          enrichedEvents={enrichedEvents}
          objectiveTimeline={objectiveTimeline}
          size={size} iconSize={iconSize*0.85}
        />
      ))}

      <style>{`
        @keyframes mapIconPop {
          from { transform: translate(-50%,-50%) scale(0.3); opacity: 0; }
          to   { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
        }
        @keyframes pingExpand {
          from { transform: translate(-50%,-50%) scale(0.5); opacity: 0.85; }
          to   { transform: translate(-50%,-50%) scale(2.8); opacity: 0; }
        }
        @keyframes urgentPulse {
          0%,100% { color: #fbbf24; transform: scale(1); }
          50%     { color: #f97316; transform: scale(1.18); }
        }
      `}</style>
    </div>
  );
}