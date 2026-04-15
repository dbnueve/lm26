import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Trophy, Lightning, GameController, Shield, Star, Sword } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";
import MatchTimeline from "./MatchTimeline";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// Match Simulation Component
const MatchSimulation = ({ match, userTeam, teams, onClose, onStartDraft, draftCompleted, draftState }) => {
  const [phase, setPhase] = useState(draftCompleted ? "ready" : "pre");
  const [matchResult, setMatchResult] = useState(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [simError, setSimError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const simLockRef = useRef(false);

  const opponent = match.team1 === userTeam.id ? match.team2 : match.team1;
  const opponentTeam = teams.find(t => t.id === opponent);
  const isTeam1 = match.team1 === userTeam.id;

  const startMatch = async () => {
    // Prevent duplicate calls (double-click, stale re-render)
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
      const response = await axios.post(API + "/match/simulate", {
        match_id: match.id,
        user_draft: userDraft
      }, { timeout: 15000 });
      setTimeout(() => {
        setMatchResult(response.data);
        setPhase("timeline");
        setSimulating(false);
        simLockRef.current = false;
      }, 2500);
    } catch (e) {
      console.error("Error simulating match:", e);
      const msg = e.response?.data?.detail || (e.code === "ECONNABORTED" ? "Délai dépassé. Réessaye." : "Erreur de simulation. Réessaye.");
      setSimError(msg);
      setPhase("pre");
      setSimulating(false);
      simLockRef.current = false;
    }
  };

  // Calculate MVP based on stats
  const getMVP = () => {
    if (!matchResult?.match_details) return null;
    const team1Stats = matchResult.match_details.team1_stats || [];
    const team2Stats = matchResult.match_details.team2_stats || [];
    const allStats = [...team1Stats, ...team2Stats];

    let mvp = null;
    let maxScore = 0;
    allStats.forEach(p => {
     const pos = p.position || "MID";
                const k = p.kills || 0;
                const d = Math.max(p.deaths || 1, 1);
                const a = p.assists || 0;
                const cs = p.cs || 0;
                const dur = Math.max(matchResult.match_details.duration || 1, 1);
                const kda_raw = (k + a * 0.5) / d;
                const kda_score = Math.min(5.0, kda_raw * 1.2);
                const cs_expect = { "TOP": 9.0, "JUNGLE": 7.5, "MID": 9.0, "ADC": 9.5, "SUPPORT": 0.8 };
                const cs_per_min = cs / dur;
                const cs_ratio = cs_per_min / Math.max(cs_expect[pos] || 8.0, 0.1);
                const cs_score = Math.min(3.0, cs_ratio * 3.0);
                const win_bonus = matchResult.winner === userTeam.id ? 2.0 : 0.0;
                const perf_score_raw = kda_score + cs_score + win_bonus;
                const perf_score = Math.round(perf_score_raw * 10) / 10; 
      if (perf_score > maxScore) {
        maxScore = perf_score;
        mvp = p;
      }
    });
    return mvp;
  };

  const renderScoreboard = () => {
    if (!matchResult?.match_details) return null;

    const mvp = getMVP();
    const team1Stats = matchResult.match_details.team1_stats || [];
    const team2Stats = matchResult.match_details.team2_stats || [];
    const userStats = isTeam1 ? team1Stats : team2Stats;
    const oppStats = isTeam1 ? team2Stats : team1Stats;
    const userWon = matchResult.winner === userTeam.id;

    const totalKills1 = team1Stats.reduce((a, p) => a + p.kills, 0);
    const totalKills2 = team2Stats.reduce((a, p) => a + p.kills, 0);

    return (
      <div>
        {/* Victory/Defeat Banner */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{
            textAlign: "center",
            padding: "32px 24px",
            marginBottom: 24,
            background: userWon ?
              "linear-gradient(135deg, rgba(255, 184, 0, 0.15) 0%, rgba(0, 230, 118, 0.1) 100%)" :
              "linear-gradient(135deg, rgba(255, 51, 102, 0.15) 0%, rgba(139, 0, 0, 0.1) 100%)",
            border: "2px solid " + (userWon ? "var(--secondary)" : "var(--danger)"),
            borderRadius: 4
          }}
        >
          <Trophy
            size={56}
            weight="fill"
            style={{
              color: userWon ? "var(--secondary)" : "var(--text-secondary)",
              marginBottom: 12
            }}
          />
          <h2 className="font-heading" style={{
            fontSize: 42,
            color: userWon ? "var(--secondary)" : "var(--danger)",
            textShadow: userWon ? "0 0 30px rgba(255, 184, 0, 0.5)" : "none"
          }}>
            {userWon ? "VICTOIRE" : "DÉFAITE"}
          </h2>
          <div style={{ color: "var(--text-secondary)", marginTop: 8, fontSize: 16 }}>
            Durée: {matchResult.match_details.duration} minutes
          </div>
        </motion.div>

        {/* Match Score */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 32,
          marginBottom: 32,
          padding: 24,
          background: "var(--surface)",
          borderRadius: 4
        }}>
          <div style={{ textAlign: "center" }}>
            <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={48} style={{ filter: isTeam1 ? "none" : "brightness(0) invert(1)" }} />
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{userTeam.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span className="font-stats" style={{
              fontSize: 48,
              fontWeight: 900,
              color: userWon ? "var(--success)" : "var(--danger)"
            }}>
              {isTeam1 ? totalKills1 : totalKills2}
            </span>
            <span style={{ fontSize: 24, color: "var(--text-secondary)" }}>-</span>
            <span className="font-stats" style={{
              fontSize: 48,
              fontWeight: 900,
              color: !userWon ? "var(--success)" : "var(--danger)"
            }}>
              {isTeam1 ? totalKills2 : totalKills1}
            </span>
          </div>
          <div style={{ textAlign: "center" }}>
            <TeamLogo teamId={opponentTeam?.id} abbr={opponentTeam?.abbr || ""} size={48} style={{ filter: !isTeam1 ? "none" : "brightness(0) invert(1)" }} />
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{opponentTeam?.name}</div>
          </div>
        </div>

        {/* MVP Card */}
        {mvp && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            style={{
              marginBottom: 24,
              padding: 20,
              background: "linear-gradient(135deg, rgba(255, 184, 0, 0.1) 0%, rgba(255, 184, 0, 0.05) 100%)",
              border: "2px solid var(--secondary)",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 20
            }}
          >
            <div style={{
              width: 60,
              height: 60,
              background: "var(--secondary)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <Star size={32} weight="fill" style={{ color: "black" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--secondary)", fontWeight: 700, letterSpacing: 2 }}>
                MVP DU MATCH
              </div>
              <div className="font-heading" style={{ fontSize: 24, display: "flex", alignItems: "center", gap: 10 }}>
                {mvp.champion && (
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(mvp.champion)}.png`}
                    alt={mvp.champion}
                    style={{ width: 36, height: 36, borderRadius: 4, border: "2px solid var(--secondary)" }}
                    onError={e => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                {mvp.player_name || mvp.position}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {mvp.position}{mvp.champion ? ` · ${mvp.champion}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="font-stats" style={{ fontSize: 28, fontWeight: 900, color: "var(--success)" }}>
                {mvp.kills}/{mvp.deaths}/{mvp.assists}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                KDA: {((mvp.kills + mvp.assists) / Math.max(1, mvp.deaths)).toFixed(2)}
              </div>
            </div>
          </motion.div>
        )}

        {/* Player Stats Tables */}
        <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
          {/* Your Team Stats */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{
              padding: "12px 16px",
              background: "var(--primary)",
              color: "black",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <Shield size={18} weight="fill" />
              <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={18} style={{ marginRight: 4 }} /> - {userWon ? "Victoire" : "Défaite"}
            </div>
            <div style={{ padding: 8 }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "36px 1fr 80px 50px 65px 70px",
                padding: "8px 12px",
                fontSize: 11,
                color: "var(--text-secondary)",
                fontWeight: 600,
                textTransform: "uppercase"
              }}>
                <span></span>
                <span>Joueur</span>
                <span style={{ textAlign: "center" }}>K/D/A</span>
                <span style={{ textAlign: "center" }}>Note</span>
                <span style={{ textAlign: "center" }}>CS/M</span>
                <span style={{ textAlign: "right" }}>DMG</span>
              </div>
              {userStats.map((p, i) => {
                // Calculate performance score (0-10)
                const pos = p.position || "MID";
                const k = p.kills || 0;
                const d = Math.max(p.deaths || 1, 1);
                const a = p.assists || 0;
                const cs = p.cs || 0;
                const dur = Math.max(matchResult.match_details.duration || 1, 1);
                const kda_raw = (k + a * 0.5) / d;
                const kda_score = Math.min(5.0, kda_raw * 1.2);
                const cs_expect = { "TOP": 9.0, "JUNGLE": 7.5, "MID": 9.0, "ADC": 9.5, "SUPPORT": 0.8 };
                const cs_per_min = cs / dur;
                const cs_ratio = cs_per_min / Math.max(cs_expect[pos] || 8.0, 0.1);
                const cs_score = Math.min(3.0, cs_ratio * 3.0);
                const win_bonus = matchResult.winner === userTeam.id ? 2.0 : 0.0;
                const perf_score_raw = kda_score + cs_score + win_bonus;
                const perf_score = Math.round(perf_score_raw * 10) / 10; 
  
                const is_good_perf = perf_score >= 7;
                const is_bad_perf = perf_score <= 3;

                return (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px 1fr 80px 50px 65px 70px",
                      padding: "6px 12px",
                      borderTop: "1px solid var(--border-subtle)",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    {p.champion
                      ? <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(p.champion)}.png`} alt={p.champion} title={p.champion} style={{ width: 28, height: 28, borderRadius: 3 }} onError={e => { e.currentTarget.style.display = "none"; }} />
                      : <span />
                    }
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{p.player_name || `Joueur ${i + 1}`}</span>
                    <span className="font-stats" style={{ textAlign: "center", fontWeight: 700 }}>
                      <span style={{ color: "var(--success)" }}>{p.kills}</span>
                      <span style={{ color: "var(--text-secondary)" }}>/</span>
                      <span style={{ color: "var(--danger)" }}>{p.deaths}</span>
                      <span style={{ color: "var(--text-secondary)" }}>/</span>
                      <span style={{ color: "var(--primary)" }}>{p.assists}</span>
                    </span>
                    <span className="font-stats" style={{ textAlign: "center", fontWeight: 700, color: is_good_perf ? "var(--success)" : is_bad_perf ? "var(--danger)" : "var(--primary)" }}>
        {perf_score.toFixed(1)}
      </span>
                    <span className="font-stats" style={{ textAlign: "center" }}>{(cs / dur).toFixed(1)}</span>
                    <span className="font-stats" style={{ textAlign: "right", color: "var(--secondary)" }}>
                      {(p.damage / 1000).toFixed(1)}k
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Opponent Team Stats */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{
              padding: "12px 16px",
              background: "var(--danger)",
              color: "white",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <Shield size={18} weight="fill" />
              <TeamLogo teamId={opponentTeam?.id} abbr={opponentTeam?.abbr || ""} size={18} style={{ marginRight: 4 }} /> - {!userWon ? "Victoire" : "Défaite"}
            </div>
            <div style={{ padding: 8 }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "36px 1fr 80px 50px 65px 70px",
                padding: "8px 12px",
                fontSize: 11,
                color: "var(--text-secondary)",
                fontWeight: 600,
                textTransform: "uppercase"
              }}>
                <span></span>
                <span>Joueur</span>
                <span style={{ textAlign: "center" }}>K/D/A</span>
                <span style={{ textAlign: "center" }}>Note</span>
                <span style={{ textAlign: "center" }}>CS/M</span>
                <span style={{ textAlign: "right" }}>DMG</span>
              </div>
              {oppStats.map((p, i) => {
  // --- AJOUT DU CALCUL DE LA NOTE POUR L'ÉQUIPE ADVERSE ---
  const pos = p.position || "MID";
  const k = p.kills || 0;
  const d = Math.max(p.deaths || 1, 1);
  const a = p.assists || 0;
  const cs = p.cs || 0;
  const dur = Math.max(matchResult.match_details.duration || 1, 1);
  const kda_raw = (k + a * 0.5) / d;
  const kda_score = Math.min(5.0, kda_raw * 1.2);
  const cs_expect = { "TOP": 9.0, "JUNGLE": 7.5, "MID": 9.0, "ADC": 9.5, "SUPPORT": 0.8 };
  const cs_per_min = cs / dur;
  const cs_ratio = cs_per_min / Math.max(cs_expect[pos] || 8.0, 0.1);
  const cs_score = Math.min(3.0, cs_ratio * 3.0);
  
  // Attention: Le bonus de victoire doit vérifier si l'adversaire a gagné
  const win_bonus = matchResult.winner !== userTeam.id ? 2.0 : 0.0; 
  
  // Petite correction JS: Math.round() ne prend pas de 2ème argument en JavaScript.
  // Pour garder 1 ou 2 décimales, on utilise .toFixed(1) ou Math.round(valeur * 10) / 10
  const perf_score_raw = kda_score + cs_score + win_bonus;
  const perf_score = Math.round(perf_score_raw * 10) / 10; 
  
  const is_good_perf = perf_score >= 7;
  const is_bad_perf = perf_score <= 3;
  // --------------------------------------------------------

  return (
    <div
      key={i}
      style={{
        display: "grid",
        gridTemplateColumns: "36px 1fr 80px 50px 65px 70px", // Attention: j'ai ajouté "50px" pour la colonne de la note qui manquait dans tes colonnes adverses
        padding: "6px 12px",
        borderTop: "1px solid var(--border-subtle)",
        alignItems: "center",
        gap: 4
      }}
    >
      {p.champion
        ? <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(p.champion)}.png`} alt={p.champion} title={p.champion} style={{ width: 28, height: 28, borderRadius: 3 }} onError={e => { e.currentTarget.style.display = "none"; }} />
        : <span />
      }
      <span style={{ fontWeight: 500, fontSize: 13 }}>{p.player_name || `Joueur ${i + 1}`}</span>
      <span className="font-stats" style={{ textAlign: "center", fontWeight: 700 }}>
        <span style={{ color: "var(--success)" }}>{p.kills}</span>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--danger)" }}>{p.deaths}</span>
        <span style={{ color: "var(--text-secondary)" }}>/</span>
        <span style={{ color: "var(--primary)" }}>{p.assists}</span>
      </span>
      
      {/* Affichage de la note corrigé */}
      <span className="font-stats" style={{ textAlign: "center", fontWeight: 700, color: is_good_perf ? "var(--success)" : is_bad_perf ? "var(--danger)" : "var(--primary)" }}>
        {perf_score.toFixed(1)}
      </span>

      <span className="font-stats" style={{ textAlign: "center" }}>{(p.cs / Math.max(1, matchResult.match_details.duration)).toFixed(1)}</span>
      <span className="font-stats" style={{ textAlign: "right", color: "var(--secondary)" }}>
        {(p.damage / 1000).toFixed(1)}k
      </span>
    </div>
  );
})}
            </div>
          </div>
        </div>

        {/* Game Objectives */}
        <div className="grid-3" style={{ marginBottom: 24 }}>
          {matchResult.match_details.phases.map((p, i) => (
            <div
              key={i}
              className="card"
              style={{ padding: 16, borderLeft: "3px solid " + (i === 0 ? "#4FC3F7" : i === 1 ? "#FFB800" : "#FF5252") }}
            >
              <h5 className="font-heading" style={{ marginBottom: 8 }}>{p.name}</h5>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{p.duration}</div>
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Avantage Gold</span>
                  <span className="font-stats" style={{
                    color: p.advantage === (isTeam1 ? 1 : 2) ? "var(--success)" : "var(--danger)"
                  }}>
                    {p.advantage === (isTeam1 ? 1 : 2) ? "+" : "-"}{p.gold_diff}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {matchResult?.other_results?.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h4 className="font-heading" style={{ marginBottom: 12, color: "var(--text-secondary)", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>
              Autres résultats de la semaine
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {matchResult.other_results.map((om) => {
                const t1 = teams.find(t => t.id === om.team1);
                const t2 = teams.find(t => t.id === om.team2);
                return (
                  <div key={om.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-card)", borderRadius: 4, fontSize: 13 }}>
                    <span style={{ fontWeight: om.winner === om.team1 ? 700 : 400, color: om.winner === om.team1 ? "var(--text-primary)" : "var(--text-secondary)", minWidth: 80 }}>
                      <TeamLogo teamId={t1?.id || om.team1} abbr={t1?.abbr || om.team1} size={20} />
                    </span>
                    <span className="font-stats" style={{ color: "var(--text-secondary)", margin: "0 8px" }}>
                      {om.score1} - {om.score2}
                    </span>
                    <span style={{ fontWeight: om.winner === om.team2 ? 700 : 400, color: om.winner === om.team2 ? "var(--text-primary)" : "var(--text-secondary)", minWidth: 80, textAlign: "right" }}>
                      <TeamLogo teamId={t2?.id || om.team2} abbr={t2?.abbr || om.team2} size={20} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button
          className="btn-primary"
          style={{ width: "100%", padding: 16, fontSize: 16, marginTop: 16 }}
          onClick={onClose}
          data-testid="close-match-btn"
        >
          Retour au Dashboard
        </button>
      </div>
    );
  };

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        style={{
          background: "var(--bg-dark)",
          width: "95%",
          maxWidth: 1200,
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 4
        }}
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
      >
        <div className="match-header">
          <div className="match-team">
            <div className="abbr" style={{ color: isTeam1 ? "var(--primary)" : "var(--text-primary)" }}>
              <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={44} />
            </div>
            <div style={{ color: "var(--text-secondary)" }}>{userTeam.name}</div>
          </div>

          {phase === "result" && matchResult ? (
            <div className="match-score">
              <span className={matchResult.winner === userTeam.id ? "winner" : "loser"}>
                {isTeam1 ? matchResult.score1 : matchResult.score2}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>-</span>
              <span className={matchResult.winner !== userTeam.id ? "winner" : "loser"}>
                {isTeam1 ? matchResult.score2 : matchResult.score1}
              </span>
            </div>
          ) : (
            <div className="match-vs">VS</div>
          )}

          <div className="match-team">
            <div className="abbr" style={{ color: !isTeam1 ? "var(--primary)" : "var(--text-primary)" }}>
              <TeamLogo teamId={opponentTeam?.id} abbr={opponentTeam?.abbr || ""} size={44} />
            </div>
            <div style={{ color: "var(--text-secondary)" }}>{opponentTeam?.name}</div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {phase === "pre" && (
            <div style={{ textAlign: "center" }}>
              <h3 className="font-heading" style={{ fontSize: 24, marginBottom: 24 }}>
                Préparation du Match
              </h3>
              {simError && (
                <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(255,51,102,0.1)", border: "1px solid var(--danger)", borderRadius: 4, color: "var(--danger)", fontSize: 14 }}>
                  {simError}
                </div>
              )}
              <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
                <button
                  className="btn-secondary"
                  onClick={() => onStartDraft()}
                  data-testid="start-draft-btn"
                >
                  <Sword size={20} style={{ marginRight: 8 }} />
                  Phase de Draft
                </button>
                <button
                  className="btn-primary"
                  onClick={startMatch}
                  disabled={simulating}
                  data-testid="start-match-btn"
                >
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
              <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
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
                <Lightning size={64} style={{ color: "var(--secondary)" }} />
              </motion.div>
              <h3 className="font-heading" style={{ fontSize: 24, marginTop: 24 }}>
                Match en cours...
              </h3>
              <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>
                Simulation des phases de jeu
              </p>
            </div>
          )}

          {phase === "timeline" && matchResult?.match_details && (
            <MatchTimeline
              phases={matchResult.match_details.phases || []}
              events={matchResult.match_details.events || []}
              team1Abbr={isTeam1 ? userTeam.abbr : opponentTeam?.abbr}
              team2Abbr={isTeam1 ? opponentTeam?.abbr : userTeam.abbr}
              team1Stats={matchResult.match_details.team1_stats || []}
              team2Stats={matchResult.match_details.team2_stats || []}
              duration={matchResult.match_details.duration}
              winnerTeam={matchResult.match_details.winner}
              onContinue={() => setPhase("result")}
            />
          )}

          {phase === "result" && matchResult?.match_details && renderScoreboard()}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default MatchSimulation;
