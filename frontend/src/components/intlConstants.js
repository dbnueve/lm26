import React from "react";
import { Globe } from "@phosphor-icons/react";

export const LEAGUE_FLAG  = { LEC: "🇪🇺", LCK: "🇰🇷", LPL: "🇨🇳", LCS: "🇺🇸", CBLOL: "🇧🇷" };
export const LEAGUE_COLOR = { LEC: "#0BC4FA", LCK: "#FF0844", LPL: "#FF6B00", LCS: "#1DA1F2", CBLOL: "#00D65C" };

export const C = {
  gold:      "#FFB800",
  goldDim:   "rgba(255,184,0,.12)",
  goldBorder:"rgba(255,184,0,.35)",
  blue:      "#4FC3F7",
  blueDim:   "rgba(79,195,247,.10)",
  danger:    "#FF3366",
  success:   "#00D65C",
  surface:   "rgba(255,255,255,.04)",
  surfaceHov:"rgba(255,255,255,.07)",
  border:    "rgba(255,255,255,.09)",
  borderSub: "rgba(255,255,255,.05)",
  text:      "#E8ECF4",
  muted:     "#687080",
};

export function btnStyle(variant, disabled) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "7px 14px", fontSize: 12, fontWeight: 700,
    borderRadius: 5, cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid", letterSpacing: .5,
    transition: "opacity .15s", opacity: disabled ? .5 : 1,
    outline: "none",
  };
  if (variant === "gold") return { ...base,
    background: "rgba(255,184,0,.15)", borderColor: "rgba(255,184,0,.4)", color: "#FFB800" };
  if (variant === "primary") return { ...base,
    background: "rgba(79,195,247,.12)", borderColor: "rgba(79,195,247,.3)", color: "#4FC3F7" };
  return { ...base,
    background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.1)", color: "#687080" };
}

export function EmptyState({ label }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 0", color: "#687080" }}>
      <Globe size={32} style={{ marginBottom: 10, opacity: .3 }} />
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}
