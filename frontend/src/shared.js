import React from "react";
import axios from "axios";

// Use relative URLs so the webpack devServer proxy routes /api/ to the FastAPI backend.
// This works whether the app is accessed via localhost or a cloud preview URL.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = BACKEND_URL + "/api";

// Context for lolesports player headshot URLs (name.toLowerCase() → url)
const PlayerImagesContext = React.createContext({});

// Convert 2-letter ISO country code to flag emoji
const toFlag = (code) => {
  if (!code || code.length !== 2) return code || "";
  const c = code.toUpperCase() === "UK" ? "GB" : code.toUpperCase();
  try { return String.fromCodePoint(...c.split('').map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65)); }
  catch { return code; }
};

// Context for team logo URLs (teamId → url)
const TeamLogosContext = React.createContext({});
const TeamModalContext = React.createContext({ openTeam: () => {} });

// Format a money amount: >= 1 000 000 → "X.XM", otherwise → "XK"
const formatMoney = (amount) => {
  if (!amount && amount !== 0) return "0K";
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(1) + "M";
  return Math.round(amount / 1000) + "K";
};

export { BACKEND_URL, API, PlayerImagesContext, toFlag, TeamLogosContext, TeamModalContext, formatMoney };
export { axios };
export const withTimeout = (promise, ms = 10000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), ms)
    )
  ]);