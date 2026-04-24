import React, { useState, useEffect, useMemo } from "react";
import { ChartLine, Trophy, Headphones, Calendar, ArrowRight } from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";
import { API_CLIENT } from "../shared";

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
      const [eloRes, teamsRes, splitRes] = await Promise.all([
        API_CLIENT.get(`/career/elo-history`),
        API_CLIENT.get(`/teams`),
        API_CLIENT.get(`/career/split-stats`, { params: { split: selectedSplit } })
      ]);

      setEloHistory(eloRes.data);
      setTeams(teamsRes.data.filter(t => t.id !== userTeam.id));
      setSplitStats(splitRes.data);
    } catch (e) {
      showToast("Erreur lors du chargement des données", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleOpponentSelect = async (opponentId) => {
    if (!opponentId) return;
    setSelectedOpponent(opponentId);
    try {
      const res = await API_CLIENT.get(`/career/head-to-head/${userTeam.id}/${opponentId}`);
      setHeadToHead(res.data);
    } catch (e) {
      showToast("Erreur lors du chargement du duel", "error");
    }
  };

  const handleSplitChange = async (splitKey) => {
    setSelectedSplit(splitKey);
    try {
      const res = await API_CLIENT.get(`/career/split-stats`, { params: { split: splitKey } });
      setSplitStats(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  // --- Helpers pour le Graphique ---
  const globalStats = useMemo(() => {
  if (!eloHistory?.history) return { wins: 0, losses: 0, rate: 0 };
  
  // On additionne les stats de TOUS les splits présents dans l'historique
  const totalWins = eloHistory.history.reduce((sum, h) => sum + (h.wins || 0), 0);
  const totalLosses = eloHistory.history.reduce((sum, h) => sum + (h.losses || 0), 0);
  const totalGames = totalWins + totalLosses;
  
  return {
    wins: totalWins,
    losses: totalLosses,
    rate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0
  };
}, [eloHistory]);
const eloChartData = useMemo(() => {
  if (!eloHistory?.history) return [];
  // Ordre chronologique : tri par saison puis numéro de split
  return [...eloHistory.history]
    .filter(d => d.elo != null)  // ignorer les entrées sans snapshot ELO
    .sort((a, b) => a.season !== b.season ? a.season - b.season : a.split_number - b.split_number);
}, [eloHistory]);
  const eloValues = eloChartData.map(d => d.elo).filter(v => v != null);
  const maxElo = (eloValues.length > 0 ? Math.max(...eloValues) : 1100) + 20;
  const minElo = (eloValues.length > 0 ? Math.min(...eloValues) : 900) - 20;

  const getEloColor = (elo) => {
    if (elo >= 1170) return "var(--success)";
    if (elo >= 1070) return "var(--accent)";
    if (elo >= 1020) return "var(--amber)";
    return "var(--danger)";
  };

  if (loading) return <div style={{ textAlign: "center", padding: 60 }}><div className="spinner" /></div>;
  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24, display: 'flex', alignItems: 'center' }}>
        <ChartLine size={32} style={{ marginRight: 12, color: "var(--accent)" }} />
        Historique & Statistiques
      </h2>

      {/* Navigation Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[
          { id: 'elo', icon: <ChartLine />, label: 'Évolution ELO' },
          { id: 'splits', icon: <Calendar />, label: 'Stats par Split' },
          { id: 'headtohead', icon: <Headphones />, label: 'Head-to-Head' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? "btn-primary" : "btn-secondary"}
            style={{ padding: "10px 20px", display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* --- SECTION ELO --- */}
      {activeTab === "elo" && (
  <div className="card" style={{ padding: 24 }}>
    <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
      <div style={{ flex: 1, padding: 20, background: "var(--surface-1)", borderRadius: "var(--radius-lg)" }}>
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>ELO Actuel</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: getEloColor(eloHistory?.current_team?.elo) }}>
          {/* Correction : On affiche 0 si la donnée est manquante */}
          {eloHistory?.current_team?.elo ? eloHistory.current_team.elo.toFixed(0) : "1000"}
        </div>
      </div>
      <div style={{ flex: 1, padding: 20, background: "var(--surface-1)", borderRadius: "var(--radius-lg)" }}>
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>Winrate Global</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "var(--success)" }}>
          {/* Correction du NaN% : On vérifie si le total des matchs est > 0 */}
          {eloHistory?.current_team?.wins + eloHistory?.current_team?.losses > 0 
            ? Math.round((eloHistory.current_team.wins / (eloHistory.current_team.wins + eloHistory.current_team.losses)) * 100) 
            : 0}%
        </div>
      </div>
    </div>
  

          {/* SVG Chart simple (ELO Evolution) */}
         <div style={{ height: 250, width: '100%', marginTop: 20, position: 'relative' }}>
  {eloChartData.length > 0 ? (
    <svg 
      width="100%" 
      height="100%" 
      viewBox="0 0 1000 100" 
      preserveAspectRatio="none" 
      style={{ overflow: 'visible' }}
    >
      {/* Lignes de repère (Grille horizontale) */}
      {[0, 25, 50, 75, 100].map(val => (
        <line 
          key={val} x1="0" y1={val} x2="1000" y2={val} 
          stroke="var(--border)" strokeWidth="0.5" 
        />
      ))}

      {/* Ligne ELO (Seulement si + de 1 point) */}
      {eloChartData.length > 1 && (
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={eloChartData.map((d, i) => {
            const x = (i / (eloChartData.length - 1)) * 1000;
            const y = 100 - ((d.elo - minElo) / (maxElo - minElo)) * 100;
            return `${x},${y}`;
          }).join(" ")}
        />
      )}

      {/* Points (Circles) */}
      {eloChartData.map((d, i) => {
        const x = eloChartData.length > 1 ? (i / (eloChartData.length - 1)) * 1000 : 500;
        const y = 100 - ((d.elo - minElo) / (maxElo - minElo)) * 100;
        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r="5"
              fill="var(--surface-1)"
              stroke={getEloColor(d.elo)}
              strokeWidth="3"
            />
            {/* Tooltip ELO au dessus du point */}
            <text 
              x={x} y={y - 12} 
              textAnchor="middle" 
              fontSize="12" fill="var(--text-1)" 
              fontWeight="700"
            >
              {d.elo.toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  ) : (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>
      Aucune donnée d'historique disponible
    </div>
  )}
</div>
        </div>
      )}

      {/* --- SECTION SPLITS --- */}
      {activeTab === "splits" && (
        <div className="card" style={{ padding: 24 }}>
            <h3 className="font-heading" style={{marginBottom: 20}}>Analyses par Split</h3>
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
                {eloHistory?.history?.map(h => (
                    <button 
                        key={h.split_key}
                        onClick={() => handleSplitChange(h.split_key)}
                        className={selectedSplit === h.split_key ? "btn-primary" : "btn-secondary"}
                        style={{fontSize: 12}}
                    >
                        {h.split_label}
                    </button>
                ))}
            </div>
            
            {splitStats && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <div style={{ padding: 20, background: 'var(--surface-1)', borderRadius: "var(--radius-lg)", textAlign: 'center' }}>
                        <Trophy size={32} color="var(--amber)" />
                        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>Rank #{splitStats.user_team?.final_rank || '?'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Classement Final</div>
                    </div>
                    <div style={{ padding: 20, background: 'var(--surface-1)', borderRadius: "var(--radius-lg)", textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>
                            {splitStats.user_team?.wins}V - {splitStats.user_team?.losses}D
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>Record du Split</div>
                    </div>
                </div>
            )}
        </div>
      )}

      {/* --- SECTION HEAD-TO-HEAD --- */}
      {activeTab === "headtohead" && (
        <div className="card" style={{ padding: 24 }}>
          <div style={{ marginBottom: 32 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)", display: 'block', marginBottom: 8 }}>Comparer avec :</label>
            <select
              value={selectedOpponent || ""}
              onChange={(e) => handleOpponentSelect(e.target.value)}
              style={{ width: "100%", padding: "12px", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--text-1)" }}
            >
              <option value="">Sélectionner une équipe...</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.abbr})</option>)}
            </select>
          </div>

          {headToHead ? (
            <div className="animate-fade-in">
              {/* Comparaison Visuelle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 40 }}>
                <div style={{ textAlign: "center", flex: 1 }}>
                  <TeamLogo teamId={headToHead.team1.id} abbr={headToHead.team1.abbr} size={60} />
                  <div style={{ fontSize: 40, fontWeight: 900, color: "var(--accent)" }}>{headToHead.record.team1_wins}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>{headToHead.team1.name}</div>
                </div>

                <div style={{ textAlign: "center", padding: "0 20px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-2)", background: "var(--surface-1)", padding: "4px 12px", borderRadius: 20 }}>VS</div>
                </div>

                <div style={{ textAlign: "center", flex: 1 }}>
                  <TeamLogo teamId={headToHead.team2.id} abbr={headToHead.team2.abbr} size={60} />
                  <div style={{ fontSize: 40, fontWeight: 900, color: "var(--danger)" }}>{headToHead.record.team2_wins}</div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>{headToHead.team2.name}</div>
                </div>
              </div>

              {/* Barre de Probabilité */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
                    <span>Chances de victoire</span>
                    <span>{headToHead.record.win_probability.team1.toFixed(0)}% vs {headToHead.record.win_probability.team2.toFixed(0)}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, display: 'flex', overflow: 'hidden' }}>
                    <div style={{ width: `${headToHead.record.win_probability.team1}%`, background: 'var(--accent)' }} />
                    <div style={{ width: `${headToHead.record.win_probability.team2}%`, background: 'var(--danger)' }} />
                </div>
              </div>

              {/* Liste des matchs récents */}
              <h4 style={{ fontSize: 14, marginBottom: 16 }}>Dernières confrontations</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {headToHead.matches.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface-1)', borderRadius: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Semaine {m.week}</span>
                    <span style={{ fontWeight: 700 }}>{m.score1} - {m.score2}</span>
                    <span style={{ 
                        fontSize: 11, 
                        fontWeight: 700, 
                        color: m.winner === userTeam.id ? 'var(--success)' : 'var(--danger)',
                        textTransform: 'uppercase' 
                    }}>
                        {m.winner === userTeam.id ? 'Victoire' : 'Défaite'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-2)" }}>
              <ArrowRight size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
              <p>Sélectionnez un rival pour analyser vos duels</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryPage;