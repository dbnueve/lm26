import React, { useState, useEffect, useMemo } from "react";
import { ChartLine, Trophy, Headphones, ArrowRight, Calendar } from "@phosphor-icons/react";
import axios from "axios";
import TeamLogo from "./TeamLogo";
import { API } from "../shared";

// History Page - ELO evolution, split stats, head-to-head
const HistoryPage = ({ userTeam, showToast }) => {
  const [eloHistory, setEloHistory] = useState(null);
  const [splitStats, setSplitStats] = useState(null);
  const [headToHead, setHeadToHead] = useState(null);
  const [activeTab, setActiveTab] = useState("elo");
  const [selectedSplit, setSelectedSplit] = useState("current");
  const [selectedOpponent, setSelectedOpponent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch ELO history
      const eloRes = await axios.get(API + "/career/elo-history");
      setEloHistory(eloRes.data);

      // Fetch all teams for head-to-head
      const teamsRes = await axios.get(API + "/teams");
      setTeams(teamsRes.data.filter(t => t.id !== userTeam.id));

      // Fetch split stats
      const splitRes = await axios.get(API + "/career/split-stats", {
        params: { split: selectedSplit }
      });
      setSplitStats(splitRes.data);
    } catch (e) {
      console.error("Error fetching history data:", e);
      showToast("Erreur lors du chargement des données", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleOpponentSelect = async (opponentId) => {
    setSelectedOpponent(opponentId);
    try {
      const res = await axios.get(API + `/career/head-to-head/${userTeam.id}/${opponentId}`);
      setHeadToHead(res.data);
    } catch (e) {
      console.error("Error fetching head-to-head:", e);
      showToast("Erreur lors du chargement du head-to-head", "error");
    }
  };

  const handleSplitChange = async (splitKey) => {
    setSelectedSplit(splitKey);
    try {
      const res = await axios.get(API + "/career/split-stats", {
        params: { split: splitKey }
      });
      setSplitStats(res.data);
      // Update ELO history to mark current split
      if (splitKey === "current" && eloHistory) {
        setEloHistory(prev => ({
          ...prev,
          history: prev.history.map(h => ({
            ...h,
            is_current: h.split_key === "current"
          }))
        }));
      }
    } catch (e) {
      console.error("Error changing split:", e);
    }
  };

  // ELO Chart Data
  const eloChartData = useMemo(() => {
    if (!eloHistory?.history) return [];
    return eloHistory.history.map(h => ({
      label: h.split_label,
      elo: h.elo,
      wins: h.wins,
      losses: h.losses,
      isCurrent: h.is_current,
    }));
  }, [eloHistory]);

  const maxElo = Math.max(...eloChartData.map(d => d.elo), 1100);
  const minElo = Math.min(...eloChartData.map(d => d.elo), 900);

  const getEloColor = (elo) => {
    const avg = 1070;
    if (elo >= avg + 100) return "var(--success)";
    if (elo >= avg) return "var(--primary)";
    if (elo >= avg - 50) return "var(--warning)";
    return "var(--danger)";
  };

  if (loading) {
    return (
      <div className="animate-slide-up" style={{ textAlign: "center", padding: 60 }}>
        <div className="spinner" style={{ width: 48, height: 48, margin: "0 auto 16px" }} />
        <p style={{ color: "var(--text-secondary)" }}>Chargement de l'historique...</p>
      </div>
    );
  }

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
        <ChartLine size={28} style={{ marginRight: 10, color: "var(--primary)" }} />
        Historique & Statistiques
      </h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" }}>
        <button
          onClick={() => setActiveTab("elo")}
          className={activeTab === "elo" ? "btn-primary" : "btn-secondary"}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          <ChartLine size={16} style={{ marginRight: 6 }} />
          Évolution ELO
        </button>
        <button
          onClick={() => setActiveTab("splits")}
          className={activeTab === "splits" ? "btn-primary" : "btn-secondary"}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          <Calendar size={16} style={{ marginRight: 6 }} />
          Stats par Split
        </button>
        <button
          onClick={() => setActiveTab("headtohead")}
          className={activeTab === "headtohead" ? "btn-primary" : "btn-secondary"}
          style={{ padding: "8px 16px", fontSize: 14 }}
        >
          <Headphones size={16} style={{ marginRight: 6 }} />
          Head-to-Head
        </button>
      </div>

      {activeTab === "elo" && (
        <div className="card" style={{ padding: 24 }}>
          <h3 className="font-heading" style={{ marginBottom: 20, color: "var(--text-secondary)" }}>
            Évolution de la puissance (ELO)
          </h3>

          {/* Current ELO Card */}
          <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200, padding: 20, background: "var(--surface)", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>ELO Actuel</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: getEloColor(eloHistory?.current_team?.elo || 1000) }}>
                {eloHistory?.current_team?.elo?.toFixed(0) || "-"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                {eloHistory?.current_team?.elo_games || 0} matchs joués
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200, padding: 20, background: "var(--surface)", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>Record</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: "var(--success)" }}>
                {Math.round((eloHistory?.current_team?.wins || 0) / Math.max(1, (eloHistory?.current_team?.wins || 0) + (eloHistory?.current_team?.losses || 0)) * 100)}%
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                {(eloHistory?.current_team?.wins || 0)}V - {(eloHistory?.current_team?.losses || 0)}D
              </div>
            </div>
          </div>

          {/* ELO Chart */}
          <div style={{ height: 300, position: "relative" }}>
            {eloChartData.length > 0 && (
              <>
                <svg width="100%" height="100%" style={{ overflow: "visible" }}>
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((y, i) => (
                    <line
                      key={i}
                      x1="0" y1={`${y * 100}%`}
                      x2="100%" y2={`${y * 100}%`}
                      stroke="var(--border-subtle)"
                      strokeWidth="1"
                    />
                  ))}
                  {/* ELO line */}
                  <polyline
                    points={eloChartData.map((d, i) => {
                      const x = (i / (eloChartData.length - 1)) * 100;
                      const y = ((d.elo - minElo) / (maxElo - minElo)) * 85 + 10;
                      return `${x},${y}%`;
                    }).join(" ")}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Data points */}
                  {eloChartData.map((d, i) => {
                    const x = (i / (eloChartData.length - 1)) * 100;
                    const y = ((d.elo - minElo) / (maxElo - minElo)) * 85 + 10;
                    return (
                      <g key={i}>
                        <circle
                          cx={`${x}%`}
                          cy={`${y}%`}
                          r={d.isCurrent ? 6 : 4}
                          fill="var(--surface)"
                          stroke={getEloColor(d.elo)}
                          strokeWidth="2"
                        />
                        {/* Tooltip text */}
                        <text
                          x={`${x}%`}
                          y={`${y - 15}%`}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--text-primary)"
                          style={{ fontWeight: 600 }}
                        >
                          {d.elo.toFixed(0)}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* X-axis labels */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11 }}>
                  {eloChartData.map((d, i) => (
                    <span
                      key={i}
                      style={{
                        color: i % Math.ceil(eloChartData.length / 5) === 0 ? "var(--text-secondary)" : "transparent",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {d.label.replace(/^[A-Z]+/, "")}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* History Table */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12 }}>
              Historique par Split
            </h4>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border-subtle)" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--text-secondary)" }}>
                      Split
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "var(--text-secondary)" }}>
                      ELO
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "var(--text-secondary)" }}>
                      Record
                    </th>
                    <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "var(--text-secondary)" }}>
                      Rank
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eloHistory?.history.map((h, i) => (
                    <tr key={i} style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      background: h.isCurrent ? "rgba(var(--primary-rgb, 200,155,60), 0.05)" : "transparent"
                    }}>
                      <td style={{ padding: "8px 12px", fontWeight: h.isCurrent ? 600 : 400 }}>
                        {h.split_label}
                        {h.isCurrent && <span style={{ marginLeft: 8, fontSize: 10, color: "var(--primary)" }}>● Actuel</span>}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <span style={{ color: getEloColor(h.elo), fontWeight: 700 }}>{h.elo.toFixed(0)}</span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <span style={{ color: "var(--success)", fontWeight: 700 }}>{h.wins}</span>
                        <span style={{ color: "var(--text-secondary)", margin: "0 6px" }}>-</span>
                        <span style={{ color: "var(--danger)", fontWeight: 700 }}>{h.losses}</span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        {h.final_rank ? (
                          <span style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: h.final_rank === 1 ? "var(--secondary)" : "var(--surface-hover)",
                            color: h.final_rank === 1 ? "var(--surface)" : "var(--text-primary)",
                            fontWeight: 700,
                            fontSize: 12
                          }}>
                            {h.final_rank}
                          </span>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "splits" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Split Selector */}
          <div className="card" style={{ padding: 24 }}>
            <h3 className="font-heading" style={{ marginBottom: 20, color: "var(--text-secondary)" }}>
              Sélectionner un Split
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
              {splitStats && splitStats.split_key === "current" ? (
                <>
                  <button
                    onClick={() => handleSplitChange("current")}
                    className="btn-primary"
                    style={{ padding: "8px 16px" }}
                  >
                    Split Actuel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleSplitChange("current")}
                    className={selectedSplit === "current" ? "btn-primary" : "btn-secondary"}
                    style={{ padding: "8px 16px" }}
                  >
                    Split Actuel
                  </button>
                  {eloHistory?.history.filter(h => !h.isCurrent).map((h, i) => (
                    <button
                      key={i}
                      onClick={() => handleSplitChange(h.split_key)}
                      className={selectedSplit === h.split_key ? "btn-primary" : "btn-secondary"}
                      style={{ padding: "8px 16px" }}
                    >
                      {h.split_label}
                    </button>
                  ))}
                </>
              )}
            </div>

            {splitStats && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
                  <div style={{
                    width: 60, height: 60,
                    background: "var(--surface-hover)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <Trophy size={32} style={{ color: "var(--secondary)" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{splitStats.split_label}</div>
                    <div style={{ color: "var(--text-secondary)" }}>
                      {splitStats.season} • Split {splitStats.split_number}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
                  <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Victoires</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--success)" }}>
                      {splitStats.user_team?.wins || 0}
                    </div>
                  </div>
                  <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Défaites</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>
                      {splitStats.user_team?.losses || 0}
                    </div>
                  </div>
                  {splitStats.user_team?.final_rank && (
                    <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Rank Final</div>
                      <div style={{
                        fontSize: 28, fontWeight: 700,
                        color: splitStats.user_team?.final_rank === 1 ? "var(--secondary)" : "var(--text-primary)"
                      }}>
                        {splitStats.user_team?.final_rank}
                        {splitStats.user_team?.final_rank === 1 && <span style={{ marginLeft: 4 }}>🏆</span>}
                      </div>
                    </div>
                  )}
                  <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>Budget</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--primary)" }}>
                      {(splitStats.user_team?.budget || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Opponent Selector for Head-to-Head */}
          <div className="card" style={{ padding: 24 }}>
            <h3 className="font-heading" style={{ marginBottom: 20, color: "var(--text-secondary)" }}>
              Comparaison Head-to-Head
            </h3>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                Sélectionner un adversaire
              </label>
              <select
                value={selectedOpponent || ""}
                onChange={(e) => handleOpponentSelect(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-primary)",
                  fontSize: 14
                }}
              >
                <option value="">Sélectionner...</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.abbr})</option>
                ))}
              </select>
            </div>

            {headToHead && (
              <div style={{ animation: "fade-in 0.3s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                       <TeamLogo teamId={headToHead.team1.id} abbr={headToHead.team1.abbr} size={28} />
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{headToHead.team1.name}</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{headToHead.team1.abbr}</div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
                      {headToHead.record.team1_wins}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Victoires</div>
                  </div>

                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-secondary)" }}>
                    <ArrowRight size={16} style={{ margin: "4px 0" }} />
                    vs
                    <ArrowRight size={16} style={{ margin: "4px 0" }} />
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <TeamLogo teamId={headToHead.team1.id} abbr={headToHead.team1.abbr} size={28} />
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{headToHead.team2.name}</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{headToHead.team2.abbr}</div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>
                      {headToHead.record.team2_wins}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Victoires</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ padding: 12, background: "var(--surface)", borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ELO</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--primary)" }}>
                      {headToHead.team1.elo.toFixed(0)}
                    </div>
                  </div>
                  <div style={{ padding: 12, background: "var(--surface)", borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ELO</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--danger)" }}>
                      {headToHead.team2.elo.toFixed(0)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textAlign: "center" }}>
                    Probabilité de victoire: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{headToHead.record.win_probability.team1}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textAlign: "center" }}>
                    Probabilité de victoire: <span style={{ color: "var(--danger)", fontWeight: 700 }}>{headToHead.record.win_probability.team2}%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "headtohead" && (
        <div className="card" style={{ padding: 24 }}>
          <h3 className="font-heading" style={{ marginBottom: 20, color: "var(--text-secondary)" }}>
            Comparaison Head-to-Head
          </h3>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
              Sélectionner un adversaire pour voir le record head-to-head
            </label>
            <select
              value={selectedOpponent || ""}
              onChange={(e) => handleOpponentSelect(e.target.value)}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text-primary)",
                fontSize: 16
              }}
            >
              <option value="">Sélectionner un adversaire...</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.abbr})</option>
              ))}
            </select>
          </div>

          {headToHead && (
            <div style={{ animation: "fade-in 0.3s" }}>
              {/* Team Comparison */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 32 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--primary)" }}>{headToHead.team1.name}</div>
                    <div style={{ color: "var(--text-secondary)" }}>{headToHead.team1.abbr}</div>
                  </div>
                  <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>ELO Actuel</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{headToHead.team1.elo.toFixed(0)}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                      Rating: {headToHead.team1.rating}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 48, fontWeight: 700, color: "var(--primary)" }}>
                    {headToHead.record.team1_wins}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                    {headToHead.record.team1_wins > headToHead.record.team2_wins ? "EN AVANCE" : "RETARD"}
                  </div>
                  <div style={{ fontSize: 48, fontWeight: 700, color: "var(--danger)" }}>
                    {headToHead.record.team2_wins}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
                    {headToHead.record.team2_wins > headToHead.record.team1_wins ? "EN AVANCE" : "RETARD"}
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>{headToHead.team2.name}</div>
                    <div style={{ color: "var(--text-secondary)" }}>{headToHead.team2.abbr}</div>
                  </div>
                  <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>ELO Actuel</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{headToHead.team2.elo.toFixed(0)}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                      Rating: {headToHead.team2.rating}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--primary)" }}>
                    {headToHead.record.win_probability.team1.toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                   Probabilité {headToHead.team1.abbr}
                  </div>
                </div>
                <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--text-secondary)" }}>
                    {headToHead.record.draws}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    Matchs Nuls
                  </div>
                </div>
                <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--danger)" }}>
                    {headToHead.record.win_probability.team2.toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    Probabilité {headToHead.team2.abbr}
                  </div>
                </div>
                <div style={{ padding: 16, background: "var(--surface)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--secondary)" }}>
                    {headToHead.record.total_matches}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    Matchs Joués
                  </div>
                </div>
              </div>

              {/* Match List */}
              {headToHead.matches.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12 }}>
                    Détail des Matchs
                  </h4>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid var(--border-subtle)" }}>
                          <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>Semaine</th>
                          <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>Match</th>
                          <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600 }}>Score</th>
                          <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600 }}>Résultat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headToHead.matches.map((m) => {
                          const t1Won = m.winner === headToHead.team1.id;
                          const t2Won = m.winner === headToHead.team2.id;
                          const won = t1Won;
                          return (
                            <tr key={m.id} style={{
                              borderBottom: "1px solid var(--border-subtle)",
                              background: m.played ? "transparent" : "rgba(255,255,255,0.02)"
                            }}>
                              <td style={{ padding: "8px 12px", color: "var(--text-secondary)" }}>
                                Semaine {m.week}
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <span style={{ fontWeight: 600 }}>{headToHead.team1.abbr}</span>
                                <span style={{ margin: "0 8px", color: "var(--text-secondary)" }}>vs</span>
                                <span style={{ fontWeight: 600 }}>{headToHead.team2.abbr}</span>
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700 }}>
                                {m.score1 || "-"} - {m.score2 || "-"}
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                {m.played ? (
                                  <span style={{
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    background: won ? "rgba(var(--success-rgb, 0.2))" : "rgba(var(--danger-rgb, 0.2))",
                                    color: won ? "var(--success)" : "var(--danger)",
                                    fontWeight: 600,
                                    fontSize: 12
                                  }}>
                                    {won ? "Victoire" : "Défaite"}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--warning)", fontSize: 12 }}>À jouer</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {!headToHead && selectedOpponent && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)" }}>
              <Headphones size={64} style={{ color: "var(--border-subtle)", marginBottom: 16 }} />
              <p>En attente de sélection d'un adversaire</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
