import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { API_CLIENT } from "../shared";
import MatchResultScoreboard from "./MatchResultScoreboard";

/**
 * MatchRecapModal — affiche le récap complet d'un match joué (stats, draft, MVP).
 *
 * Props:
 *   matchId    — ID du match à charger (null = fermé)
 *   userTeam   — objet équipe de l'utilisateur
 *   teams      — liste de toutes les équipes
 *   onClose    — callback fermeture
 */
export default function MatchRecapModal({ matchId, userTeam, teams, onClose }) {
  const [matchData, setMatchData] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    if (!matchId) { setMatchData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    API_CLIENT.get(`/match/${matchId}`)
      .then(res => { if (!cancelled) setMatchData(res.data); })
      .catch(err => { if (!cancelled) setError(err?.response?.data?.detail || "Erreur de chargement"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [matchId]);

  if (!matchId) return null;

  const isTeam1    = matchData?.team1 === userTeam?.id;
  const isTeam2    = matchData?.team2 === userTeam?.id;
  const isUserMatch = isTeam1 || isTeam2;
  const oppId      = isTeam1 ? matchData?.team2 : matchData?.team1;
  const opponentTeam = teams?.find(t => t.id === oppId) || { id: oppId, abbr: oppId, name: oppId };

  // Si pas de match_details (match non encore joué ou données insuffisantes),
  // on affiche une version simplifiée
  const hasDetails = !!matchData?.match_details;

  return (
    <AnimatePresence>
      {matchId && (
        <motion.div
          key="recap-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 1200,
            background: "rgba(0,0,0,.72)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <motion.div
            key="recap-panel"
            initial={{ scale: 0.92, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={e => e.stopPropagation()}
            style={{
              width: "95%", maxWidth: 860, maxHeight: "90vh",
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 8, overflow: "hidden",
              boxShadow: "0 32px 80px rgba(0,0,0,.8)",
              display: "flex", flexDirection: "column",
            }}
          >
            {/* Header minimal pour les états loading/error/no-details */}
            {(loading || error || !hasDetails) && (
              <div style={{
                padding: "14px 18px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "var(--surface-1)",
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                  Récapitulatif du match
                </span>
                <button onClick={onClose} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-2)", padding: 4,
                }}>
                  <X size={16} />
                </button>
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading && (
                <div style={{
                  padding: 48, textAlign: "center",
                  color: "var(--text-2)", fontSize: 13,
                }}>
                  Chargement...
                </div>
              )}

              {!loading && error && (
                <div style={{
                  padding: 48, textAlign: "center",
                  color: "var(--danger)", fontSize: 13,
                }}>
                  {error}
                </div>
              )}

              {!loading && !error && matchData && !hasDetails && (
                <SimpleRecap match={matchData} teams={teams} userTeam={userTeam} onClose={onClose} />
              )}

              {!loading && !error && matchData && hasDetails && (
                <MatchResultScoreboard
                  matchResult={{
                    ...matchData.match_details,
                    winner: isTeam1 ? (matchData.match_details?.winner === 1 ? userTeam?.id : oppId)
                                    : (matchData.match_details?.winner === 2 ? userTeam?.id : oppId),
                    match_details: matchData.match_details,
                  }}
                  userTeam={isUserMatch ? userTeam : (teams?.find(t => t.id === matchData.team1) || { id: matchData.team1, abbr: matchData.team1 })}
                  opponentTeam={isUserMatch ? opponentTeam : (teams?.find(t => t.id === matchData.team2) || { id: matchData.team2, abbr: matchData.team2 })}
                  isTeam1={isUserMatch ? isTeam1 : true}
                  teams={teams}
                  onClose={onClose}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Récap simplifié quand match_details absent (vieux matchs) ── */
function SimpleRecap({ match, teams, userTeam, onClose }) {
  const getTeam = id => teams?.find(t => t.id === id);
  const t1 = getTeam(match.team1);
  const t2 = getTeam(match.team2);
  const t1win = match.winner === match.team1;
  const t2win = match.winner === match.team2;
  const isUser1 = match.team1 === userTeam?.id;
  const isUser2 = match.team2 === userTeam?.id;
  const userWon = match.winner === userTeam?.id;

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
          Semaine {match.week} · {match.round || "Saison régulière"}
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", padding: 4 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, justifyContent: "center" }}>
        {/* Team 1 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", overflow: "hidden",
            border: `2px solid ${t1win ? "var(--success)" : "var(--border)"}`,
          }}>
            {t1 && <img src={`/logos/${match.team1}.png`} alt={t1.abbr}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={e => { e.currentTarget.style.display = "none"; }} />}
          </div>
          <span style={{ fontWeight: isUser1 ? 800 : 600, fontSize: 15, color: t1win ? "var(--text-1)" : "var(--text-2)" }}>
            {t1?.abbr || match.team1}
          </span>
          {t1win && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--success)", letterSpacing: 1 }}>VICTOIRE</span>}
        </div>

        {/* Score */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 3, fontFamily: "'Chakra Petch', monospace" }}>
            <span style={{ color: t1win ? "var(--success)" : "var(--danger)" }}>{match.score1}</span>
            <span style={{ color: "var(--text-2)", margin: "0 8px", fontSize: 24 }}>–</span>
            <span style={{ color: t2win ? "var(--success)" : "var(--danger)" }}>{match.score2}</span>
          </div>
          <div style={{
            marginTop: 8, padding: "4px 12px", borderRadius: 12, display: "inline-block",
            background: userWon ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.1)",
            border: `1px solid ${userWon ? "rgba(34,197,94,.3)" : "rgba(239,68,68,.25)"}`,
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: userWon ? "var(--success)" : "var(--danger)",
          }}>
            {(isUser1 || isUser2) ? (userWon ? "VICTOIRE" : "DÉFAITE") : "Terminé"}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-2)" }}>
            Pas de détails disponibles pour ce match
          </div>
        </div>

        {/* Team 2 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", overflow: "hidden",
            border: `2px solid ${t2win ? "var(--success)" : "var(--border)"}`,
          }}>
            {t2 && <img src={`/logos/${match.team2}.png`} alt={t2.abbr}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={e => { e.currentTarget.style.display = "none"; }} />}
          </div>
          <span style={{ fontWeight: isUser2 ? 800 : 600, fontSize: 15, color: t2win ? "var(--text-1)" : "var(--text-2)" }}>
            {t2?.abbr || match.team2}
          </span>
          {t2win && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--success)", letterSpacing: 1 }}>VICTOIRE</span>}
        </div>
      </div>
    </div>
  );
}
