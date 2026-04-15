import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Trophy, Lightning, GameController, Star, Sword } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";
import MatchTimeline from "./MatchTimeline";
import DraftSystem from "./DraftSystem";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// Playoff Series Modal — Bo5 game-by-game with draft + scoreboard
const PlayoffSeriesModal = ({ match, userTeam, teams, champions, showToast, onClose, onSplitEnd }) => {
  const [phase, setPhase] = useState("pre"); // "pre" | "playing" | "timeline" | "game_result" | "series_done"
  const [t1Wins, setT1Wins] = useState(match.team1_wins || 0);
  const [t2Wins, setT2Wins] = useState(match.team2_wins || 0);
  const [gameResult, setGameResult] = useState(null);
  const [seriesWinner, setSeriesWinner] = useState(match.completed ? match.winner : null);
  const [showDraft, setShowDraft] = useState(false);
  const [draftState, setDraftState] = useState(null);
  const [simError, setSimError] = useState(null);
  const simLock = useRef(false);
  const playingGameNumRef = useRef(1);
  const pendingScoreRef = useRef(null); // {t1, t2} — applied only when user clicks "Voir le résultat"

  const isTeam1 = match.team1 === userTeam.id;
  const oppId = isTeam1 ? match.team2 : match.team1;
  const oppTeam = teams.find(t => t.id === oppId);
  const winsNeeded = Math.ceil((match.best_of || 5) / 2);
  const gameNumber = t1Wins + t2Wins + 1;

  const roundLabels = {
    ub_r1: "UB Round 1", ub_final: "UB Finale",
    lb_r1: "LB Round 1", lb_r2: "LB Round 2", lb_r3: "LB Round 3",
    lb_final: "LB Finale", grand_final: "Grande Finale"
  };

  useEffect(() => {
    if (match.completed) setPhase("series_done");
  }, [match.completed]);

  const playGame = async () => {
    if (simLock.current) return;
    simLock.current = true;
    setSimError(null);
    playingGameNumRef.current = t1Wins + t2Wins + 1;
    setPhase("playing");
    const userDraft = draftState ? {
      picks: draftState.user_picks || [],
      bans: draftState.user_bans || [],
      enemy_picks: draftState.enemy_picks || [],
      enemy_bans: draftState.enemy_bans || [],
    } : null;
    try {
      const res = await axios.post(API + "/playoffs/play", { match_id: match.id, user_draft: userDraft });
      // Store new score — applied only after user clicks through timeline
      pendingScoreRef.current = { t1: res.data.series_score.team1, t2: res.data.series_score.team2 };
      setGameResult(res.data.game);
      setDraftState(null);
      const seriesCompleted = res.data.series_completed;
      const seriesWinnerVal = res.data.series_winner;
      const isChampion = !!res.data.champion;
      setTimeout(() => {
        setPhase("timeline");
        simLock.current = false;
        if (seriesCompleted) {
          setSeriesWinner(seriesWinnerVal);
          if (isChampion) {
            showToast("Champion couronné!", "success");
            if (onSplitEnd) setTimeout(() => onSplitEnd(), 2500);
          }
        }
      }, 2000);
    } catch (e) {
      setSimError(e.response?.data?.detail || "Erreur");
      setPhase("pre");
      simLock.current = false;
    }
  };

  const handleDraftComplete = (completed) => {
    setShowDraft(false);
    setDraftState(completed);
  };

  const getMVP = (game) => {
    if (!game) return null;
    const all = [...(game.team1_stats || []), ...(game.team2_stats || [])];
    return all.reduce((best, p) => {
      const score = p.kills * 3 + p.assists * 1.5 - p.deaths + p.damage / 5000;
      const bestScore = best ? best.kills * 3 + best.assists * 1.5 - best.deaths + best.damage / 5000 : -Infinity;
      return score > bestScore ? p : best;
    }, null);
  };

  const renderSeriesScore = () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, padding: "20px 0" }}>
      <div style={{ textAlign: "center" }}>
        <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={52} />
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{userTeam.abbr}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div className="font-heading" style={{ fontSize: 48 }}>
          <span style={{ color: (isTeam1 ? t1Wins : t2Wins) > (isTeam1 ? t2Wins : t1Wins) ? "var(--success)" : t1Wins === t2Wins ? "var(--text-primary)" : "var(--danger)" }}>
            {isTeam1 ? t1Wins : t2Wins}
          </span>
          <span style={{ color: "var(--text-secondary)", margin: "0 8px" }}>-</span>
          <span style={{ color: (isTeam1 ? t2Wins : t1Wins) > (isTeam1 ? t1Wins : t2Wins) ? "var(--success)" : t1Wins === t2Wins ? "var(--text-primary)" : "var(--danger)" }}>
            {isTeam1 ? t2Wins : t1Wins}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, letterSpacing: 2 }}>
          {roundLabels[match.round] || match.round} · BO{match.best_of || 5}
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <TeamLogo teamId={oppId} abbr={oppTeam?.abbr} size={52} />
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{oppTeam?.abbr}</div>
      </div>
    </div>
  );

  const renderScoreboard = () => {
    if (!gameResult) return null;
    const userStats = isTeam1 ? gameResult.team1_stats : gameResult.team2_stats;
    const oppStats = isTeam1 ? gameResult.team2_stats : gameResult.team1_stats;
    const userWon = gameResult.winner === userTeam.id;
    const totalK1 = (gameResult.team1_stats || []).reduce((a, p) => a + p.kills, 0);
    const totalK2 = (gameResult.team2_stats || []).reduce((a, p) => a + p.kills, 0);
    const myKills = isTeam1 ? totalK1 : totalK2;
    const oppKills = isTeam1 ? totalK2 : totalK1;
    const mvp = getMVP(gameResult);
    const duration = gameResult.duration || 30;

    const renderPlayerRow = (p, i) => (
      <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr 80px 65px 70px 44px", padding: "6px 12px", borderTop: "1px solid var(--border-subtle)", alignItems: "center", gap: 4 }}>
        {p.champion
          ? <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(p.champion)}.png`} alt={p.champion} style={{ width: 28, height: 28, borderRadius: 3 }} onError={e => { e.currentTarget.style.display = "none"; }} />
          : <span />
        }
        <span style={{ fontWeight: 500, fontSize: 13 }}>{p.player_name || p.position}</span>
        <span className="font-stats" style={{ textAlign: "center", fontWeight: 700 }}>
          <span style={{ color: "var(--success)" }}>{p.kills}</span>
          <span style={{ color: "var(--text-secondary)" }}>/</span>
          <span style={{ color: "var(--danger)" }}>{p.deaths}</span>
          <span style={{ color: "var(--text-secondary)" }}>/</span>
          <span style={{ color: "var(--primary)" }}>{p.assists}</span>
        </span>
        <span className="font-stats" style={{ textAlign: "center" }}>{(p.cs / Math.max(1, duration)).toFixed(1)}</span>
        <span className="font-stats" style={{ textAlign: "right", color: "var(--secondary)" }}>{(p.damage / 1000).toFixed(1)}k</span>
        <span className="font-stats" style={{ textAlign: "right", fontWeight: 700, color: p.perf_score >= 8 ? "var(--secondary)" : p.perf_score >= 6 ? "var(--success)" : p.perf_score >= 4 ? "var(--text-primary)" : "var(--danger)" }}>{p.perf_score != null ? p.perf_score.toFixed(1) : "—"}</span>
      </div>
    );

    const statsHeader = (
      <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 80px 65px 70px 44px", padding: "8px 12px", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase" }}>
        <span /><span>Joueur</span><span style={{ textAlign: "center" }}>K/D/A</span><span style={{ textAlign: "center" }}>CS/M</span><span style={{ textAlign: "right" }}>DMG</span><span style={{ textAlign: "right" }}>Note</span>
      </div>
    );

    return (
      <div>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{
          textAlign: "center", padding: "24px 16px", marginBottom: 16,
          background: userWon ? "linear-gradient(135deg, rgba(255,184,0,0.15), rgba(0,230,118,0.1))" : "linear-gradient(135deg, rgba(255,51,102,0.15), rgba(139,0,0,0.1))",
          border: "2px solid " + (userWon ? "var(--secondary)" : "var(--danger)"), borderRadius: 4
        }}>
          <div className="font-heading" style={{ fontSize: 36, color: userWon ? "var(--secondary)" : "var(--danger)" }}>
            {userWon ? "VICTOIRE" : "DÉFAITE"} — GAME {gameResult.game_number}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, margin: "8px 0" }}>
            <span style={{ color: "var(--success)" }}>{myKills}</span>
            <span style={{ color: "var(--text-secondary)" }}> — </span>
            <span style={{ color: "var(--danger)" }}>{oppKills}</span>
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>{duration} min</div>
        </motion.div>

        {mvp && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 16, marginBottom: 16, background: "rgba(255,184,0,0.08)", border: "1px solid var(--secondary)", borderRadius: 4 }}>
            <Star size={28} weight="fill" style={{ color: "var(--secondary)", flexShrink: 0 }} />
            {mvp.champion && (
              <img
                src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(mvp.champion)}.png`}
                alt={mvp.champion}
                style={{ width: 40, height: 40, borderRadius: 4, border: "2px solid var(--secondary)" }}
                onError={e => { e.currentTarget.style.display = "none"; }}
              />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--secondary)", fontWeight: 700, letterSpacing: 2 }}>MVP</div>
              <div className="font-heading" style={{ fontSize: 18 }}>{mvp.player_name || mvp.position}</div>
              {mvp.champion && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{mvp.champion}</div>}
            </div>
            <div className="font-stats" style={{ fontSize: 22, fontWeight: 900, color: "var(--success)" }}>
              {mvp.kills}/{mvp.deaths}/{mvp.assists}
            </div>
          </div>
        )}

        <div className="grid-2" style={{ gap: 16, marginBottom: 16 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: userWon ? "var(--primary)" : "var(--danger)", color: userWon ? "black" : "white", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={16} /> {userTeam.abbr} — {userWon ? "Victoire" : "Défaite"}
            </div>
            <div style={{ padding: 8 }}>{statsHeader}{userStats?.map(renderPlayerRow)}</div>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: !userWon ? "var(--primary)" : "var(--danger)", color: !userWon ? "black" : "white", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <TeamLogo teamId={oppId} abbr={oppTeam?.abbr} size={16} /> {oppTeam?.abbr} — {!userWon ? "Victoire" : "Défaite"}
            </div>
            <div style={{ padding: 8 }}>{statsHeader}{oppStats?.map(renderPlayerRow)}</div>
          </div>
        </div>
      </div>
    );
  };

  if (showDraft) {
    return (
      <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <DraftSystem
          champions={champions}
          matchId={match.id}
          onComplete={handleDraftComplete}
          onCancel={() => setShowDraft(false)}
        />
      </motion.div>
    );
  }

  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div style={{ background: "var(--bg-dark)", width: "95%", maxWidth: 1100, maxHeight: "90vh", overflow: "auto", borderRadius: 4 }} initial={{ scale: 0.9 }} animate={{ scale: 1 }}>

        {/* Header */}
        <div className="match-header">{renderSeriesScore()}</div>

        <div style={{ padding: 24 }}>
          {phase === "pre" && (
            <div style={{ textAlign: "center" }}>
              <h3 className="font-heading" style={{ fontSize: 22, marginBottom: 8 }}>
                {seriesWinner ? "Série terminée" : `Game ${gameNumber}`}
              </h3>
              {simError && (
                <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(255,51,102,0.1)", border: "1px solid var(--danger)", borderRadius: 4, color: "var(--danger)", fontSize: 14 }}>{simError}</div>
              )}
              {!seriesWinner && (
                <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 16 }}>
                  <button className="btn-secondary" onClick={() => setShowDraft(true)}>
                    <Sword size={18} style={{ marginRight: 8 }} />
                    {draftState ? "Redraft" : "Phase de Draft"}
                  </button>
                  <button className="btn-primary" onClick={playGame}>
                    <GameController size={18} style={{ marginRight: 8 }} />
                    {draftState ? "Lancer la Game" : "Simulation Rapide"}
                  </button>
                </div>
              )}
              <button className="btn-secondary" style={{ marginTop: 16 }} onClick={onClose}>Fermer</button>
            </div>
          )}

          {phase === "playing" && (
            <div style={{ textAlign: "center", padding: 60 }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                <Lightning size={64} style={{ color: "var(--secondary)" }} />
              </motion.div>
              <h3 className="font-heading" style={{ fontSize: 24, marginTop: 24 }}>Game {playingGameNumRef.current} en cours...</h3>
            </div>
          )}

          {phase === "timeline" && gameResult && (() => {
            // Toujours userTeam à gauche (team1) et adversaire à droite (team2)
            const uStats = isTeam1 ? (gameResult.team1_stats || []) : (gameResult.team2_stats || []);
            const oStats = isTeam1 ? (gameResult.team2_stats || []) : (gameResult.team1_stats || []);
            return (
            <MatchTimeline
              phases={gameResult.phases || []}
              events={gameResult.events || []}
              team1Abbr={userTeam.abbr}
              team2Abbr={oppTeam?.abbr}
              team1Stats={uStats}
              team2Stats={oStats}
              duration={gameResult.duration}
              winnerTeam={gameResult.winner === userTeam.id ? 1 : 2}
              onContinue={() => {
                if (pendingScoreRef.current) {
                  setT1Wins(pendingScoreRef.current.t1);
                  setT2Wins(pendingScoreRef.current.t2);
                  pendingScoreRef.current = null;
                }
                setPhase("game_result");
              }}
            />
          )}

          {phase === "game_result" && (
            <div>
              {renderScoreboard()}
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                {seriesWinner ? (
                  <button className="btn-primary" style={{ flex: 1, padding: 14, fontSize: 16 }} onClick={onClose}>
                    <Trophy size={20} style={{ marginRight: 8 }} />
                    {seriesWinner === userTeam.id ? "Victoire de la série!" : "Défaite de la série"} — Fermer
                  </button>
                ) : (
                  <button className="btn-primary" style={{ flex: 1, padding: 14, fontSize: 16 }} onClick={() => setPhase("pre")}>
                    <GameController size={20} style={{ marginRight: 8 }} />
                    Game {gameNumber} →
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "series_done" && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <Trophy size={64} weight="fill" style={{ color: seriesWinner === userTeam.id ? "var(--secondary)" : "var(--text-secondary)", marginBottom: 16 }} />
              <div className="font-heading" style={{ fontSize: 36, color: seriesWinner === userTeam.id ? "var(--secondary)" : "var(--danger)" }}>
                {seriesWinner === userTeam.id ? "SÉRIE GAGNÉE" : "SÉRIE PERDUE"}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: "12px 0", color: "var(--text-secondary)" }}>
                {isTeam1 ? `${t1Wins} - ${t2Wins}` : `${t2Wins} - ${t1Wins}`}
              </div>
              <button className="btn-primary" style={{ marginTop: 16, padding: "14px 32px" }} onClick={onClose}>Fermer</button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PlayoffSeriesModal;
