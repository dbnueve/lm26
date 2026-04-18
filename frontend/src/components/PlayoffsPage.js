import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Trophy, ArrowsClockwise } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";

// Playoffs Page — LEC Stage 2: 6-team double elimination, all Bo5
const PlayoffsPage = ({ userTeam, onPlayPlayoffMatch, showToast, onSplitEnd, onSimulateSeason, league = "LEC" }) => {
  const [playoffsData, setPlayoffsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [simSeason, setSimSeason] = useState(false);
  const splitEndTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (splitEndTimeoutRef.current) clearTimeout(splitEndTimeoutRef.current);
    };
  }, []);

  const fetchPlayoffs = useCallback(async () => {
    try {
      const res = await axios.get(API + "/playoffs");
      setPlayoffsData(res.data);
    } catch (e) {
      console.error("Error fetching playoffs:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlayoffs(); }, [fetchPlayoffs]);

  const simulateAIMatch = async (matchId) => {
    try {
      const res = await axios.post(API + "/playoffs/simulate-match", { match_id: matchId });
      fetchPlayoffs();
      showToast(`Série simulée: ${res.data.series_score.team1}-${res.data.series_score.team2}`, "info");
      if (res.data.champion && onSplitEnd) {
        splitEndTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) onSplitEnd();
        }, 1800);
      }
    } catch (e) {
      showToast(e.response?.data?.detail || "Erreur", "error");
    }
  };

  const handleSimSeason = async () => {
    setSimSeason(true);
    try { await onSimulateSeason(); await fetchPlayoffs(); }
    finally { setSimSeason(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-2)" }}>Chargement...</div>;

  const qualCount = league === "LPL" ? 10 : 6;

  if (!playoffsData?.active) {
    return (
      <div className="animate-slide-up">
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
          <Trophy size={32} style={{ marginRight: 12, color: "var(--amber)" }} />
          Playoffs {league}
        </h2>
        <div className="card" style={{ textAlign: "center", padding: 60 }}>
          <Trophy size={64} style={{ color: "var(--text-2)", marginBottom: 24 }} />
          <h3 className="font-heading" style={{ marginBottom: 16 }}>
            {playoffsData?.message || "Les playoffs n'ont pas encore commencé"}
          </h3>
          <p style={{ color: "var(--text-2)", marginBottom: 32 }}>
            Terminez la saison régulière pour accéder aux playoffs.<br />
            Les {qualCount} meilleures équipes seront qualifiées.
          </p>
          <button className="btn-secondary" onClick={handleSimSeason} disabled={simSeason}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ArrowsClockwise size={16} />
            {simSeason ? "Simulation..." : "Simuler la saison régulière"}
          </button>
        </div>
      </div>
    );
  }

  const ROUND_LABELS = {
    ub_r1:       "UB Round 1",
    ub_r2:       "UB Demi-Finales",
    ub_final:    "UB Finale",
    lb_r1:       "LB Round 1",
    lb_r2:       "LB Round 2",
    lb_r3:       "LB Round 3",
    lb_sf:       "LB Semi-Finale",
    lb_final:    "LB Finale",
    grand_final: "Grande Finale",
  };

  const isLPL = playoffsData.format === "lpl";

  const activeRounds = playoffsData.active_rounds || [];

  const MatchCard = ({ match }) => {
    const isUserMatch = userTeam.id === match.team1 || userTeam.id === match.team2;
    const canPlay = !match.completed && activeRounds.includes(match.round);
    const t1win = match.winner === match.team1;
    const t2win = match.winner === match.team2;
    return (
      <div style={{
        background: "var(--bg)", borderRadius: 8, padding: 14,
        border: isUserMatch && !match.completed ? "2px solid var(--accent)" : "1px solid var(--border)",
        opacity: !match.completed && !canPlay ? 0.5 : 1,
      }}>
        <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          {ROUND_LABELS[match.round]} · Bo5
          {match.completed && <span style={{ marginLeft: 8, background: "var(--success)", color: "#000", padding: "1px 6px", borderRadius: 2, fontWeight: 700 }}>TERMINÉ</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <TeamLogo teamId={match.team1_data?.id} abbr={match.team1_data?.abbr || ""} size={36} />
            <div style={{ fontSize: 11, marginTop: 4, color: t1win ? "var(--success)" : "var(--text-2)" }}>
              {match.team1_data?.abbr}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: "var(--surface-1)", borderRadius: 4 }}>
            <span className="font-stats" style={{ fontSize: 28, fontWeight: 900, color: t1win ? "var(--success)" : match.completed ? "var(--danger)" : "white" }}>
              {match.team1_wins}
            </span>
            <span style={{ color: "var(--text-2)" }}>-</span>
            <span className="font-stats" style={{ fontSize: 28, fontWeight: 900, color: t2win ? "var(--success)" : match.completed ? "var(--danger)" : "white" }}>
              {match.team2_wins}
            </span>
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <TeamLogo teamId={match.team2_data?.id} abbr={match.team2_data?.abbr || ""} size={36} />
            <div style={{ fontSize: 11, marginTop: 4, color: t2win ? "var(--success)" : "var(--text-2)" }}>
              {match.team2_data?.abbr}
            </div>
          </div>
        </div>
        {canPlay && (
          <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
            {isUserMatch ? (
              <button className="btn-primary" onClick={() => onPlayPlayoffMatch(match)}
                style={{ fontSize: 13, padding: "8px 16px" }}>
                Jouer (Bo5 · {match.team1_wins + match.team2_wins} games jouées)
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => simulateAIMatch(match.id)}
                style={{ fontSize: 12, padding: "6px 14px" }}>
                <ArrowsClockwise size={14} style={{ marginRight: 4 }} />
                Simuler
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const Section = ({ title, rounds, color }) => {
    const ms = playoffsData.matches?.filter(m => rounds.includes(m.round)) || [];
    if (ms.length === 0) return null;
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: color || "var(--text-2)", marginBottom: 8, textTransform: "uppercase" }}>
          {title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ms.map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 16 }}>
        <Trophy size={28} style={{ marginRight: 10, color: "var(--amber)" }} />
        Playoffs {league} 2026
      </h2>

      {/* Champion */}
      {playoffsData.champion && (
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="card" style={{ textAlign: "center", padding: 40, marginBottom: 24,
            background: "linear-gradient(135deg, rgba(255,184,0,0.2) 0%, rgba(255,184,0,0.05) 100%)",
            border: "2px solid var(--amber)" }}>
          <Trophy size={64} weight="fill" style={{ color: "var(--amber)", marginBottom: 12 }} />
          <h2 className="font-heading" style={{ fontSize: 32, color: "var(--amber)" }}>CHAMPION {league} 2026</h2>
          <div className="font-heading" style={{ fontSize: 44, marginTop: 8 }}>{playoffsData.champion.name}</div>
        </motion.div>
      )}

      {/* Seeds legend */}
      <div className="card" style={{ padding: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", marginRight: 4 }}>Qualifiés :</span>
          {playoffsData.qualified_teams?.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px",
              background: t.id === userTeam.id ? "var(--accent)" : t.bracket === "UB" ? "rgba(0,122,255,0.15)" : "rgba(255,51,102,0.12)",
              color: t.id === userTeam.id ? "#000" : "white", borderRadius: 4, fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>#{t.seed}</span>
              <TeamLogo teamId={t.id} abbr={t.abbr} size={20} />
              <span>{t.abbr}</span>
              <span style={{ fontSize: 10, color: t.id === userTeam.id ? "#000" : "var(--text-2)" }}>
                {t.bracket}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Double elimination bracket */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Upper Bracket */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", letterSpacing: 1, textTransform: "uppercase", borderBottom: "2px solid var(--accent)", paddingBottom: 6 }}>
            Upper Bracket
          </div>
          <Section title="Round 1" rounds={["ub_r1"]} />
          {isLPL && <Section title="Demi-Finales" rounds={["ub_r2"]} />}
          <Section title="UB Finale" rounds={["ub_final"]} />
        </div>

        {/* Lower Bracket */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)", letterSpacing: 1, textTransform: "uppercase", borderBottom: "2px solid var(--danger)", paddingBottom: 6 }}>
            Lower Bracket
          </div>
          <Section title={isLPL ? "Round 1 (7-10)" : "Round 1 (5v6)"} rounds={["lb_r1"]} color="var(--danger)" />
          <Section title="Round 2" rounds={["lb_r2"]} color="var(--danger)" />
          <Section title="Round 3" rounds={["lb_r3"]} color="var(--danger)" />
          {isLPL && <Section title="Semi-Finale" rounds={["lb_sf"]} color="var(--danger)" />}
          <Section title="LB Finale" rounds={["lb_final"]} color="var(--danger)" />
        </div>
      </div>

      {/* Grand Final */}
      {(playoffsData.matches?.some(m => m.round === "grand_final")) && (
        <div style={{ marginTop: 24, maxWidth: 480, margin: "24px auto 0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--amber)", textAlign: "center",
            letterSpacing: 2, textTransform: "uppercase", marginBottom: 12, borderBottom: "2px solid var(--amber)", paddingBottom: 6 }}>
            Grande Finale
          </div>
          {playoffsData.matches?.filter(m => m.round === "grand_final").map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      )}

    </div>
  );
};

export default PlayoffsPage;
