import React, { useState, useEffect, useMemo } from "react";
import { ChartLine } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";

// ── Tier calculation ──────────────────────────────────────────────────────────
// Score = (WR-50)*1.5 + presence/10  →  S≥12 / A≥6 / B≥0 / C<0
const getTier = (champ) => {
  if (!champ.picks || champ.picks < 2) return null;
  const score = (champ.win_rate - 50) * 1.5 + champ.presence / 10;
  if (score >= 12) return "S";
  if (score >= 6)  return "A";
  if (score >= 0)  return "B";
  return "C";
};

const TIER_STYLE = {
  S: { bg: "rgba(250,204,21,0.15)",  color: "#facc15", border: "rgba(250,204,21,0.4)" },
  A: { bg: "rgba(34,197,94,0.12)",   color: "#22c55e", border: "rgba(34,197,94,0.35)" },
  B: { bg: "rgba(59,130,246,0.12)",  color: "#60a5fa", border: "rgba(59,130,246,0.35)" },
  C: { bg: "rgba(148,163,184,0.1)",  color: "#94a3b8", border: "rgba(148,163,184,0.3)" },
};

const TierBadge = ({ tier }) => {
  if (!tier) return <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>—</span>;
  const s = TIER_STYLE[tier];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 26, height: 26, borderRadius: 4,
      background: s.bg, border: `1px solid ${s.border}`,
      color: s.color, fontWeight: 900, fontSize: 13, letterSpacing: 0.5,
    }}>
      {tier}
    </span>
  );
};

// ── Role filter ───────────────────────────────────────────────────────────────
const ROLE_META = {
  ALL:     { label: "Tous",    color: "var(--text-secondary)" },
  TOP:     { label: "Top",     color: "#f97316" },
  JUNGLE:  { label: "Jungle",  color: "#22c55e" },
  MID:     { label: "Mid",     color: "#a78bfa" },
  ADC:     { label: "ADC",     color: "#60a5fa" },
  SUPPORT: { label: "Support", color: "#f43f5e" },
};

const RoleFilter = ({ role, active, onClick }) => {
  const meta = ROLE_META[role] || { label: role, color: "var(--text-secondary)" };
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 14px", borderRadius: 6, cursor: "pointer",
        fontSize: 12, fontWeight: 600, transition: "all 0.15s",
        background: active ? meta.color + "22" : "var(--surface)",
        border: `1px solid ${active ? meta.color : "var(--border-subtle)"}`,
        color: active ? meta.color : "var(--text-secondary)",
      }}
    >
      {role !== "ALL" && (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
      )}
      {meta.label}
    </button>
  );
};

// ── DDragon key ───────────────────────────────────────────────────────────────
const toDDKey = (name) => {
  const overrides = {
    "K'Sante": "KSante", "Kai'Sa": "Kaisa", "Wukong": "MonkeyKing",
    "Renata Glasc": "Renata", "Bel'Veth": "Belveth", "Cho'Gath": "Chogath",
    "Dr. Mundo": "DrMundo", "Kog'Maw": "KogMaw", "Kha'Zix": "Khazix",
    "Vel'Koz": "Velkoz", "Nunu & Willump": "Nunu", "Aurelion Sol": "AurelionSol",
    "Jarvan IV": "JarvanIV", "Lee Sin": "LeeSin", "Master Yi": "MasterYi",
    "Miss Fortune": "MissFortune", "Twisted Fate": "TwistedFate",
    "Xin Zhao": "XinZhao", "Tahm Kench": "TahmKench", "LeBlanc": "Leblanc",
    "Rek'Sai": "RekSai",
  };
  return overrides[name] || name.replace(/[^a-zA-Z0-9]/g, "");
};

// ── Delta badge ───────────────────────────────────────────────────────────────
const DeltaBadge = ({ delta }) => {
  if (delta === null || delta === undefined || isNaN(delta)) return null;
  const abs = Math.abs(delta).toFixed(1);
  if (abs === "0.0") return null;
  const positive = delta > 0;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, marginLeft: 4,
      color: positive ? "var(--success)" : "var(--danger)",
    }}>
      {positive ? "▲" : "▼"}{abs}
    </span>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const StatsPage = () => {
  const [data, setData]               = useState(null);
  const [prevData, setPrevData]       = useState(null);
  const [splits, setSplits]           = useState([]);
  const [selectedSplit, setSelectedSplit] = useState("current");
  const [loading, setLoading]         = useState(true);
  const [sortBy, setSortBy]           = useState("presence");
  const [sortDir, setSortDir]         = useState("desc");
  const [roleFilter, setRoleFilter]   = useState("ALL");
  const [ddVersion, setDdVersion]     = useState("14.24.1");

  useEffect(() => {
    fetch("https://ddragon.leagueoflegends.com/api/versions.json")
      .then(r => r.json()).then(v => { if (v[0]) setDdVersion(v[0]); }).catch(() => {});
    axios.get(API + "/stats/splits").then(r => setSplits(r.data)).catch(() => {});
  }, []);

  // Fetch current split
  useEffect(() => {
    setLoading(true);
    axios.get(API + "/stats/champions", { params: { split: selectedSplit } })
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedSplit]);

  // Fetch previous split for delta computation (only on "current")
  useEffect(() => {
    if (selectedSplit !== "current" || splits.length < 2) { setPrevData(null); return; }
    const prevKey = splits[1]?.key;
    if (!prevKey || prevKey === "current") { setPrevData(null); return; }
    axios.get(API + "/stats/champions", { params: { split: prevKey } })
      .then(r => setPrevData(r.data))
      .catch(() => setPrevData(null));
  }, [selectedSplit, splits]);

  // Build delta map: champName → delta WR
  const deltaMap = useMemo(() => {
    if (!prevData?.champions || !data?.champions) return {};
    const prev = {};
    prevData.champions.forEach(c => { prev[c.name] = c.win_rate; });
    const map = {};
    data.champions.forEach(c => {
      if (prev[c.name] !== undefined && c.picks >= 2) {
        map[c.name] = c.win_rate - prev[c.name];
      }
    });
    return map;
  }, [data, prevData]);

  const sorted = useMemo(() => {
    if (!data?.champions) return [];
    const filtered = roleFilter === "ALL"
      ? data.champions
      : data.champions.filter(c => c.main_role === roleFilter);
    return [...filtered].sort((a, b) =>
      sortDir === "desc" ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy]
    );
  }, [data, sortBy, sortDir, roleFilter]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const SortHeader = ({ col, label, align = "center" }) => (
    <th onClick={() => toggleSort(col)} style={{
      padding: "10px 12px", textAlign: align,
      cursor: "pointer", userSelect: "none", fontSize: 11, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: 1,
      color: sortBy === col ? "var(--primary)" : "var(--text-secondary)",
      whiteSpace: "nowrap",
    }}>
      {label} {sortBy === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  const wrColor = (wr) => wr >= 55 ? "var(--success)" : wr <= 45 ? "var(--danger)" : "var(--text-primary)";

  // Tier counts for legend
  const tierCounts = useMemo(() => {
    const counts = { S: 0, A: 0, B: 0, C: 0 };
    sorted.forEach(c => { const t = getTier(c); if (t) counts[t]++; });
    return counts;
  }, [sorted]);

  const hasDelta = Object.keys(deltaMap).length > 0;

  return (
    <div className="animate-slide-up">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h2 className="font-heading" style={{ fontSize: 32 }}>
          <ChartLine size={28} style={{ marginRight: 10, color: "var(--primary)" }} />
          Stats Champions
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {splits.map(s => (
            <button
              key={s.key}
              onClick={() => setSelectedSplit(s.key)}
              className={selectedSplit === s.key ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: 12, padding: "6px 14px" }}
            >
              {s.label}
              {s.total_games > 0 && <span style={{ marginLeft: 6, opacity: 0.7 }}>({s.total_games}G)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Subtitle + tier legend */}
      {data && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {data.split_label} — {data.total_games} game{data.total_games !== 1 ? "s" : ""} jouée{data.total_games !== 1 ? "s" : ""}
            {hasDelta && <span style={{ marginLeft: 8, color: "var(--text-secondary)", fontSize: 11 }}>· delta vs split précédent</span>}
          </div>
          {data.total_games > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {["S", "A", "B", "C"].map(t => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <TierBadge tier={t} />
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{tierCounts[t]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>Chargement...</div>}

      {!loading && data?.total_games === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 60 }}>
          <ChartLine size={64} style={{ color: "var(--text-secondary)", marginBottom: 16 }} />
          <h3 className="font-heading" style={{ marginBottom: 8 }}>Aucun match joué</h3>
          <p style={{ color: "var(--text-secondary)" }}>Les stats apparaîtront au fur et à mesure des matchs.</p>
        </div>
      )}

      {/* Role filters */}
      {!loading && data?.total_games > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {Object.keys(ROLE_META).map(role => (
            <RoleFilter
              key={role}
              role={role}
              active={roleFilter === role}
              onClick={() => setRoleFilter(role)}
            />
          ))}
        </div>
      )}

      {/* Table */}
      {!loading && sorted.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", background: "var(--surface)" }}>
                <th style={{ padding: "10px 12px", textAlign: "center", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", width: 52 }}>Tier</th>
                <SortHeader col="name" label="Champion" align="left" />
                <SortHeader col="picks" label="Picks" />
                <SortHeader col="pick_rate" label="Pick %" />
                <SortHeader col="bans" label="Bans" />
                <SortHeader col="ban_rate" label="Ban %" />
                <SortHeader col="presence" label="Présence %" />
                <SortHeader col="win_rate" label="Win Rate" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((champ, i) => {
                const tier = getTier(champ);
                const delta = deltaMap[champ.name];
                const roleColor = ROLE_META[champ.main_role]?.color || "var(--text-secondary)";
                return (
                  <tr key={champ.name} style={{
                    borderBottom: "1px solid var(--border-subtle)",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                  }}>
                    {/* Tier */}
                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
                      <TierBadge tier={tier} />
                    </td>

                    {/* Champion + role dot */}
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <img
                          src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${toDDKey(champ.name)}.png`}
                          alt={champ.name}
                          style={{ width: 32, height: 32, borderRadius: 4, border: "1px solid var(--border-subtle)" }}
                          onError={e => { e.currentTarget.style.opacity = "0"; }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{champ.name}</div>
                          {champ.main_role && (
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: roleColor }} />
                              <span style={{ fontSize: 10, color: roleColor, fontWeight: 600 }}>{champ.main_role}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Picks */}
                    <td style={{ textAlign: "center", padding: "8px 12px" }}>
                      <span className="font-stats" style={{ fontWeight: 700 }}>{champ.picks}</span>
                    </td>

                    {/* Pick % */}
                    <td style={{ textAlign: "center", padding: "8px 12px" }}>
                      <span className="font-stats" style={{ color: "var(--primary)" }}>{champ.pick_rate}%</span>
                    </td>

                    {/* Bans */}
                    <td style={{ textAlign: "center", padding: "8px 12px" }}>
                      <span className="font-stats" style={{ fontWeight: 700 }}>{champ.bans}</span>
                    </td>

                    {/* Ban % */}
                    <td style={{ textAlign: "center", padding: "8px 12px" }}>
                      <span className="font-stats" style={{ color: "var(--danger)" }}>{champ.ban_rate}%</span>
                    </td>

                    {/* Présence bar */}
                    <td style={{ textAlign: "center", padding: "8px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <div style={{ width: 60, height: 6, background: "var(--border-subtle)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, champ.presence)}%`, height: "100%", background: "var(--secondary)", borderRadius: 3 }} />
                        </div>
                        <span className="font-stats" style={{ color: "var(--secondary)", fontSize: 12 }}>{champ.presence}%</span>
                      </div>
                    </td>

                    {/* Win Rate + delta */}
                    <td style={{ textAlign: "center", padding: "8px 12px" }}>
                      {champ.picks > 0 ? (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span className="font-stats" style={{ fontWeight: 700, color: wrColor(champ.win_rate) }}>
                            {champ.win_rate}%
                          </span>
                          <DeltaBadge delta={delta} />
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StatsPage;
