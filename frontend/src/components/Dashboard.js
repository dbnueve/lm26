import React, { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, Calendar, GameController, Play } from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";
import PlayerCard from "./PlayerCard";
import PlayerDetailModal from "./PlayerDetailModal";

const ROUND_LABELS = {
  ub_r1:      "UB Round 1",
  ub_final:   "UB Finale",
  lb_r1:      "LB Round 1",
  lb_r2:      "LB Round 2",
  lb_r3:      "LB Round 3",
  lb_final:   "LB Finale",
  grand_final: "Grande Finale",
};

/* ── Sous-composants ──────────────────────────────────────── */

const StatNumber = ({ value, color, label }) => (
  <div>
    <div className="font-stats" style={{ fontSize: 26, fontWeight: 500, color, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
  </div>
);

const CardHeader = ({ icon: Icon, title, iconColor }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
    {Icon && <Icon size={15} style={{ color: iconColor || "var(--text-2)" }} />}
    <span className="text-label">{title}</span>
  </div>
);

const StatRow = ({ label, value, valueColor }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "7px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  }}>
    <span style={{ color: "var(--text-2)" }}>{label}</span>
    <span className="font-stats" style={{ fontWeight: 500, color: valueColor || "var(--text-1)" }}>{value}</span>
  </div>
);

/* ── Dashboard ────────────────────────────────────────────── */

const Dashboard = ({ userTeam, schedule, standings, splitStatus, phase, playoffsData, onPlayMatch, onPlayPlayoffMatch, onSeasonStart, playMatchLabel, playMatchDisabled }) => {
  const [detailPlayer, setDetailPlayer] = useState(null);

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

  const teamStanding = useMemo(() =>
    standings.find(t => t.id === userTeam.id),
    [standings, userTeam.id]
  );

  const starters = useMemo(() =>
    userTeam.players?.filter(p => p.is_starter) || [],
    [userTeam.players]
  );

  const avgRating = starters.length > 0
    ? Math.round(starters.reduce((a, p) => a + p.rating, 0) / starters.length)
    : "-";
  const avgKda = starters.length > 0
    ? (starters.reduce((a, p) => a + p.kda, 0) / starters.length).toFixed(2)
    : "-";
  const avgMoral = starters.length > 0
    ? Math.round(starters.reduce((a, p) => a + p.moral, 0) / starters.length) + "%"
    : "-";

  const currentWeek = schedule.filter(m => !m.played).length > 0
    ? Math.min(...schedule.filter(m => !m.played).map(m => m.week))
    : schedule.length > 0 ? Math.max(...schedule.map(m => m.week)) : 1;
  const weekMatches = schedule.filter(m => m.week === currentWeek);

  return (
    <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Page title */}
      <div>
        <h2 className="font-heading" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>Tableau de bord</h2>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2 }}>
          {splitStatus?.split_label || "Saison en cours"}
        </div>
      </div>

      {/* Top row : Team overview / Next match / Team stats */}
      <div className="grid-3">

        {/* Team overview */}
        <div className="card" style={{ padding: 18 }}>
          <CardHeader title="Équipe" />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 52, height: 52,
              background: "var(--surface-2)",
              borderRadius: "var(--radius)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={38} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{userTeam.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
                {userTeam.league || "LEC"}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <StatNumber value={teamStanding?.rank || "-"} color="var(--accent)" label="Position" />
            <StatNumber value={userTeam.wins}  color="var(--success)" label="Victoires" />
            <StatNumber value={userTeam.losses} color="var(--danger)"  label="Défaites" />
          </div>
        </div>

        {/* Next match */}
        <div className="card" style={{ padding: 18 }}>
          <CardHeader icon={GameController} title="Prochain match" iconColor="var(--accent)" />

          {phase === "preseason" ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <div className="chip chip-amber" style={{ marginBottom: 12, display: "block", textAlign: "center", padding: "8px 12px" }}>
                Pré-saison — Mercato ouvert
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 14, textAlign: "center" }}>
                Finalisez vos transferts puis lancez la saison
              </div>
              <button className="btn-primary" style={{ width: "100%" }} onClick={onSeasonStart} data-testid="start-season-btn">
                <Play size={16} style={{ marginRight: 6 }} />
                Lancer la saison
              </button>
            </motion.div>

          ) : nextRegularMatch ? (() => {
            const oppId = nextRegularMatch.team1 === userTeam.id ? nextRegularMatch.team2 : nextRegularMatch.team1;
            const opp = standings.find(t => t.id === oppId);
            return (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 16 }}>
                  <div style={{ textAlign: "center" }}>
                    <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={44} />
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>Vous</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>VS</div>
                  <div style={{ textAlign: "center" }}>
                    <TeamLogo teamId={oppId} abbr={opp?.abbr || oppId} size={44} />
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>{opp?.abbr || oppId}</div>
                  </div>
                </div>
                <button className="btn-primary" style={{ width: "100%" }} onClick={() => onPlayMatch(nextRegularMatch)} data-testid="play-match-btn">
                  <GameController size={16} style={{ marginRight: 6 }} />
                  Jouer le match
                </button>
              </div>
            );
          })() : nextPlayoffMatch ? (() => {
            const opp = nextPlayoffMatch.team1 === userTeam.id ? nextPlayoffMatch.team2_data : nextPlayoffMatch.team1_data;
            return (
              <div>
                <div className="chip chip-accent" style={{ marginBottom: 12, display: "inline-flex" }}>
                  PLAYOFFS — {ROUND_LABELS[nextPlayoffMatch.round] || nextPlayoffMatch.round}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 16 }}>
                  <div style={{ textAlign: "center" }}>
                    <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={44} />
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>Vous</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>VS</div>
                  <div style={{ textAlign: "center" }}>
                    <TeamLogo teamId={opp?.id} abbr={opp?.abbr} size={44} />
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>{opp?.abbr}</div>
                  </div>
                </div>
                <button className="btn-primary" style={{ width: "100%" }} onClick={() => onPlayPlayoffMatch?.(nextPlayoffMatch)} data-testid="play-match-btn">
                  <GameController size={16} style={{ marginRight: 6 }} />
                  Jouer le match (Bo5)
                </button>
              </div>
            );
          })() : (
            <div style={{ textAlign: "center", color: "var(--text-2)", fontSize: 13, paddingTop: 12 }}>
              Aucun match programmé
            </div>
          )}
        </div>

        {/* Team stats */}
        <div className="card" style={{ padding: 18 }}>
          <CardHeader title="Statistiques" />
          <StatRow label="Rating moyen" value={avgRating} valueColor="var(--accent)" />
          <StatRow label="KDA moyen"    value={avgKda} />
          <StatRow label="Moral moyen"  value={avgMoral} valueColor="var(--success)" />
          <StatRow label="Joueurs"      value={userTeam.players?.length || 0} />
        </div>
      </div>

      {/* Second row : Standings + Calendar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Compact standings */}
        <div className="card" style={{ padding: 18 }}>
          <CardHeader icon={Trophy} title="Classement" iconColor="var(--amber)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {standings.slice(0, 10).map((team, i) => {
              const isUser = team.id === userTeam.id;
              return (
                <div key={team.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "5px 8px",
                  borderRadius: "var(--radius-xs)",
                  background: isUser ? "var(--accent-dim)" : "transparent",
                  border: isUser ? "1px solid var(--accent-border)" : "1px solid transparent",
                }}>
                  <span className="font-stats" style={{
                    width: 18, textAlign: "right", fontSize: 12,
                    color: i < 3 ? "var(--amber)" : "var(--text-2)",
                    fontWeight: 600,
                  }}>{i + 1}</span>
                  <TeamLogo teamId={team.id} abbr={team.abbr} size={20} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: isUser ? 700 : 400 }}>{team.abbr}</span>
                  <span className="font-stats" style={{ fontSize: 12 }}>
                    <span style={{ color: "var(--success)" }}>{team.wins}</span>
                    <span style={{ color: "var(--text-2)" }}> - </span>
                    <span style={{ color: "var(--danger)" }}>{team.losses}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Calendar week */}
        <div className="card" style={{ padding: 18 }}>
          <CardHeader icon={Calendar} title={`Semaine ${currentWeek}`} iconColor="var(--accent)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {weekMatches.map((m, idx) => {
              const isUserMatch = m.team1 === userTeam.id || m.team2 === userTeam.id;
              const t1 = standings.find(t => t.id === m.team1);
              const t2 = standings.find(t => t.id === m.team2);
              return (
                <div key={idx} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 8px",
                  borderRadius: "var(--radius-xs)",
                  background: isUserMatch ? "var(--accent-dim)" : "transparent",
                  border: `1px solid ${isUserMatch ? "var(--accent-border)" : "var(--border)"}`,
                }}>
                  <TeamLogo teamId={m.team1} abbr={t1?.abbr || m.team1} size={18} />
                  <span style={{ fontSize: 12, fontWeight: m.team1 === userTeam.id ? 700 : 400 }}>{t1?.abbr || m.team1}</span>
                  {m.played ? (
                    <span className="font-stats" style={{ fontSize: 12, margin: "0 4px", color: "var(--text-2)" }}>
                      {m.score1}–{m.score2}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, margin: "0 4px", color: "var(--text-2)" }}>vs</span>
                  )}
                  <TeamLogo teamId={m.team2} abbr={t2?.abbr || m.team2} size={18} />
                  <span style={{ fontSize: 12, fontWeight: m.team2 === userTeam.id ? 700 : 400 }}>{t2?.abbr || m.team2}</span>
                  {m.played && isUserMatch && (
                    <span style={{
                      marginLeft: "auto", fontSize: 11, fontWeight: 600,
                      color: m.winner === userTeam.id ? "var(--success)" : "var(--danger)",
                    }}>
                      {m.winner === userTeam.id ? "Victoire" : "Défaite"}
                    </span>
                  )}
                  {!m.played && isUserMatch && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>À jouer</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Starting roster */}
      <div className="card" style={{ padding: 18 }}>
        <CardHeader title="Composition titulaire" />
        <div className="grid-5">
          {["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"].map(pos => {
            const player = starters.find(p => p.position === pos);
            return player ? (
              <PlayerCard key={player.id} player={player} onSelect={setDetailPlayer} />
            ) : (
              <div key={pos} className="card" style={{ padding: 20, textAlign: "center", opacity: 0.45 }}>
                <span className={"pos-badge pos-" + pos}>{pos}</span>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)" }}>Vacant</div>
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
