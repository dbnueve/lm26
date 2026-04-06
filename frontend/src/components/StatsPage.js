import React, { useState, useEffect, useMemo } from "react";
import { ChartLine } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";

// Stats Page — Champion pick/ban/WR per split
const StatsPage = () => {
  const [data, setData] = useState(null);
  const [splits, setSplits] = useState([]);
  const [selectedSplit, setSelectedSplit] = useState("current");
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("presence");
  const [sortDir, setSortDir] = useState("desc");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [ddVersion, setDdVersion] = useState("14.24.1");

  useEffect(() => {
    fetch("https://ddragon.leagueoflegends.com/api/versions.json")
      .then(r => r.json()).then(v => { if (v[0]) setDdVersion(v[0]); }).catch(() => {});
    axios.get(API + "/stats/splits").then(r => setSplits(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get(API + "/stats/champions", { params: { split: selectedSplit } })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedSplit]);

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

  const SortHeader = ({ col, label }) => (
    <th onClick={() => toggleSort(col)} style={{
      padding: "10px 12px", textAlign: col === "name" ? "left" : "center",
      cursor: "pointer", userSelect: "none", fontSize: 11, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: 1, color: sortBy === col ? "var(--primary)" : "var(--text-secondary)",
      whiteSpace: "nowrap"
    }}>
      {label} {sortBy === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  const toDDKey = (name) => {
    const overrides = { "K'Sante": "KSante", "Kai'Sa": "Kaisa", "Wukong": "MonkeyKing",
      "Renata Glasc": "Renata", "Bel'Veth": "Belveth", "Cho'Gath": "Chogath",
      "Dr. Mundo": "DrMundo", "Kog'Maw": "KogMaw", "Kha'Zix": "Khazix",
      "Vel'Koz": "Velkoz", "Nunu & Willump": "Nunu", "Aurelion Sol": "AurelionSol",
      "Jarvan IV": "JarvanIV", "Lee Sin": "LeeSin", "Master Yi": "MasterYi",
      "Miss Fortune": "MissFortune", "Twisted Fate": "TwistedFate",
      "Xin Zhao": "XinZhao", "Tahm Kench": "TahmKench", "LeBlanc": "Leblanc",
      "Nunu & Willump": "Nunu", "Rek'Sai": "RekSai" };
    return overrides[name] || name.replace(/[^a-zA-Z0-9]/g, "");
  };

  const wrColor = (wr) => wr >= 60 ? "var(--success)" : wr <= 40 ? "var(--danger)" : "var(--text-primary)";
  console.log(splits);
  return (
    <div className="animate-slide-up">
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
      {data && (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          {data.split_label} — {data.total_games} game{data.total_games !== 1 ? "s" : ""} jouée{data.total_games !== 1 ? "s" : ""}
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

      {!loading && data?.total_games > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {["ALL", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"].map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={roleFilter === role ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: 12, padding: "5px 12px" }}
            >
              {role === "ALL" ? "Tous" : role}
            </button>
          ))}
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", background: "var(--surface)" }}>
                <SortHeader col="name" label="Champion" />
                <SortHeader col="picks" label="Picks" />
                <SortHeader col="pick_rate" label="Pick %" />
                <SortHeader col="bans" label="Bans" />
                <SortHeader col="ban_rate" label="Ban %" />
                <SortHeader col="presence" label="Présence %" />
                <SortHeader col="win_rate" label="Win Rate" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((champ, i) => (
                <tr key={champ.name} style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                }}>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${toDDKey(champ.name)}.png`}
                        alt={champ.name}
                        style={{ width: 32, height: 32, borderRadius: 4, border: "1px solid var(--border-subtle)" }}
                        onError={e => { e.currentTarget.style.opacity = "0"; }}
                      />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{champ.name}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    <span className="font-stats" style={{ fontWeight: 700 }}>{champ.picks}</span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    <span className="font-stats" style={{ color: "var(--primary)" }}>{champ.pick_rate}%</span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    <span className="font-stats" style={{ fontWeight: 700 }}>{champ.bans}</span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    <span className="font-stats" style={{ color: "var(--danger)" }}>{champ.ban_rate}%</span>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <div style={{ width: 60, height: 6, background: "var(--border-subtle)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, champ.presence)}%`, height: "100%", background: "var(--secondary)", borderRadius: 3 }} />
                      </div>
                      <span className="font-stats" style={{ color: "var(--secondary)", fontSize: 12 }}>{champ.presence}%</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center", padding: "8px 12px" }}>
                    {champ.picks > 0 ? (
                      <span className="font-stats" style={{ fontWeight: 700, color: wrColor(champ.win_rate) }}>
                        {champ.win_rate}%
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StatsPage;
