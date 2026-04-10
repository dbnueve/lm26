import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowsClockwise, Globe, Trophy, Sword, GameController } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import TeamLogo from "./TeamLogo";
import DraftSystem from "./DraftSystem";

const LEAGUE_FLAG = { LEC: "🇪🇺", LCK: "🇰🇷", LPL: "🇨🇳", LCS: "🇺🇸", CBLOL: "🇧🇷" };

const InternationalModal = ({ userTeam, onComplete }) => {
  const [intl, setIntl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [simming, setSimming] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [simAllActive, setSimAllActive] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [draftMatchId, setDraftMatchId] = useState(null);
  const [pendingDraft, setPendingDraft] = useState(null); // draft complété, en attente de lancer

  const fetchIntl = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(API + "/international");
      setIntl(res.data);
    } catch (err) {
      if (err?.response?.status === 404) {
        try {
          const res = await axios.post(API + "/international/start");
          setIntl(res.data);
        } catch (e2) {
          setError(e2?.response?.data?.detail || "Impossible de démarrer le tournoi");
        }
      } else {
        setError(err?.response?.data?.detail || "Erreur de connexion");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIntl(); }, [fetchIntl]);

  // Auto-switch tab when stage changes
  useEffect(() => {
    if (!intl) return;
    const map = {
      play_in:   "playin",
      bracket:   "bracket",
      swiss:     "swiss",
      knockout:  "knockout",
      completed: intl.type === "msi" ? "bracket" : "knockout",
    };
    setActiveTab(map[intl.stage] || "playin");
  }, [intl?.stage, intl?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulate = useCallback(async (matchId) => {
    setSimming(matchId);
    try {
      const res = await axios.post(API + "/international/simulate", { match_id: matchId });
      setIntl(res.data);
    } catch {
      const ref = await axios.get(API + "/international").catch(() => null);
      if (ref) setIntl(ref.data);
    }
    setSimming(null);
  }, []);

  const collectPending = (data) => {
    if (!data || data.completed) return [];
    const uc = data.user_champ_id;
    const ok = (m) => m && !m.winner_id && !m.locked && m.team1 && m.team2
      && m.team1.id !== uc && m.team2.id !== uc;
    if (data.type === "msi") {
      if (!data.play_in.completed)
        return Object.values(data.play_in.matches || {}).filter(ok).map(m => m.id);
      return Object.values(data.bracket.matches || {}).filter(ok).map(m => m.id);
    }
    if (!data.play_in.completed) return ok(data.play_in.match) ? [data.play_in.match.id] : [];
    if (!data.swiss.completed) {
      const rounds = data.swiss.rounds || [];
      const cur = rounds[rounds.length - 1];
      if (cur && !cur.completed) return Object.values(cur.matches || {}).filter(ok).map(m => m.id);
      return [];
    }
    return Object.values(data.knockout.matches || {}).filter(ok).map(m => m.id);
  };

  const simulateAll = useCallback(async () => {
    if (!intl || simAllActive) return;
    setSimAllActive(true);
    let cur = intl;
    while (!cur.completed) {
      const ids = collectPending(cur);
      if (ids.length === 0) break;
      setSimming(ids[0]);
      try {
        const res = await axios.post(API + "/international/simulate", { match_id: ids[0] });
        cur = res.data;
        setIntl(res.data);
      } catch { break; }
    }
    setSimming(null);
    setSimAllActive(false);
  }, [intl, simAllActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const uc = intl?.user_champ_id;

  // ── Sub-components ─────────────────────────────────────────────────────────

  const TeamSlot = ({ t, isWinner }) => {
    if (!t) return (
      <div style={{ textAlign: "center", minWidth: 64 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--border)", margin: "0 auto" }} />
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>TBD</div>
      </div>
    );
    const isUser = t.id === uc;
    return (
      <div style={{ textAlign: "center", minWidth: 64 }}>
        <TeamLogo teamId={t.id} abbr={t.abbr} size={32} noClick />
        <div style={{ fontSize: 11, fontWeight: isUser ? 700 : 400, color: isUser ? "var(--secondary)" : "var(--text-primary)", marginTop: 3 }}>
          {LEAGUE_FLAG[t.league] || ""} {t.abbr}
        </div>
        {isUser && <div style={{ fontSize: 8, color: "var(--secondary)", fontWeight: 900, letterSpacing: 1 }}>▶ VOUS</div>}
        {isWinner && <div style={{ fontSize: 10, color: "var(--success)", marginTop: 1 }}>✓</div>}
      </div>
    );
  };

  const MatchCard = ({ m, compact }) => {
    if (!m) return null;
    const played = !!m.winner_id;
    const locked = m.locked || !m.team1 || !m.team2;
    const isUser = m.team1?.id === uc || m.team2?.id === uc;
    const canSim = !played && !locked;
    const t1win = played && m.winner_id === m.team1?.id;
    const t2win = played && m.winner_id === m.team2?.id;
    return (
      <div style={{
        background: "var(--bg-dark)",
        border: `1px solid ${locked ? "var(--border-subtle)" : isUser && !played ? "var(--secondary)" : played ? "var(--border-subtle)" : "var(--border)"}`,
        borderRadius: 6, padding: compact ? "8px 10px" : "10px 14px", marginBottom: 6,
        opacity: locked ? 0.4 : 1,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: 1.5, marginBottom: 8, textTransform: "uppercase", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: isUser && !played ? "var(--secondary)" : "var(--text-secondary)" }}>
            {isUser && !played ? "★ " : ""}{m.round}
          </span>
          <span style={{ background: "var(--surface)", padding: "1px 5px", borderRadius: 2 }}>Bo{m.best_of}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <TeamSlot t={m.team1} isWinner={t1win} />
          </div>
          <div style={{ minWidth: 50, textAlign: "center" }}>
            {played
              ? <span className="font-stats" style={{ fontSize: 22, fontWeight: 900 }}>
                  <span style={{ color: t1win ? "var(--success)" : "var(--danger)" }}>{m.score1}</span>
                  <span style={{ color: "var(--text-secondary)", margin: "0 2px" }}>-</span>
                  <span style={{ color: t2win ? "var(--success)" : "var(--danger)" }}>{m.score2}</span>
                </span>
              : <span style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 700 }}>VS</span>
            }
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
            <TeamSlot t={m.team2} isWinner={t2win} />
          </div>
        </div>
        {canSim && (
          <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
            <button
              className={isUser ? "btn-primary" : "btn-secondary"}
              style={{ padding: "6px 16px", fontSize: 12 }}
              disabled={!!simming || simAllActive}
              onClick={() => simulate(m.id)}
            >
              {simming === m.id ? "..." : isUser ? "Jouer" : "Simuler"}
            </button>
          </div>
        )}
      </div>
    );
  };

  const ColHeader = ({ label, color }) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: color || "var(--primary)", textTransform: "uppercase", borderBottom: `2px solid ${color || "var(--primary)"}`, paddingBottom: 5, marginBottom: 10 }}>
      {label}
    </div>
  );

  const RoundLabel = ({ label, done }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0 6px" }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: done ? "var(--success)" : "var(--text-secondary)", textTransform: "uppercase" }}>{label}</span>
      {done && <span style={{ color: "var(--success)", fontSize: 9 }}>✓</span>}
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
    </div>
  );

  // ── User status strip ──────────────────────────────────────────────────────
  const UserStatus = () => {
    if (!intl || !uc || !userTeam) return null;
    let statusText = ""; let statusColor = "var(--text-secondary)";
    if (intl.type === "msi") {
      const pi = intl.play_in; const bk = intl.bracket;
      const inBK = bk.teams?.some(t => t.id === uc);
      if (intl.winner === uc)          { statusText = "🏆 Champion MSI 2026"; statusColor = "var(--secondary)"; }
      else if (inBK && bk.completed)   { statusText = "Éliminé au Bracket"; statusColor = "var(--danger)"; }
      else if (inBK)                   { statusText = "Bracket Stage — En compétition"; statusColor = "var(--primary)"; }
      else if (pi.completed)           { statusText = "Éliminé en Play-In"; statusColor = "var(--danger)"; }
      else                             { statusText = "Play-In — En compétition"; }
    } else {
      const sw = intl.swiss; const ko = intl.knockout;
      const swTeam = sw.teams?.find(t => t.id === uc);
      const inKO   = ko.teams?.some(t => t.id === uc);
      if (intl.winner === uc)              { statusText = "🏆 Champion Worlds 2026"; statusColor = "var(--secondary)"; }
      else if (inKO && ko.completed)       { statusText = "Éliminé au Knockout"; statusColor = "var(--danger)"; }
      else if (inKO)                       { statusText = "Knockout Stage — En compétition"; statusColor = "var(--primary)"; }
      else if (swTeam?.sw_eliminated)      { statusText = `Éliminé (Swiss ${swTeam.sw_wins}W-${swTeam.sw_losses}L)`; statusColor = "var(--danger)"; }
      else if (swTeam?.sw_advanced)        { statusText = `Qualifié pour le Knockout ✓ (${swTeam.sw_wins}W)`; statusColor = "var(--success)"; }
      else if (swTeam)                     { statusText = `Swiss Stage — ${swTeam.sw_wins}W · ${swTeam.sw_losses}L`; }
      else                                 { statusText = "Play-In — En compétition"; }
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--surface)", borderRadius: 4, marginBottom: 16, fontSize: 12 }}>
        <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={20} noClick />
        <span style={{ fontWeight: 700 }}>{userTeam.abbr}</span>
        <span style={{ color: "var(--text-secondary)" }}>·</span>
        <span style={{ fontWeight: 600, color: statusColor }}>{statusText}</span>
      </div>
    );
  };

  // ── MSI Play-In ────────────────────────────────────────────────────────────
  const renderMSIPlayIn = () => {
    const ms = intl.play_in.matches || {};
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <ColHeader label="Upper Bracket" color="var(--primary)" />
          <RoundLabel label="UB Round 1" done={ms.pi_ub1?.winner_id && ms.pi_ub2?.winner_id} />
          <MatchCard m={ms.pi_ub1} />
          <MatchCard m={ms.pi_ub2} />
          <RoundLabel label="UB Final" done={!!ms.pi_ubf?.winner_id} />
          <MatchCard m={ms.pi_ubf} />
        </div>
        <div>
          <ColHeader label="Lower Bracket" color="var(--danger)" />
          <RoundLabel label="LB Round 1" done={!!ms.pi_lb1?.winner_id} />
          <MatchCard m={ms.pi_lb1} />
          <RoundLabel label="LB Final" done={!!ms.pi_lbf?.winner_id} />
          <MatchCard m={ms.pi_lbf} />
        </div>
      </div>
    );
  };

  // ── MSI Bracket ────────────────────────────────────────────────────────────
  const renderMSIBracket = () => {
    const bm = intl.bracket.matches || {};
    if (Object.keys(bm).length === 0)
      return <div style={{ textAlign: "center", padding: 48, color: "var(--text-secondary)" }}>En attente de la fin du Play-In...</div>;
    const ubR1Done = ["ub1_1","ub1_2","ub1_3","ub1_4"].every(id => bm[id]?.winner_id);
    const ubSFDone = bm.ub2_1?.winner_id && bm.ub2_2?.winner_id;
    const lbR1Done = bm.lb1_1?.winner_id && bm.lb1_2?.winner_id;
    const lbQFDone = bm.lb2_1?.winner_id && bm.lb2_2?.winner_id;
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <ColHeader label="Upper Bracket" color="var(--primary)" />
            <RoundLabel label="UB Round 1" done={ubR1Done} />
            <MatchCard m={bm.ub1_1} compact />
            <MatchCard m={bm.ub1_2} compact />
            <MatchCard m={bm.ub1_3} compact />
            <MatchCard m={bm.ub1_4} compact />
            <RoundLabel label="UB Semis" done={ubSFDone} />
            <MatchCard m={bm.ub2_1} />
            <MatchCard m={bm.ub2_2} />
            <RoundLabel label="UB Final" done={!!bm.ubf?.winner_id} />
            <MatchCard m={bm.ubf} />
          </div>
          <div>
            <ColHeader label="Lower Bracket" color="var(--danger)" />
            <RoundLabel label="LB Round 1" done={lbR1Done} />
            <MatchCard m={bm.lb1_1} compact />
            <MatchCard m={bm.lb1_2} compact />
            <RoundLabel label="LB Quarterfinal" done={lbQFDone} />
            <MatchCard m={bm.lb2_1} compact />
            <MatchCard m={bm.lb2_2} compact />
            <RoundLabel label="LB Semifinal" done={!!bm.lb3?.winner_id} />
            <MatchCard m={bm.lb3} />
            <RoundLabel label="LB Final" done={!!bm.lbf?.winner_id} />
            <MatchCard m={bm.lbf} />
          </div>
        </div>
        <div style={{ maxWidth: 420, margin: "20px auto 0" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "var(--secondary)", textAlign: "center", borderBottom: "2px solid var(--secondary)", paddingBottom: 6, marginBottom: 10, textTransform: "uppercase" }}>
            Grande Finale
          </div>
          <MatchCard m={bm.gf} />
        </div>
      </div>
    );
  };

  // ── Worlds Play-In ─────────────────────────────────────────────────────────
  const renderWorldsPlayIn = () => (
    <div style={{ maxWidth: 440, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", marginBottom: 16 }}>
        1 place qualificative pour le Swiss Stage (16 équipes)
      </div>
      <MatchCard m={intl.play_in.match} />
    </div>
  );

  // ── Worlds Swiss ───────────────────────────────────────────────────────────
  const renderWorldsSwiss = () => {
    const sw = intl.swiss;
    const rounds = sw.rounds || [];
    const curRound = rounds[rounds.length - 1];
    const curMs = curRound ? Object.values(curRound.matches) : [];
    const teams = sw.teams ? [...sw.teams].sort((a, b) => b.sw_wins - a.sw_wins || a.sw_losses - b.sw_losses) : [];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
        <div>
          <ColHeader label="Classement" color="var(--text-secondary)" />
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "3px 6px", textAlign: "left", fontWeight: 600 }}>#</th>
                <th style={{ padding: "3px 6px", textAlign: "left", fontWeight: 600 }}>Équipe</th>
                <th style={{ padding: "3px 6px", textAlign: "center", fontWeight: 600, color: "var(--success)" }}>W</th>
                <th style={{ padding: "3px 6px", textAlign: "center", fontWeight: 600, color: "var(--danger)" }}>L</th>
                <th style={{ padding: "3px 6px", textAlign: "center", fontWeight: 600 }}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => {
                const isUser = t.id === uc;
                let statusEl = <span style={{ color: "var(--text-secondary)", fontSize: 10 }}>—</span>;
                if (t.sw_advanced)   statusEl = <span style={{ color: "var(--success)",  fontSize: 10, fontWeight: 700 }}>Q ✓</span>;
                if (t.sw_eliminated) statusEl = <span style={{ color: "var(--danger)",   fontSize: 10, fontWeight: 700 }}>E ✗</span>;
                return (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)", background: isUser ? "rgba(255,184,0,0.05)" : "transparent" }}>
                    <td style={{ padding: "5px 6px", color: "var(--text-secondary)", fontSize: 11 }}>{i + 1}</td>
                    <td style={{ padding: "5px 6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <TeamLogo teamId={t.id} abbr={t.abbr} size={16} noClick />
                        <span style={{ fontWeight: isUser ? 700 : 400, color: isUser ? "var(--secondary)" : "var(--text-primary)" }}>
                          {LEAGUE_FLAG[t.league] || ""} {t.abbr}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 700, color: "var(--success)" }}>{t.sw_wins}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 700, color: "var(--danger)" }}>{t.sw_losses}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center" }}>{statusEl}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          {curRound && (
            <>
              <ColHeader label={`Round ${curRound.round} / 5${curRound.completed ? " ✓" : ""}`} color={curRound.completed ? "var(--success)" : "var(--primary)"} />
              {curMs.map(m => <MatchCard key={m.id} m={m} />)}
            </>
          )}
          {sw.completed && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ color: "var(--success)", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Swiss Stage terminé ✓</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{sw.advanced?.length || 0} équipes qualifiées pour le Knockout</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Worlds Knockout ────────────────────────────────────────────────────────
  const renderWorldsKnockout = () => {
    const km = intl.knockout.matches || {};
    const qfDone = ["qf1","qf2","qf3","qf4"].every(id => km[id]?.winner_id);
    const sfDone  = km.sf1?.winner_id && km.sf2?.winner_id;
    return (
      <div>
        <RoundLabel label="Quarts de finale" done={qfDone} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
          <MatchCard m={km.qf1} />
          <MatchCard m={km.qf3} />
          <MatchCard m={km.qf2} />
          <MatchCard m={km.qf4} />
        </div>
        <RoundLabel label="Demi-finales" done={sfDone} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
          <MatchCard m={km.sf1} />
          <MatchCard m={km.sf2} />
        </div>
        <div style={{ maxWidth: 420, margin: "20px auto 0" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "var(--secondary)", textAlign: "center", borderBottom: "2px solid var(--secondary)", paddingBottom: 6, marginBottom: 10, textTransform: "uppercase" }}>
            Grande Finale
          </div>
          <MatchCard m={km.gf} />
        </div>
      </div>
    );
  };

  // ── Winner banner ──────────────────────────────────────────────────────────
  const renderWinner = () => {
    if (!intl?.completed) return null;
    const allTeams = intl.type === "msi"
      ? [...(intl.bracket?.teams || []), ...(intl.play_in?.teams || [])]
      : [...(intl.knockout?.teams || []), ...(intl.play_in?.teams || [])];
    const wt = allTeams.find(t => t.id === intl.winner);
    return (
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ textAlign: "center", padding: "24px 0 20px", borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        <Trophy size={48} weight="fill" style={{ color: "var(--secondary)", marginBottom: 8 }} />
        <div className="font-heading" style={{ fontSize: 22, color: "var(--secondary)", marginBottom: 10 }}>
          Champion — {intl.name} 2026
        </div>
        {wt && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "10px 20px", background: "var(--surface)", borderRadius: 8 }}>
            <TeamLogo teamId={wt.id} abbr={wt.abbr} size={44} noClick />
            <div style={{ textAlign: "left" }}>
              <div className="font-heading" style={{ fontSize: 18 }}>{wt.name}</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{LEAGUE_FLAG[wt.league] || ""} {wt.league}</div>
            </div>
          </div>
        )}
        {wt?.id === uc && (
          <div style={{ marginTop: 12, display: "inline-block", padding: "6px 18px", background: "rgba(255,184,0,.15)", border: "1px solid var(--secondary)", borderRadius: 20, color: "var(--secondary)", fontWeight: 700, fontSize: 13 }}>
            🎉 Votre équipe est championne !
          </div>
        )}
      </motion.div>
    );
  };

  // ── Tab content dispatcher ─────────────────────────────────────────────────
  const isMSI = intl?.type === "msi";
  const tabs = isMSI
    ? [
        { id: "playin",  label: "Play-In",  done: intl?.play_in?.completed },
        { id: "bracket", label: "Bracket",  done: intl?.bracket?.completed },
      ]
    : [
        { id: "playin",   label: "Play-In",     done: intl?.play_in?.completed },
        { id: "swiss",    label: "Swiss Stage",  done: intl?.swiss?.completed },
        { id: "knockout", label: "Knockout",     done: intl?.knockout?.completed },
      ];

  const renderTabContent = () => {
    if (isMSI) {
      if (activeTab === "playin")  return renderMSIPlayIn();
      if (activeTab === "bracket") return renderMSIBracket();
    } else {
      if (activeTab === "playin")  return renderWorldsPlayIn();
      if (activeTab === "swiss") {
        if (!intl.play_in.completed)
          return <div style={{ textAlign: "center", padding: 48, color: "var(--text-secondary)" }}>En attente de la fin du Play-In...</div>;
        return renderWorldsSwiss();
      }
      if (activeTab === "knockout") {
        if (!intl.swiss?.completed)
          return <div style={{ textAlign: "center", padding: 48, color: "var(--text-secondary)" }}>En attente du Swiss Stage...</div>;
        return renderWorldsKnockout();
      }
    }
    return null;
  };

  const pendingCount = intl ? collectPending(intl).length : 0;

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div style={{ color: "var(--text-secondary)", fontSize: 15 }}>Chargement du tournoi...</div>
    </motion.div>
  );

  if (error) return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="card" style={{ textAlign: "center", padding: 48, maxWidth: 360 }}>
        <Globe size={40} style={{ color: "var(--text-secondary)", marginBottom: 12 }} />
        <div style={{ color: "var(--danger)", marginBottom: 20, fontSize: 14 }}>{error}</div>
        <button className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={fetchIntl}>
          <ArrowsClockwise size={14} />
          Réessayer
        </button>
      </div>
    </motion.div>
  );

  if (!intl) return null;

  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ background: "var(--bg-dark)", width: "95%", maxWidth: 900, maxHeight: "90vh", borderRadius: 6, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <Globe size={22} style={{ color: "var(--secondary)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: "var(--secondary)", textTransform: "uppercase", marginBottom: 2 }}>
              Tournoi International
            </div>
            <h2 className="font-heading" style={{ fontSize: 20, margin: 0 }}>{intl.name} 2026</h2>
          </div>
          {!intl.completed && pendingCount > 0 && (
            <button className="btn-secondary"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "7px 14px", flexShrink: 0 }}
              disabled={simAllActive || !!simming}
              onClick={simulateAll}
            >
              <ArrowsClockwise size={13} />
              Simuler tout ({pendingCount})
            </button>
          )}
          {intl.completed && (
            <button className="btn-primary" style={{ fontSize: 13, padding: "8px 20px", flexShrink: 0 }} onClick={onComplete}>
              Continuer →
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", paddingLeft: 12, flexShrink: 0 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "9px 16px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                background: "transparent", outline: "none",
                borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
                color: activeTab === tab.id ? "var(--primary)" : tab.done ? "var(--success)" : "var(--text-secondary)",
                marginBottom: -1, transition: "color .15s",
              }}>
              {tab.label}{tab.done ? " ✓" : ""}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px 28px", flex: 1, overflowY: "auto" }}>
          <UserStatus />
          {renderWinner()}
          {renderTabContent()}
        </div>

      </motion.div>
    </motion.div>
  );
};

export default InternationalModal;
