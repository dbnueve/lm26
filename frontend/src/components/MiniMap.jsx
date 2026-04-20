import React, { useMemo } from "react";
import { _ddVersion, toDDragonKey } from "./ddHelpers";
import { parseSec, KILL_TYPES } from "./timelineHelpers";
import mapBg from "./lol_map.jpg";

/* ─────────────────────────────────────────────────────────────────
   1. WAYPOINTS — chemins de lane en % (origine haut-gauche)
   Bleu  = spawn bas-gauche  (~12, 88)
   Rouge = spawn haut-droit  (~88, 12)
───────────────────────────────────────────────────────────────── */
const WAYPOINTS = {
  BLUE_TOP: [
    { x: 12, y: 88 },
    { x: 12, y: 22 },
    { x: 18, y: 18 },
    { x: 25, y: 18 },
  ],
  BLUE_JGL: [
    { x: 12, y: 88 },
    { x: 25, y: 75 },
    { x: 40, y: 65 },
    { x: 35, y: 55 },
  ],
  BLUE_MID: [
    { x: 12, y: 88 },
    { x: 25, y: 75 },
    { x: 42, y: 58 },
  ],
  BLUE_BOT: [
    { x: 12, y: 88 },
    { x: 78, y: 88 },
    { x: 82, y: 82 },
    { x: 82, y: 75 },
  ],
  BLUE_SUP: [
    { x: 12, y: 88 },
    { x: 78, y: 88 },
    { x: 82, y: 82 },
    { x: 82, y: 78 },
  ],
  RED_TOP: [
    { x: 88, y: 12 },
    { x: 22, y: 12 },
    { x: 18, y: 18 },
    { x: 18, y: 25 },
  ],
  RED_JGL: [
    { x: 88, y: 12 },
    { x: 75, y: 25 },
    { x: 60, y: 35 },
    { x: 65, y: 45 },
  ],
  RED_MID: [
    { x: 88, y: 12 },
    { x: 75, y: 25 },
    { x: 58, y: 42 },
  ],
  RED_BOT: [
    { x: 88, y: 12 },
    { x: 88, y: 78 },
    { x: 82, y: 82 },
    { x: 75, y: 82 },
  ],
  RED_SUP: [
    { x: 88, y: 12 },
    { x: 88, y: 78 },
    { x: 82, y: 82 },
    { x: 77, y: 82 },
  ],
};

// Rôles dans l'ordre : top, jgl, mid, bot, sup
const ROLE_KEYS_BLUE = ["BLUE_TOP", "BLUE_JGL", "BLUE_MID", "BLUE_BOT", "BLUE_SUP"];
const ROLE_KEYS_RED  = ["RED_TOP",  "RED_JGL",  "RED_MID",  "RED_BOT",  "RED_SUP"];

/* ─────────────────────────────────────────────────────────────────
   CAMPS DE JUNGLE — aller-retour réaliste
   Bleu side : camps dans le quadrant bas-gauche
   Rouge side : camps dans le quadrant haut-droit
───────────────────────────────────────────────────────────────── */
// Séquences de camps pour chaque équipe (farming route)
// Le jungler fait ces camps dans l'ordre puis revient au début (loop)
const JUNGLE_ROUTE_BLUE = [
  { x: 20, y: 70 }, // Gromp / Blue buff zone
  { x: 28, y: 62 }, // Blue Buff
  { x: 33, y: 55 }, // Wolves
  { x: 38, y: 48 }, // Raptors
  { x: 30, y: 42 }, // Red Buff
  { x: 22, y: 55 }, // Krugs
  { x: 15, y: 65 }, // Retour base / Gromp
];

const JUNGLE_ROUTE_RED = [
  { x: 80, y: 30 }, // Gromp / Blue buff zone
  { x: 72, y: 38 }, // Blue Buff
  { x: 67, y: 45 }, // Wolves
  { x: 62, y: 52 }, // Raptors
  { x: 70, y: 58 }, // Red Buff
  { x: 78, y: 45 }, // Krugs
  { x: 85, y: 35 }, // Retour base
];

// Durée approximative par camp (secondes) — rythme réaliste
const JUNGLE_CAMP_DURATION = 18; // ~18s par camp en early

/* ─────────────────────────────────────────────────────────────────
   2. COORDONNÉES DES ÉVÉNEMENTS sur la carte
───────────────────────────────────────────────────────────────── */
const EVENT_COORDS = {
  drake:    { x: 72, y: 72 },
  elder:    { x: 72, y: 72 },
  baron:    { x: 28, y: 28 },
  herald:   { x: 28, y: 28 },
  mid_lane: { x: 50, y: 50 },

  blue_tower_top_t1: { x: 12, y: 45 },
  blue_tower_top_t2: { x: 12, y: 65 },
  blue_tower_mid_t1: { x: 38, y: 62 },
  blue_tower_bot_t1: { x: 55, y: 88 },
  blue_inhib_top:    { x: 12, y: 78 },
  blue_inhib_mid:    { x: 22, y: 78 },
  blue_inhib_bot:    { x: 22, y: 88 },

  red_tower_top_t1:  { x: 45, y: 12 },
  red_tower_top_t2:  { x: 65, y: 12 },
  red_tower_mid_t1:  { x: 62, y: 38 },
  red_tower_bot_t1:  { x: 88, y: 55 },
  red_inhib_top:     { x: 78, y: 12 },
  red_inhib_mid:     { x: 78, y: 22 },
  red_inhib_bot:     { x: 88, y: 22 },

  spawn_blue: { x: 12, y: 88 },
  spawn_red:  { x: 88, y: 12 },
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

function getEventCoords(item) {
  if (item.x != null && item.y != null) return { x: item.x, y: item.y };
  if (EVENT_COORDS[item.type]) return EVENT_COORDS[item.type];

  const desc   = (item.description || "").toLowerCase();
  const isBlue = item.team === 1 || item.team === 100;
  const side   = isBlue ? "blue" : "red";

  if (item.type === "tower" || item.type === "first_tower") {
    if (desc.includes("top") || desc.includes("haut")) return EVENT_COORDS[`${side}_tower_top_t1`];
    if (desc.includes("bot") || desc.includes("bas"))  return EVENT_COORDS[`${side}_tower_bot_t1`];
    return EVENT_COORDS[`${side}_tower_mid_t1`];
  }
  if (item.type === "inhibitor") {
    if (desc.includes("top") || desc.includes("haut")) return EVENT_COORDS[`${side}_inhib_top`];
    if (desc.includes("bot") || desc.includes("bas"))  return EVENT_COORDS[`${side}_inhib_bot`];
    return EVENT_COORDS[`${side}_inhib_mid`];
  }
  if (item.type === "game_end") return isBlue ? EVENT_COORDS.spawn_red : EVENT_COORDS.spawn_blue;

  return EVENT_COORDS.mid_lane;
}

/* ─────────────────────────────────────────────────────────────────
   3. UTILITAIRES DE CHEMIN
───────────────────────────────────────────────────────────────── */
function getPosOnPath(path, progress) {
  if (!path || path.length === 0) return { x: 50, y: 50 };
  if (progress <= 0) return { ...path[0] };
  if (progress >= 1) return { ...path[path.length - 1] };

  const totalSegments = path.length - 1;
  const segIdx = Math.min(Math.floor(progress * totalSegments), totalSegments - 1);
  const segT   = progress * totalSegments - segIdx;
  const a = path[segIdx];
  const b = path[segIdx + 1];
  return {
    x: a.x + (b.x - a.x) * segT,
    y: a.y + (b.y - a.y) * segT,
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

/* ─────────────────────────────────────────────────────────────────
   JUNGLER — position calculée via route aller-retour
───────────────────────────────────────────────────────────────── */
function getJunglerPos(matchSec, isBlue) {
  const route = isBlue ? JUNGLE_ROUTE_BLUE : JUNGLE_ROUTE_RED;
  const totalRouteDuration = route.length * JUNGLE_CAMP_DURATION;
  // Offset de départ : ~90s après le début (arrivée au 1er camp)
  const farmSec = Math.max(0, matchSec - 90);
  const cyclePos = farmSec % totalRouteDuration;
  const campIdx  = Math.floor(cyclePos / JUNGLE_CAMP_DURATION);
  const campT    = (cyclePos % JUNGLE_CAMP_DURATION) / JUNGLE_CAMP_DURATION;

  const currentCamp = route[campIdx % route.length];
  const nextCamp    = route[(campIdx + 1) % route.length];

  // Interpolation douce entre les camps
  return {
    x: currentCamp.x + (nextCamp.x - currentCamp.x) * campT,
    y: currentCamp.y + (nextCamp.y - currentCamp.y) * campT,
  };
}

/* ─────────────────────────────────────────────────────────────────
   4. SIMULATION DE POSITION
───────────────────────────────────────────────────────────────── */
function simulatePos(roleIndex, matchSec, isBlue, enrichedEvents, deathData) {
  const seed = (roleIndex + 1) * 231.7 + (isBlue ? 0 : 117);
  const gameMin = matchSec / 60;
  const spawnPos = isBlue ? EVENT_COORDS.spawn_blue : EVENT_COORDS.spawn_red;

  // 1. GESTION DE LA MORT — position fixée à la base, pas de déplacement
  const isDead = deathData && matchSec >= deathData.deathSec && matchSec < deathData.respawnSec;
  if (isDead) return { ...spawnPos };

  // 2. PHASE DE LANING (< 14 min)
  if (gameMin < 14) {
    // JUNGLER : route de farming aller-retour dès le début
    if (roleIndex === 1) {
      const pos = getJunglerPos(matchSec, isBlue);
      return applyJitter(pos, seed, matchSec);
    }

    const pathKeys = isBlue ? ROLE_KEYS_BLUE : ROLE_KEYS_RED;
    const pathKey = pathKeys[Math.min(roleIndex, pathKeys.length - 1)];
    const path = WAYPOINTS[pathKey];
    const progress = Math.min(matchSec / 25, 1);
    const pos = getPosOnPath(path, progress);
    return applyJitter(pos, seed, matchSec);
  }

  // 3. MID/LATE GAME (Logique par Rôle)

  // Vérifie si la botlane est au mid (événement récent au mid ou en cours)
  const botlaneAtMid = enrichedEvents.some(ev => {
    const evSec = parseSec(ev.time);
    return (
      matchSec >= evSec &&
      matchSec <= evSec + 30 &&
      ev.mapX != null &&
      ev.mapX > 40 && ev.mapX < 60 &&
      ev.mapY != null && ev.mapY > 40 && ev.mapY < 60
    );
  });

  // Recherche d'un événement récent pertinent
  const recentEvent = [...enrichedEvents].reverse().find(ev => {
    const evSec = parseSec(ev.time);
    return matchSec >= evSec && matchSec <= evSec + 20 && ev.mapX != null;
  });

  let target;

  // JUNGLER en mid/late : continue à farme sa jungle entre les objectifs
  if (roleIndex === 1) {
    const isMajorObjective = recentEvent && ["drake", "baron", "elder", "herald"].includes(recentEvent.type);
    if (isMajorObjective) {
      // Le jungler va aux objectifs majeurs
      target = { x: recentEvent.mapX, y: recentEvent.mapY };
    } else {
      // Sinon il continue à farmer sa jungle
      const pos = getJunglerPos(matchSec, isBlue);
      return applyJitter(pos, seed, matchSec);
    }
  }

  if (!target && recentEvent) {
    const isMajorObjective = ["drake", "baron", "elder", "herald"].includes(recentEvent.type);
    const isTowerEvent = ["tower", "first_tower", "inhibitor"].includes(recentEvent.type);

    if (isTowerEvent) {
      const desc = (recentEvent.description || "").toLowerCase();
      const isTopEvent = desc.includes("top") || desc.includes("haut");
      const isBotEvent = desc.includes("bot") || desc.includes("bas");

      if ((isTopEvent && roleIndex === 0) || (isBotEvent && (roleIndex === 3 || roleIndex === 4))) {
        target = { x: recentEvent.mapX, y: recentEvent.mapY };
      } else {
        target = { x: 50, y: 50 }; // Les autres restent au Mid
      }
    }
    else if (isMajorObjective) {
      if (roleIndex === 0) {
        // Top : reste en top lane même pendant un objectif majeur (pression splitpush)
        target = isBlue ? { x: 15, y: 22 } : { x: 85, y: 78 };
      } else if (roleIndex === 2) {
        // Mid : reste en bot lane même pendant un objectif majeur
        target = isBlue ? { x: 80, y: 82 } : { x: 20, y: 18 };
      } else {
        target = { x: recentEvent.mapX, y: recentEvent.mapY };
      }
    }
    else {
      target = { x: recentEvent.mapX, y: recentEvent.mapY };
    }
  }

  // 4. COMPORTEMENT PAR DÉFAUT (Si pas d'événement)
  if (!target) {
    if (roleIndex === 0) {
      // Top : splitpush UNIQUEMENT en top lane
      target = isBlue ? { x: 15, y: 22 } : { x: 85, y: 78 };
    }
    else if (roleIndex === 2) {
      // Mid : side-lane UNIQUEMENT en bot lane (opposé du top)
      if (botlaneAtMid) {
        // La botlane remonte au mid → le mid descend en bot side
        target = isBlue ? { x: 80, y: 82 } : { x: 20, y: 18 };
      } else {
        // Cycle : mid → bot side → retour mid
        const sidePhase = Math.floor(gameMin / 3) % 3;
        if (sidePhase === 1) {
          target = isBlue ? { x: 78, y: 82 } : { x: 22, y: 18 };
        } else {
          target = { x: 50, y: 50 }; // mid
        }
      }
    }
    else {
      // Botlane (3, 4) : regroupement mid ou objectifs
      target = { x: 50, y: 50 };
    }
  }

  return applyJitter(target, seed, matchSec);
}

// Helper pour éviter la répétition du Jitter
function applyJitter(pos, seed, matchSec) {
  const jX = Math.sin(seed + matchSec * 0.05) * 3;
  const jY = Math.cos(seed + matchSec * 0.04) * 3;
  return {
    x: Math.max(5, Math.min(95, pos.x + jX)),
    y: Math.max(5, Math.min(95, pos.y + jY)),
  };
}

/* ─────────────────────────────────────────────────────────────────
   5. SOUS-COMPOSANT CHAMPION
───────────────────────────────────────────────────────────────── */
function ChampionAvatar({ player, roleIndex, isBlue, matchSec, deathData, enrichedEvents, size, iconSize }) {
  const pos = simulatePos(roleIndex, matchSec, isBlue, enrichedEvents, deathData);
  const ddKey  = toDDragonKey(player.champion || "");
  const isDead = deathData && matchSec >= deathData.deathSec && matchSec < deathData.respawnSec;
  const remainSec = isDead ? Math.ceil(deathData.respawnSec - matchSec) : 0;

  // Quand mort : on place l'icône à la base avec opacity 0 pendant 0.3s
  // puis réapparaît à la base avec le timer — on ne "déplace" pas l'icône
  const spawnPos = isBlue ? EVENT_COORDS.spawn_blue : EVENT_COORDS.spawn_red;
  const displayPos = isDead ? spawnPos : pos;

  const px = (displayPos.x / 100) * size - iconSize / 2;
  const py = (displayPos.y / 100) * size - iconSize / 2;
  const ringColor = isBlue ? "#3b82f6" : "#ef4444";

  return (
    <div
      title={`${player.player_name} — ${player.champion}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        // Quand mort : pas de transition de déplacement, juste apparition à la base
        transform: `translate(${px}px, ${py}px)`,
        width: iconSize,
        height: iconSize,
        // On désactive la transition position pendant la mort pour éviter l'animation glissement → base
        transition: isDead ? "transform 0s, opacity 0.4s 0.15s" : "transform 1.2s ease, opacity 0.3s",
        opacity: isDead ? 1 : 1,
        zIndex: 10,
      }}
    >
      {/* Anneau équipe */}
      <div style={{
        position: "absolute",
        inset: -2,
        borderRadius: "50%",
        border: `2px solid ${isDead ? "rgba(255,255,255,0.15)" : ringColor}`,
        boxShadow: isDead ? "none" : `0 0 6px ${ringColor}88`,
        pointerEvents: "none",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }} />

      {/* Avatar */}
      <img
        src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${ddKey}.png`}
        alt={player.champion}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          display: "block",
          objectFit: "cover",
          filter: isDead ? "grayscale(1) brightness(0.25)" : "none",
          transition: "filter 0.4s",
        }}
        onError={e => { e.currentTarget.style.display = "none"; }}
      />

      {/* Timer mort */}
      {isDead && (
        <div style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.72)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <span style={{
            fontSize: Math.max(6, iconSize * 0.36),
            fontFamily: "monospace",
            fontWeight: 900,
            color: "#ef4444",
            lineHeight: 1,
          }}>
            {remainSec}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   WRAPPER avec gestion de la disparition à la mort
   L'icône disparaît instantanément quand le joueur meurt,
   puis réapparaît à la base après 0.15s (évite le glissement visuel)
───────────────────────────────────────────────────────────────── */
function ChampionAvatarWithDeathFade(props) {
  const { player, matchSec, deathData } = props;
  const isDead = deathData && matchSec >= deathData.deathSec && matchSec < deathData.respawnSec;

  // Fenêtre de "flash invisible" juste après la mort (0.25s)
  // pour éviter l'animation de glissement vers la base
  const justDied = deathData && matchSec >= deathData.deathSec && matchSec < deathData.deathSec + 0.25;

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      opacity: justDied ? 0 : 1,
      transition: justDied ? "opacity 0s" : "opacity 0.3s",
    }}>
      <ChampionAvatar {...props} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   6. MINIMAP PRINCIPAL
───────────────────────────────────────────────────────────────── */
export default function MiniMap({
  leftStats    = [],
  rightStats   = [],
  leftNum      = 1,
  rightNum     = 2,
  visibleEvents = [],
  matchSec     = 0,
  size         = 160,
}) {
  const isLeftBlue  = leftNum  === 1 || leftNum  === 100;
  const isRightBlue = rightNum === 1 || rightNum === 100;

  // Enrichissement des événements avec coordonnées carte
  const enrichedEvents = useMemo(() =>
    visibleEvents.map(ev => {
      const coords = getEventCoords(ev);
      return { ...ev, mapX: coords.x, mapY: coords.y };
    }),
    [visibleEvents]
  );

  // Calcul des morts (on garde uniquement la mort la plus récente par champion)
  const deadChamps = useMemo(() => {
    const map = {};
    // Trier par temps croissant pour que la dernière mort écrase les précédentes
    [...visibleEvents]
      .sort((a, b) => parseSec(a.time) - parseSec(b.time))
      .forEach(ev => {
        if (KILL_TYPES.has(ev.type) && ev.victim_champion) {
          const deathSec = parseSec(ev.time);
          const respawnSec = deathSec + calcDeathTimer(deathSec);
          // Ne garder que si le joueur est encore en timer de mort au moment actuel
          if (matchSec < respawnSec) {
            map[ev.victim_champion] = { deathSec, respawnSec };
          }
        }
      });
    return map;
  }, [visibleEvents, matchSec]);

  const iconSize = Math.round(size * 0.12);

  // Événements récents à afficher sur la carte (8 secondes)
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

  return (
    <div style={{
      position: "relative",
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: 6,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.15)",
      boxShadow: "0 0 16px rgba(0,0,0,0.7)",
    }}>
      {/* Fond carte */}
      <img
        src={mapBg}
        alt="map"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          pointerEvents: "none",
        }}
      />

      {/* Icônes d'événements sur la carte */}
      {mapIcons.map((ev, idx) => (
        <div
          key={`map-ev-${idx}`}
          style={{
            position: "absolute",
            left: `${ev.mapX}%`,
            top:  `${ev.mapY}%`,
            transform: "translate(-50%, -50%)",
            fontSize: Math.round(iconSize * 0.8),
            zIndex: 25,
            pointerEvents: "none",
            filter: "drop-shadow(0 0 3px rgba(0,0,0,0.9))",
            animation: "mapIconPop 0.3s ease",
          }}
        >
          {EVENT_ICONS[ev.type]}
        </div>
      ))}

      {/* Champions équipe gauche */}
      {leftStats.map((p, i) => (
        <ChampionAvatarWithDeathFade
          key={`left-${i}`}
          player={p}
          roleIndex={i}
          isBlue={isLeftBlue}
          matchSec={matchSec}
          deathData={deadChamps[p.champion]}
          enrichedEvents={enrichedEvents}
          size={size}
          iconSize={iconSize}
        />
      ))}

      {/* Champions équipe droite */}
      {rightStats.map((p, i) => (
        <ChampionAvatarWithDeathFade
          key={`right-${i}`}
          player={p}
          roleIndex={i}
          isBlue={isRightBlue}
          matchSec={matchSec}
          deathData={deadChamps[p.champion]}
          enrichedEvents={enrichedEvents}
          size={size}
          iconSize={iconSize}
        />
      ))}

      {/* Label LIVE */}
      <div style={{
        position: "absolute",
        bottom: 4,
        right: 5,
        fontSize: 7,
        fontWeight: 800,
        letterSpacing: 1.5,
        color: "rgba(255,255,255,0.3)",
        textTransform: "uppercase",
        pointerEvents: "none",
        zIndex: 30,
      }}>
        LIVE
      </div>

      <style>{`
        @keyframes mapIconPop {
          from { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
          to   { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}