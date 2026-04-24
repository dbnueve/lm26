import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Envelope, EnvelopeOpen, Users, ChatsCircle, CheckCircle, ArrowLeft, Globe } from "@phosphor-icons/react";
import { API_CLIENT } from "../shared";

const TYPE_BOARD = "board";
const TYPE_SOLOQ = "soloq";
const TYPE_INTL  = "international";

const SENDER_AVATARS = {
  "Direction Sportive":      "DS",
  "Manager Général":         "MG",
  "Président":               "PR",
  "Directeur Sportif":       "DS",
  "Scout International":     "SI",
  "Cellule de Recrutement":  "CR",
  "Analyste Tactique":       "AT",
  "Sponsor Principal":       "SP",
  "Manager Financier":       "MF",
  "@LoLAnalyst_EU":          "LA",
  "LeagueFanatic42":         "LF",
  "EsportsInsider":          "EI",
  "@CriticalCoach":          "CC",
  "LoLFan_Frustrated":       "LF",
  "EsportsBetting":          "EB",
  "@ProScoutWatch":          "PS",
};

const SENDER_COLORS = {
  "Direction Sportive":      "#3b82f6",
  "Manager Général":         "#8b5cf6",
  "Président":               "#f59e0b",
  "Directeur Sportif":       "#3b82f6",
  "Scout International":     "#10b981",
  "Cellule de Recrutement":  "#06d6a0",
  "Analyste Tactique":       "#60a5fa",
  "Sponsor Principal":       "#fbbf24",
  "Manager Financier":       "#fb923c",
  "@LoLAnalyst_EU":          "#06b6d4",
  "LeagueFanatic42":         "#22c55e",
  "EsportsInsider":          "#64748b",
  "@CriticalCoach":          "#ef4444",
  "LoLFan_Frustrated":       "#f97316",
  "EsportsBetting":          "#6366f1",
  "@ProScoutWatch":          "#2dd4bf",
};

const getAvatar = (sender) => SENDER_AVATARS[sender] || sender.substring(0, 2).toUpperCase();
const getColor  = (sender) => SENDER_COLORS[sender]  || "var(--accent)";

const MessageRow = ({ msg, selected, onClick }) => {
  const color = getColor(msg.sender);
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "12px 14px", cursor: "pointer",
        background: selected ? "var(--accent-dim)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        borderBottom: "1px solid var(--border)",
        transition: "background var(--t-fast)",
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: color + "22", border: `1px solid ${color}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800, color,
      }}>
        {getAvatar(msg.sender)}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: msg.read ? 500 : 700, color: msg.read ? "var(--text-2)" : "var(--text-1)" }}>
            {msg.sender}
          </span>
          <span style={{ fontSize: 10, color: "var(--text-2)", flexShrink: 0, marginLeft: 8 }}>
            S{msg.week}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: msg.read ? 400 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: msg.read ? "var(--text-2)" : "var(--text-1)" }}>
          {msg.subject}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
          {msg.body.substring(0, 80)}…
        </div>
      </div>

      {/* Unread dot */}
      {!msg.read && (
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, marginTop: 6 }} />
      )}
    </div>
  );
};

// ── International standings renderer ─────────────────────────────────────────
const MEDAL_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", null, null];

const NARRATIVE_PREFIXES = ["⚡", "🔥", "⚖️"];
const isNarrativeLine = (s) => NARRATIVE_PREFIXES.some(p => s.trimStart().startsWith(p));

const IntlStandingsBody = ({ body }) => {
  const blocks = body.split("\n\n").filter(Boolean);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
      {blocks.map((block, bi) => {
        const lines = block.trim().split("\n").filter(Boolean);
        if (!lines.length) return null;
        const header    = lines[0];
        const dataLines = lines.slice(1).filter(l => !isNarrativeLine(l));
        const highlight = lines.slice(1).find(isNarrativeLine);
        return (
          <div key={bi} style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "14px 16px",
          }}>
            {/* League header */}
            <div style={{
              fontSize: 13, fontWeight: 800, letterSpacing: "0.06em",
              marginBottom: 12, paddingBottom: 8,
              borderBottom: "1px solid var(--border)",
              color: "var(--text-1)",
            }}>
              {header}
            </div>

            {/* Team rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {dataLines.map((row, ri) => {
                const trimmed = row.trim();
                const match = trimmed.match(/^(\S+)\s+(.+?)\s{2,}(\d+V-\d+D)$/);
                const medal  = match ? match[1] : trimmed.slice(0, 2);
                const team   = match ? match[2].trim() : trimmed;
                const record = match ? match[3] : "";
                const [wStr, lStr] = record.split("-");
                const wins   = parseInt(wStr) || 0;
                const losses = parseInt(lStr) || 0;
                const mc     = MEDAL_COLORS[ri];
                const isTop3 = ri < 3;
                return (
                  <div key={ri} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "5px 8px", borderRadius: 4,
                    background: isTop3 ? (mc + "11") : "transparent",
                  }}>
                    <span style={{ width: 22, fontSize: 13, flexShrink: 0, textAlign: "center" }}>{medal}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: isTop3 ? 600 : 400, color: isTop3 ? "var(--text-1)" : "var(--text-2)" }}>
                      {team}
                    </span>
                    {record && (
                      <span style={{ fontSize: 12, flexShrink: 0 }}>
                        <span style={{ color: "var(--success)", fontWeight: 700 }}>{wins}V</span>
                        <span style={{ color: "var(--text-2)" }}>-</span>
                        <span style={{ color: "var(--danger)", fontWeight: 700 }}>{losses}D</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Narrative highlight */}
            {highlight && (
              <div style={{
                marginTop: 10, padding: "6px 10px",
                background: "var(--amber-dim)", borderRadius: "var(--radius-xs)",
                fontSize: 11, color: "var(--text-2)", fontStyle: "italic",
              }}>
                {highlight.trim()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Youth scouting report renderer ───────────────────────────────────────────
const POS_COLORS = { TOP: "#f97316", JUNGLE: "#22c55e", MID: "#3b82f6", ADC: "#ec4899", SUPPORT: "#a78bfa" };

const ScoutingReportBody = ({ body }) => {
  const lines = body.split("\n").filter(Boolean);
  // Find prospect blocks: lines containing "Rating" are part of a prospect
  const prospects = [];
  let current = null;
  for (const line of lines) {
    const nameMatch = line.match(/^([🛡️🌲⚡🏹💊])\s(.+?)\s\((.+?),\s(\d+(?:\.\d+)?)\s ans\)\s—\s(\w+)/u);
    if (nameMatch) {
      if (current) prospects.push(current);
      current = { icon: nameMatch[1], name: nameMatch[2], nat: nameMatch[3], age: nameMatch[4], pos: nameMatch[5], detail: "" };
    } else if (current && line.trim().startsWith("Rating")) {
      current.detail = line.trim().replace(/^Rating\s/, "").replace("·", "·");
    } else if (!current) {
      // intro / footer lines handled separately
    }
  }
  if (current) prospects.push(current);

  const intro  = lines.find(l => l.includes("méritent votre attention") || l.includes("Rapport de scouting"));
  const footer = lines.find(l => l.startsWith("Ces joueurs") || l.startsWith("Suivez") || l.startsWith("Note"));

  return (
    <div>
      {intro && <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 18 }}>{intro}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {prospects.map((p, i) => {
          const posColor = POS_COLORS[p.pos] || "var(--accent)";
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "12px 16px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${posColor}`,
              borderRadius: 6,
            }}>
              <div style={{ fontSize: 22, width: 32, textAlign: "center", flexShrink: 0 }}>{p.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{p.nat} · {p.age} ans</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                    background: posColor + "22", color: posColor,
                  }}>{p.pos}</span>
                </div>
                {p.detail && (
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {p.detail.split("·").map((part, j) => (
                      <span key={j}>
                        {j > 0 && <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>}
                        <span style={part.includes("Potentiel") ? { color: "#fbbf24", fontWeight: 600 } : {}}>{part.trim()}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {footer && (
        <div style={{
          marginTop: 16, padding: "10px 14px",
          background: "rgba(6,214,160,0.06)", border: "1px solid rgba(6,214,160,0.2)",
          borderRadius: 6, fontSize: 12, color: "var(--text-2)", fontStyle: "italic",
        }}>
          {footer}
        </div>
      )}
    </div>
  );
};

const MessageDetail = ({ msg, onBack }) => {
  const color = getColor(msg.sender);
  return (
    <motion.div
      key={msg.id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 13, padding: "0 0 14px 0", width: "fit-content" }}
      >
        <ArrowLeft size={14} /> Retour
      </button>

      {/* Header */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid var(--border)" }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
          background: color + "22", border: `2px solid ${color}66`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, color,
        }}>
          {getAvatar(msg.sender)}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{msg.sender}</div>
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>Semaine {msg.week}</div>
        </div>
      </div>

      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>{msg.subject}</div>

      {msg.type === TYPE_INTL
        ? <IntlStandingsBody body={msg.body} />
        : msg.sender === "Cellule de Recrutement"
        ? <ScoutingReportBody body={msg.body} />
        : <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{msg.body}</div>
      }
    </motion.div>
  );
};

const InboxPage = () => {
  const [data, setData]         = useState({ messages: [], unread_board: 0, unread_soloq: 0, unread_international: 0, unread_total: 0 });
  const [tab, setTab]           = useState(TYPE_BOARD);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await API_CLIENT.get("/inbox");
      setData(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = useCallback(async (msg) => {
    if (msg.read) return;
    await API_CLIENT.post(`/inbox/${msg.id}/read`).catch(() => {});
    setData(prev => ({
      ...prev,
      messages: prev.messages.map(m => m.id === msg.id ? { ...m, read: true } : m),
      unread_total: Math.max(0, prev.unread_total - 1),
      unread_board: msg.type === TYPE_BOARD ? Math.max(0, prev.unread_board - 1) : prev.unread_board,
      unread_soloq: msg.type === TYPE_SOLOQ ? Math.max(0, prev.unread_soloq - 1) : prev.unread_soloq,
      unread_international: msg.type === TYPE_INTL ? Math.max(0, prev.unread_international - 1) : prev.unread_international,
    }));
  }, []);

  const handleSelect = useCallback((msg) => {
    setSelected(msg);
    markRead(msg);
  }, [markRead]);

  const markAllRead = useCallback(async () => {
    await API_CLIENT.post("/inbox/read-all").catch(() => {});
    setData(prev => ({
      ...prev,
      messages: prev.messages.map(m => ({ ...m, read: true })),
      unread_board: 0, unread_soloq: 0, unread_total: 0,
    }));
  }, []);

  const filtered = data.messages.filter(m => m.type === tab);
  const unreadCount = tab === TYPE_BOARD ? data.unread_board : tab === TYPE_SOLOQ ? data.unread_soloq : data.unread_international;

  const tabs = [
    { id: TYPE_BOARD, label: "Direction",      icon: Users,        unread: data.unread_board },
    { id: TYPE_SOLOQ, label: "Communauté",     icon: ChatsCircle,  unread: data.unread_soloq },
    { id: TYPE_INTL,  label: "International",  icon: Globe,        unread: data.unread_international },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 0, height: "calc(100vh - 120px)", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>

      {/* Left panel — list */}
      <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSelected(null); }} style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "14px 0", background: "none", border: "none", cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              color: tab === t.id ? "var(--accent)" : "var(--text-2)",
              fontSize: 12, fontWeight: 600, transition: "all var(--t-base)",
            }}>
              <t.icon size={16} weight={tab === t.id ? "fill" : "regular"} />
              {t.label}
              {t.unread > 0 && (
                <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 800, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>
                  {t.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>
            {filtered.length} message{filtered.length !== 1 ? "s" : ""}
            {unreadCount > 0 && ` · ${unreadCount} non lu${unreadCount > 1 ? "s" : ""}`}
          </span>
          {data.unread_total > 0 && (
            <button onClick={markAllRead} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
              <CheckCircle size={13} /> Tout lire
            </button>
          )}
        </div>

        {/* Message list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-2)", fontSize: 13 }}>Chargement…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-2)" }}>
              <Envelope size={36} style={{ opacity: 0.3, marginBottom: 10, display: "block", margin: "0 auto 10px" }} />
              <div style={{ fontSize: 13 }}>Aucun message pour l'instant</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Les messages apparaissent après vos matchs</div>
            </div>
          ) : (
            filtered.map(msg => (
              <MessageRow
                key={msg.id}
                msg={msg}
                selected={selected?.id === msg.id}
                onClick={() => handleSelect(msg)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div style={{ padding: 28, overflowY: "auto" }}>
        <AnimatePresence mode="wait">
          {selected ? (
            <MessageDetail key={selected.id} msg={selected} onBack={() => setSelected(null)} />
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-2)" }}
            >
              <EnvelopeOpen size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
              <div style={{ fontSize: 14 }}>Sélectionnez un message</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InboxPage;
