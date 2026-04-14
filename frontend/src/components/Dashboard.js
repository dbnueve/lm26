import React, { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, Calendar, GameController, Play } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";
import PlayerCard from "./PlayerCard";
import PlayerDetailModal from "./PlayerDetailModal";

// Dashboard Component
const Dashboard = ({ userTeam, schedule, standings, splitStatus, phase, onPlayMatch, onPlayPlayoffMatch, onSeasonStart }) => {
  const [playoffsData, setPlayoffsData] = useState(null);
  const [detailPlayer, setDetailPlayer] = useState(null);

  useEffect(() => {
    axios.get(API + "/playoffs").then(r => setPlayoffsData(r.data)).catch(() => {});
  }, []);

  const nextRegularMatch = useMemo(() =>
    schedule.find(m => !m.played && (m.team1 === userTeam.id || m.team2 === userTeam.id)),
    [schedule, userTeam.id]
  );

  const nextPlayoffMatch = useMemo(() => {
    if (nextRegularMatch || !playoffsData?.active) return null;
    const activeRounds = playoffsData?.active_rounds || [];
    return playoffsData.matches?.find(m =>
      !m.completed &&
      activeRounds.includes(m.round) &&
      (m.team1 === userTeam.id || m.team2 === userTeam.id)
    ) ?? null;
  }, [nextRegularMatch, playoffsData, userTeam.id]);

  const nextMatch = nextRegularMatch || null;

  const teamStanding = useMemo(() =>
    standings.find(t => t.id === userTeam.id),
    [standings, userTeam.id]
  );
  const starters = useMemo(() =>
    userTeam.players?.filter(p => p.is_starter) || [],
    [userTeam.players]
  );

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
        Tableau de Bord
      </h2>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <div className="card" style={{ padding: 24 }}>
          <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
            Aperçu de l équipe
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <div style={{
              width: 60,
              height: 60,
              background: "var(--surface-hover)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              padding: 8
            }}>
              <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={44} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 18 }}>{userTeam.name}</div>
              <div style={{ color: "var(--text-secondary)" }}>{splitStatus?.split_label || "Saison en cours"}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <div>
              <div className="font-stats" style={{ fontSize: 28, color: "var(--primary)" }}>
                {teamStanding?.rank || "-"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Position</div>
            </div>
            <div>
              <div className="font-stats" style={{ fontSize: 28, color: "var(--success)" }}>
                {userTeam.wins}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Victoires</div>
            </div>
            <div>
              <div className="font-stats" style={{ fontSize: 28, color: "var(--danger)" }}>
                {userTeam.losses}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Défaites</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
            Prochain Match
          </h3>
          {nextMatch ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginBottom: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={52} />
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Vous</div>
                </div>
                <div className="font-heading" style={{ fontSize: 24, color: "var(--text-secondary)" }}>VS</div>
                <div style={{ textAlign: "center" }}>
                  {(() => {
                    const oppId = nextMatch.team1 === userTeam.id ? nextMatch.team2 : nextMatch.team1;
                    const opp = standings.find(t => t.id === oppId);
                    return <><TeamLogo teamId={oppId} abbr={opp?.abbr || oppId} size={52} /><div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Adversaire</div></>;
                  })()}
                </div>
              </div>
              <button
                className="btn-primary"
                style={{ width: "100%" }}
                onClick={() => onPlayMatch(nextMatch)}
                data-testid="play-match-btn"
              >
                <GameController size={20} style={{ marginRight: 8 }} />
                Jouer le Match
              </button>
            </div>
          ) : nextPlayoffMatch ? (
            <div>
              {(() => {
                const roundLabels = {
                  ub_r1: "UB Round 1", ub_final: "UB Finale",
                  lb_r1: "LB Round 1", lb_r2: "LB Round 2", lb_r3: "LB Round 3",
                  lb_final: "LB Finale", grand_final: "Grande Finale"
                };
                const opp = nextPlayoffMatch.team1 === userTeam.id ? nextPlayoffMatch.team2_data : nextPlayoffMatch.team1_data;
                return (
                  <>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--primary)", fontWeight: 600, marginBottom: 12 }}>
                      PLAYOFFS — {roundLabels[nextPlayoffMatch.round] || nextPlayoffMatch.round}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginBottom: 16 }}>
                      <div style={{ textAlign: "center" }}>
                        <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={52} />
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>Vous</div>
                      </div>
                      <div className="font-heading" style={{ fontSize: 24, color: "var(--text-secondary)" }}>VS</div>
                      <div style={{ textAlign: "center" }}>
                        <TeamLogo teamId={opp?.id} abbr={opp?.abbr} size={52} />
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{opp?.abbr}</div>
                      </div>
                    </div>
                    <button
                      className="btn-primary"
                      style={{ width: "100%" }}
                      onClick={() => onPlayPlayoffMatch && onPlayPlayoffMatch(nextPlayoffMatch)}
                      data-testid="play-match-btn"
                    >
                      <GameController size={20} style={{ marginRight: 8 }} />
                      Jouer le Match (Bo5)
                    </button>
                  </>
                );
              })()}
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text-secondary)" }}>
              Aucun match programmé
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 24 }}>
          <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
            Statistiques d équipe
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Rating moyen</span>
              <span className="font-stats" style={{ fontWeight: 700, color: "var(--primary)" }}>
                {starters.length > 0 ?
                  Math.round(starters.reduce((a, p) => a + p.rating, 0) / starters.length) :
                  "-"
                }
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>KDA moyen</span>
              <span className="font-stats" style={{ fontWeight: 700 }}>
                {starters.length > 0 ?
                  (starters.reduce((a, p) => a + p.kda, 0) / starters.length).toFixed(2) :
                  "-"
                }
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Moral moyen</span>
              <span className="font-stats" style={{ fontWeight: 700, color: "var(--success)" }}>
                {starters.length > 0 ?
                  Math.round(starters.reduce((a, p) => a + p.moral, 0) / starters.length) + "%" :
                  "-"
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Standings + Calendar row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        {/* Compact standings */}
        <div className="card" style={{ padding: 24 }}>
          <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
            <Trophy size={18} style={{ color: "var(--secondary)" }} /> Classement
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {standings.slice(0, 10).map((team, i) => {
              const isUser = team.id === userTeam.id;
              return (
                <div key={team.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "6px 10px", borderRadius: 6,
                  background: isUser ? "rgba(var(--primary-rgb, 200,155,60), 0.15)" : "transparent",
                  border: isUser ? "1px solid rgba(var(--primary-rgb, 200,155,60), 0.35)" : "1px solid transparent"
                }}>
                  <span className="font-stats" style={{ width: 20, textAlign: "right", color: i < 3 ? "var(--secondary)" : "var(--text-secondary)", fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
                  <TeamLogo teamId={team.id} abbr={team.abbr} size={22} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: isUser ? 700 : 400 }}>{team.abbr}</span>
                  <span className="font-stats" style={{ fontSize: 13 }}>
                    <span style={{ color: "var(--success)" }}>{team.wins}</span>
                    <span style={{ color: "var(--text-secondary)" }}>-</span>
                    <span style={{ color: "var(--danger)" }}>{team.losses}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Compact current-week calendar */}
        {(() => {
          const currentWeek = schedule.filter(m => !m.played).length > 0
            ? Math.min(...schedule.filter(m => !m.played).map(m => m.week))
            : (schedule.length > 0 ? Math.max(...schedule.map(m => m.week)) : 1);
          const weekMatches = schedule.filter(m => m.week === currentWeek);
          return (
            <div className="card" style={{ padding: 24 }}>
              <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
                <Calendar size={18} style={{ color: "var(--primary)" }} /> Semaine {currentWeek}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {weekMatches.map((m, idx) => {
                  const isUserMatch = m.team1 === userTeam.id || m.team2 === userTeam.id;
                  const t1 = standings.find(t => t.id === m.team1);
                  const t2 = standings.find(t => t.id === m.team2);
                  return (
                    <div key={idx} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 10px", borderRadius: 6,
                      background: isUserMatch ? "rgba(var(--primary-rgb, 200,155,60), 0.12)" : "transparent",
                      border: isUserMatch ? "1px solid rgba(var(--primary-rgb, 200,155,60), 0.3)" : "1px solid var(--border)"
                    }}>
                      <TeamLogo teamId={m.team1} abbr={t1?.abbr || m.team1} size={20} />
                      <span style={{ fontSize: 12, fontWeight: m.team1 === userTeam.id ? 700 : 400 }}>{t1?.abbr || m.team1}</span>
                      {m.played ? (
                        <span className="font-stats" style={{ fontSize: 13, margin: "0 4px", color: "var(--text-secondary)" }}>
                          {m.score1} - {m.score2}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, margin: "0 6px", color: "var(--text-secondary)" }}>vs</span>
                      )}
                      <TeamLogo teamId={m.team2} abbr={t2?.abbr || m.team2} size={20} />
                      <span style={{ fontSize: 12, fontWeight: m.team2 === userTeam.id ? 700 : 400 }}>{t2?.abbr || m.team2}</span>
                      {m.played && (
                        <span style={{ marginLeft: "auto", fontSize: 11, color: m.winner === userTeam.id ? "var(--success)" : m.winner ? (isUserMatch ? "var(--danger)" : "var(--text-secondary)") : "var(--text-secondary)" }}>
                          {m.winner === userTeam.id ? "Victoire" : m.winner && isUserMatch ? "Défaite" : ""}
                        </span>
                      )}
                      {!m.played && isUserMatch && (
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>À jouer</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 className="font-heading" style={{ marginBottom: 16, color: "var(--text-secondary)" }}>
          Composition Titulaire
        </h3>
        <div className="grid-5">
          {["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"].map(pos => {
            const player = starters.find(p => p.position === pos);
            return player ? (
              <PlayerCard key={player.id} player={player} onSelect={setDetailPlayer} />
            ) : (
              <div key={pos} className="card" style={{ padding: 24, textAlign: "center", opacity: 0.5 }}>
                <span className={"pos-badge pos-" + pos}>{pos}</span>
                <div style={{ marginTop: 8 }}>Vacant</div>
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {detailPlayer && (
          <PlayerDetailModal player={detailPlayer} onClose={() => setDetailPlayer(null)} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
