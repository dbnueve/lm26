// Helpers & constantes partagés par MatchTimeline et ses sous-composants

export const SPEEDS = [
  { label: "1×", step: 1 },
  { label: "2×", step: 7 },
  { label: "4×", step: 15 },
];

export const TICK_MS = 100;

export const KILL_TYPES = new Set([
  "kill", "first_blood", "double_kill", "triple_kill", "quadra_kill", "penta_kill",
]);

export const EVENT_ICON = {
  first_blood: "🩸",
  kill: "💀",
  double_kill: "💥",
  triple_kill: "🔥",
  quadra_kill: "⚡",
  penta_kill: "👑",
  teamfight: "⚔️",
  tower: "🏯",
  first_tower: "🏯",
  drake: "🐉",
  herald: "🔮",
  baron: "👑",
  elder: "🟣",
  inhibitor: "💎",
  game_end: "💥",
  objective: "🎯",
};

export const CS_EXPECT = { TOP: 9.0, JUNGLE: 7.5, MID: 9.0, ADC: 9.5, SUPPORT: 0.8 };

export function parseSec(t) {
  if (!t) return 99 * 60;
  const parts = String(t).split(":");
  return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
}

export function parseMin(t) {
  if (!t) return 99;
  return parseInt(String(t).split(":")[0], 10);
}

export function fmtTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function calcNote(p, duration, won) {
  const pos = p.position || "MID";
  const k = p.kills || 0;
  const d = Math.max(p.deaths || 1, 1);
  const a = p.assists || 0;
  const cs = p.cs || 0;
  const dur = Math.max(duration || 1, 1);
  const kdaScore = Math.min(5.0, ((k + a * 0.5) / d) * 1.2);
  const csScore = Math.min(3.0, (cs / dur / Math.max(CS_EXPECT[pos] || 8.0, 0.1)) * 3.0);
  return Math.round((kdaScore + csScore + (won ? 2.0 : 0.0)) * 10) / 10;
}
