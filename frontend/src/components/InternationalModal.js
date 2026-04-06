import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";

// International Tournament Modal
const InternationalModal = ({ userTeam, onComplete }) => {
  const [intl, setIntl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [simming, setSimming] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(API + "/international");
        setIntl(res.data);
      } catch {
        const res = await axios.post(API + "/international/start");
        setIntl(res.data);
      }
      setLoading(false);
    })();
  }, []);

  const simulate = async (matchId) => {
    setSimming(matchId);
    try {
      const res = await axios.post(API + "/international/simulate", { match_id: matchId });
      setIntl(res.data);
    } catch {
      const res = await axios.get(API + "/international").catch(() => null);
      if (res) setIntl(res.data);
    }
    setSimming(null);
  };

  const simulateRound = async (matches) => {
    for (const m of Object.values(matches)) {
      if (!m.winner_id && !m.locked) await simulate(m.id);
    }
  };

  if (loading) return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div style={{ color: "var(--text-primary)", fontSize: 18 }}>Chargement du tournoi...</div>
    </motion.div>
  );

  const uc = intl?.user_champ_id;
  const isMSI = intl?.type === "msi";

  const RTeam = ({ t, isWinner }) => {
    if (!t) return <div style={{ minWidth: 72, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>TBD</div>;
    return (
      <div style={{ textAlign: "center", minWidth: 72 }}>
        <TeamLogo teamId={t.id} abbr={t.abbr} size={36} noClick />
        <div style={{ fontSize: 11, fontWeight: t.id === uc ? 700 : 400, color: t.id === uc ? "var(--secondary)" : "var(--text-primary)", marginTop: 3 }}>{t.abbr}</div>
        <div style={{ fontSize: 9, color: "var(--text-secondary)", letterSpacing: 0.5 }}>{t.league}</div>
        {t.id === uc && <div style={{ fontSize: 8, color: "var(--secondary)", fontWeight: 900, letterSpacing: 1 }}>▶ VOUS</div>}
        {isWinner && <div style={{ fontSize: 10, color: "var(--success)" }}>✓</div>}
      </div>
    );
  };

  const MatchCard = ({ m, showSimBtn = true }) => {
    if (!m) return null;
    const played = !!m.winner_id;
    const locked = m.locked || (!m.team1 && !m.team2);
    const isUser = m.team1?.id === uc || m.team2?.id === uc;
    const canSim = showSimBtn && !played && !locked;
    return (
      <div style={{
        background: "var(--surface)",
        border: `1px solid ${played ? "var(--success)" : locked ? "var(--border-subtle)" : isUser ? "var(--secondary)" : "var(--border)"}`,
        borderRadius: 4, padding: "10px 14px", marginBottom: 8,
        opacity: locked ? 0.45 : 1
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
          <span>{m.round}</span>
          <span style={{ color: "var(--text-secondary)" }}>Bo{m.best_of}</span>
          {isUser && !played && <span style={{ color: "var(--secondary)" }}>★ VOUS</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <RTeam t={m.team1} isWinner={m.winner_id === m.team1?.id} />
          <div style={{ textAlign: "center", minWidth: 44 }}>
            {played
              ? <span className="font-stats" style={{ fontSize: 22, fontWeight: 900 }}>
                  <span style={{ color: "var(--success)" }}>{m.score1}</span>
                  <span style={{ color: "var(--text-secondary)" }}>-</span>
                  <span style={{ color: "var(--danger)" }}>{m.score2}</span>
                </span>
              : <span style={{ color: "var(--text-secondary)", fontSize: 16 }}>VS</span>
            }
          </div>
          <RTeam t={m.team2} isWinner={m.winner_id === m.team2?.id} />
        </div>
        {canSim && (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
            <button className="btn-primary" style={{ padding: "7px 18px", fontSize: 13 }} disabled={!!simming} onClick={() => simulate(m.id)}>
              {simming === m.id ? "..." : isUser ? "Jouer" : "Simuler"}
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Winner banner ──────────────────────────────────────────────────────────
  const winnerBanner = () => {
    if (!intl?.completed) return null;
    const allTeams = isMSI
      ? [...(intl.bracket?.teams || []), ...(intl.play_in?.teams || [])]
      : [...(intl.knockout?.teams || []), ...(intl.play_in?.teams || [])];
    const wt = allTeams.find(t => t.id === intl.winner);
    return (
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ textAlign: "center", padding: "24px 0 16px", borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🏆</div>
        <div className="font-heading" style={{ fontSize: 26, color: "var(--secondary)" }}>Champion — {intl.name}</div>
        {wt && <>
          <TeamLogo teamId={wt.id} abbr={wt.abbr} size={52} noClick style={{ margin: "10px auto", display: "block" }} />
          <div className="font-heading" style={{ fontSize: 18 }}>{wt.name} <span style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: 13 }}>({wt.league})</span></div>
          {wt.id === uc && <div style={{ marginTop: 8, padding: "6px 16px", display: "inline-block", background: "rgba(255,184,0,.15)", border: "1px solid var(--secondary)", borderRadius: 20, color: "var(--secondary)", fontWeight: 700, fontSize: 13 }}>Votre équipe est championne !</div>}
        </>}
        <button className="btn-primary" style={{ marginTop: 20, padding: "12px 32px", fontSize: 15 }} onClick={onComplete}>
          Continuer →
        </button>
      </motion.div>
    );
  };

  const SectionHeader = ({ label, done }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0 8px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: done ? "var(--success)" : "var(--secondary)", textTransform: "uppercase" }}>{label}</div>
      {done && <span style={{ fontSize: 10, color: "var(--success)" }}>✓</span>}
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );

  // ── MSI rendering ──────────────────────────────────────────────────────────
  const renderMSI = () => {
    const pi = intl.play_in; const bk = intl.bracket;
    const piMs = Object.values(pi.matches || {});
    const bkMs = Object.values(bk.matches || {});
    const piDone = pi.completed;
    const pendingPi = piMs.filter(m => !m.winner_id && !m.locked);
    return (
      <div>
        <SectionHeader label="Play-In" done={piDone} />
        {piMs.map(m => <MatchCard key={m.id} m={m} />)}
        {pendingPi.length > 1 && (
          <button className="btn-secondary" style={{ width: "100%", marginBottom: 12, fontSize: 12 }} disabled={!!simming}
            onClick={() => simulateRound(pi.matches)}>Simuler tout le Play-In</button>
        )}
        {piDone && <>
          <SectionHeader label="Bracket Stage" done={bk.completed} />
          {bkMs.length === 0
            ? <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: 16 }}>En attente du Play-In...</div>
            : (() => {
                const rounds = {};
                bkMs.forEach(m => { rounds[m.round] = rounds[m.round] || []; rounds[m.round].push(m); });
                return Object.entries(rounds).map(([rnd, ms]) => (
                  <div key={rnd}>
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", margin: "10px 0 6px" }}>{rnd}</div>
                    {ms.map(m => <MatchCard key={m.id} m={m} />)}
                    {ms.some(m => !m.winner_id && !m.locked) && ms.filter(m => !m.winner_id && !m.locked).length > 1 && (
                      <button className="btn-secondary" style={{ width: "100%", marginBottom: 8, fontSize: 12 }} disabled={!!simming}
                        onClick={() => simulateRound(Object.fromEntries(ms.map(m => [m.id, m])))}>Simuler ce round</button>
                    )}
                  </div>
                ));
              })()
          }
        </>}
      </div>
    );
  };

  // ── Worlds rendering ───────────────────────────────────────────────────────
  const renderWorlds = () => {
    const pi = intl.play_in; const sw = intl.swiss; const ko = intl.knockout;
    const piDone = pi.completed; const swDone = sw.completed;
    const curRound = sw.rounds?.length > 0 ? sw.rounds[sw.rounds.length - 1] : null;
    const curMs = curRound ? Object.values(curRound.matches) : [];
    return (
      <div>
        <SectionHeader label="Play-In" done={piDone} />
        <MatchCard m={pi.match} />

        {piDone && <>
          <SectionHeader label={`Swiss Stage${sw.current_round > 0 ? ` — Round ${sw.current_round}/5` : ""}`} done={swDone} />
          {/* Swiss standings */}
          {sw.teams && (
            <div style={{ marginBottom: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>Équipe</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>Ligue</th>
                    <th style={{ padding: "4px 8px", textAlign: "center" }}>W</th>
                    <th style={{ padding: "4px 8px", textAlign: "center" }}>L</th>
                    <th style={{ padding: "4px 8px", textAlign: "center" }}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sw.teams].sort((a,b) => b.sw_wins - a.sw_wins || a.sw_losses - b.sw_losses).map((t, i) => (
                    <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)", background: t.id === uc ? "rgba(255,184,0,.05)" : "transparent" }}>
                      <td style={{ padding: "5px 8px", fontWeight: t.id === uc ? 700 : 400, color: t.id === uc ? "var(--secondary)" : "var(--text-primary)" }}>
                        {t.abbr} {t.id === uc && "▶"}
                      </td>
                      <td style={{ padding: "5px 8px", color: "var(--text-secondary)" }}>{t.league}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center", color: "var(--success)", fontWeight: 700 }}>{t.sw_wins}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center", color: "var(--danger)", fontWeight: 700 }}>{t.sw_losses}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center", fontSize: 11 }}>
                        {t.sw_advanced ? <span style={{ color: "var(--success)" }}>Qualifié ✓</span>
                          : t.sw_eliminated ? <span style={{ color: "var(--danger)" }}>Éliminé ✗</span>
                          : <span style={{ color: "var(--text-secondary)" }}>En jeu</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Current round matches */}
          {curRound && !curRound.completed && (
            <div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", margin: "10px 0 6px" }}>Round {curRound.round}</div>
              {curMs.map(m => <MatchCard key={m.id} m={m} />)}
              {curMs.filter(m => !m.winner_id).length > 1 && (
                <button className="btn-secondary" style={{ width: "100%", marginBottom: 8, fontSize: 12 }} disabled={!!simming}
                  onClick={() => simulateRound(curRound.matches)}>Simuler tout le round</button>
              )}
            </div>
          )}
        </>}

        {swDone && <>
          <SectionHeader label="Knockout Stage" done={ko.completed} />
          {Object.values(ko.matches).map(m => <MatchCard key={m.id} m={m} />)}
          {Object.values(ko.matches).some(m => !m.winner_id && !m.locked) && (
            <button className="btn-secondary" style={{ width: "100%", marginBottom: 8, fontSize: 12 }} disabled={!!simming}
              onClick={() => simulateRound(ko.matches)}>Simuler ce round</button>
          )}
        </>}
      </div>
    );
  };

  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }}
        style={{ background: "var(--bg-dark)", width: "95%", maxWidth: 760, maxHeight: "90vh", overflow: "auto", borderRadius: 4 }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: "var(--secondary)", textTransform: "uppercase", marginBottom: 6 }}>
            🌍 Tournoi International
          </div>
          <h2 className="font-heading" style={{ fontSize: 26, margin: 0 }}>{intl?.name || "Tournoi"}</h2>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
            {isMSI ? "Top 2 de chaque ligue · Play-In + Bracket · Tout Bo5"
                    : "Top 3-4 de chaque ligue · Play-In + Swiss + Knockout"}
          </div>
        </div>
        <div style={{ padding: "0 24px 24px" }}>
          {winnerBanner()}
          {!intl?.completed && (isMSI ? renderMSI() : renderWorlds())}
          {intl?.completed && (isMSI ? renderMSI() : renderWorlds())}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default InternationalModal;
