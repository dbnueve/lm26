import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Lightning, GameController, Sword } from "@phosphor-icons/react";
import { API_CLIENT } from "../shared";
import TeamLogo from "./TeamLogo";
import MatchTimeline from "./MatchTimeline";
import MatchResultScoreboard from "./MatchResultScoreboard";

// Match Simulation Component
const MatchSimulation = ({ match, userTeam, teams, onClose, onStartDraft, draftCompleted, draftState, onSimulate }) => {
  const [phase, setPhase] = useState(draftCompleted ? "ready" : "pre");
  const [matchResult, setMatchResult] = useState(null);
  const [simError, setSimError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const simLockRef = useRef(false);
  const timeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const opponent = match.team1 === userTeam.id ? match.team2 : match.team1;
  const opponentTeam = teams.find(t => t.id === opponent);
  const isTeam1 = match.team1 === userTeam.id;

  const startMatch = async () => {
    if (simLockRef.current) return;
    simLockRef.current = true;
    setSimulating(true);
    setSimError(null);
    setPhase("playing");

    const userDraft = draftState ? {
      picks: draftState.user_picks || [],
      bans: draftState.user_bans || [],
      enemy_picks: draftState.enemy_picks || [],
      enemy_bans: draftState.enemy_bans || [],
    } : null;

    try {
      // onSimulate (used by MP) returns the same shape as /match/simulate.
      // In solo mode we fall back to the direct endpoint.
      const data = onSimulate
        ? await onSimulate(userDraft)
        : (await axios.post(API + "/match/simulate", {
            match_id: match.id,
            user_draft: userDraft,
          }, { timeout: 15000 })).data;
      timeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setMatchResult(data);
        setPhase("timeline");
        setSimulating(false);
        simLockRef.current = false;
      }, 2500);
    } catch (e) {
      console.error("Error simulating match:", e);
      const msg = e.response?.data?.detail
        || (e.code === "ECONNABORTED" ? "Délai dépassé. Réessaye." : "Erreur de simulation. Réessaye.");
      if (!mountedRef.current) return;
      setSimError(msg);
      setPhase("pre");
      setSimulating(false);
      simLockRef.current = false;
    }
  };

  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        style={{
          background: "var(--bg)", width: "95%", maxWidth: 1200,
          maxHeight: "90vh", overflow: "auto", borderRadius: 4,
        }}
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
      >
        <div className="match-header">
          <div className="match-team">
            <div className="abbr" style={{ color: isTeam1 ? "var(--accent)" : "var(--text-1)" }}>
              <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={44} />
            </div>
            <div style={{ color: "var(--text-2)" }}>{userTeam.name}</div>
          </div>

          {phase === "result" && matchResult ? (
            <div className="match-score">
              <span className={matchResult.winner === userTeam.id ? "winner" : "loser"}>
                {isTeam1 ? matchResult.score1 : matchResult.score2}
              </span>
              <span style={{ color: "var(--text-2)" }}>-</span>
              <span className={matchResult.winner !== userTeam.id ? "winner" : "loser"}>
                {isTeam1 ? matchResult.score2 : matchResult.score1}
              </span>
            </div>
          ) : (
            <div className="match-vs">VS</div>
          )}

          <div className="match-team">
            <div className="abbr" style={{ color: !isTeam1 ? "var(--accent)" : "var(--text-1)" }}>
              <TeamLogo teamId={opponentTeam?.id} abbr={opponentTeam?.abbr || ""} size={44} />
            </div>
            <div style={{ color: "var(--text-2)" }}>{opponentTeam?.name}</div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {phase === "pre" && (
            <div style={{ textAlign: "center" }}>
              <h3 className="font-heading" style={{ fontSize: 24, marginBottom: 24 }}>
                Préparation du Match
              </h3>
              {simError && (
                <div style={{
                  marginBottom: 16, padding: "10px 16px",
                  background: "rgba(255,51,102,0.1)", border: "1px solid var(--danger)",
                  borderRadius: 4, color: "var(--danger)", fontSize: 14,
                }}>
                  {simError}
                </div>
              )}
              <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
                <button className="btn-secondary" onClick={() => onStartDraft()} data-testid="start-draft-btn">
                  <Sword size={20} style={{ marginRight: 8 }} />
                  Phase de Draft
                </button>
                <button className="btn-primary" onClick={startMatch} disabled={simulating} data-testid="start-match-btn">
                  <GameController size={20} style={{ marginRight: 8 }} />
                  Simulation Rapide
                </button>
              </div>
            </div>
          )}

          {phase === "ready" && (
            <div style={{ textAlign: "center" }}>
              <h3 className="font-heading" style={{ fontSize: 24, marginBottom: 12, color: "var(--success)" }}>
                Draft Terminée!
              </h3>
              <p style={{ color: "var(--text-2)", marginBottom: 24 }}>
                Les équipes sont prêtes. Lancez le match!
              </p>
              <button
                className="btn-primary"
                onClick={startMatch}
                disabled={simLockRef.current}
                data-testid="launch-match-after-draft-btn"
                style={{ padding: "16px 32px", fontSize: 18 }}
              >
                <GameController size={24} style={{ marginRight: 8 }} />
                Lancer le Match
              </button>
            </div>
          )}

          {phase === "playing" && (
            <div style={{ textAlign: "center", padding: 60 }}>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <Lightning size={64} style={{ color: "var(--amber)" }} />
              </motion.div>
              <h3 className="font-heading" style={{ fontSize: 24, marginTop: 24 }}>Match en cours...</h3>
              <p style={{ color: "var(--text-2)", marginTop: 8 }}>
                Simulation des phases de jeu
              </p>
            </div>
          )}

          {phase === "timeline" && matchResult?.match_details && (
            <MatchTimeline
              phases={matchResult.match_details.phases || []}
              events={matchResult.match_details.events || []}
              goldTimeline={matchResult.match_details.gold_timeline || []}
              team1Abbr={isTeam1 ? userTeam.abbr : opponentTeam?.abbr}
              team2Abbr={isTeam1 ? opponentTeam?.abbr : userTeam.abbr}
              team1Id={isTeam1 ? userTeam.id : opponentTeam?.id}
              team2Id={isTeam1 ? opponentTeam?.id : userTeam.id}
              team1Stats={matchResult.match_details.team1_stats || []}
              team2Stats={matchResult.match_details.team2_stats || []}
              duration={matchResult.match_details.duration}
              winnerTeam={matchResult.match_details.winner}
              userIsTeam1={isTeam1}
              onContinue={() => setPhase("result")}
            />
          )}

          {phase === "result" && matchResult?.match_details && (
            <MatchResultScoreboard
              matchResult={matchResult}
              userTeam={userTeam}
              opponentTeam={opponentTeam}
              isTeam1={isTeam1}
              teams={teams}
              onClose={onClose}
            />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default MatchSimulation;
