import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowsClockwise, Globe, Trophy, Sword, GameController, Star } from "@phosphor-icons/react";
import { API_CLIENT } from "../shared";
import TeamLogo from "./TeamLogo";
import DraftSystem from "./DraftSystem";
import { LEAGUE_FLAG, LEAGUE_COLOR, C, btnStyle, EmptyState } from "./intlConstants";

// ══════════════════════════════════════════════════════════════════════════════
const InternationalModal = ({ userTeam, champions = {}, onComplete }) => {
  const [intl,         setIntl]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [simming,      setSimming]      = useState(null);
  const [activeTab,    setActiveTab]    = useState(null);
  const [simAllActive, setSimAllActive] = useState(false);
  const [showDraft,    setShowDraft]    = useState(false);
  const [draftMatchId, setDraftMatchId] = useState(null);
  const [pendingDraft, setPendingDraft] = useState(null);

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchIntl = useCallback(async () => {
    setError(null);
    try {
      const res = await API_CLIENT.get("/international");
      setIntl(res.data);
    } catch (err) {
      if (err?.response?.status === 404) {
        try {
          const res = await API_CLIENT.post("/international/start");
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

  const simulate = useCallback(async (matchId, userDraft = null) => {
    setSimming(matchId);
    setPendingDraft(null);
    setDraftMatchId(null);
    try {
      const payload = { match_id: matchId };
      if (userDraft) payload.user_draft = userDraft;
      const res = await axios.post(API + "/international/simulate", payload);
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

  // ════════════════════════════════════════════════════════════════════════════
  // ── Sub-components ──────────────────────────────────────────────────────────

  // Team slot inside a match card
  const TeamSlot = ({ t, isWinner, side }) => {
    if (!t) return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1,
        justifyContent: side === "right" ? "flex-end" : "flex-start" }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%",
          background: C.surface, border: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.muted, fontSize: 11 }}>?</div>
        <span style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>TBD</span>
      </div>
    );
    const isUser  = t.id === uc;
    const lColor  = LEAGUE_COLOR[t.league] || C.muted;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1,
        justifyContent: side === "right" ? "flex-end" : "flex-start",
        flexDirection: side === "right" ? "row-reverse" : "row" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <TeamLogo teamId={t.id} abbr={t.abbr} size={34} noClick />
          {isUser && (
            <div style={{ position: "absolute", bottom: -2, right: -2,
              width: 10, height: 10, borderRadius: "50%",
              background: C.gold, border: "1px solid #000" }} />
          )}
        </div>
        <div style={{ textAlign: side === "right" ? "right" : "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4,
            flexDirection: side === "right" ? "row-reverse" : "row" }}>
            <span style={{ fontSize: 13, fontWeight: isUser ? 800 : 600,
              color: isUser ? C.gold : isWinner ? C.text : C.muted }}>
              {t.abbr}
            </span>
            {isWinner && <span style={{ color: C.success, fontSize: 13 }}>✓</span>}
          </div>
          <div style={{ fontSize: 10, color: lColor, fontWeight: 600 }}>
            {LEAGUE_FLAG[t.league] || ""} {t.league}
          </div>
        </div>
      </div>
    );
  };

  // Match card — the main building block
  const MatchCard = ({ m, compact }) => {
    if (!m) return null;
    const played  = !!m.winner_id;
    const locked  = m.locked || !m.team1 || !m.team2;
    const isUser  = m.team1?.id === uc || m.team2?.id === uc;
    const canSim  = !played && !locked;
    const t1win   = played && m.winner_id === m.team1?.id;
    const t2win   = played && m.winner_id === m.team2?.id;
    const isSimming = simming === m.id;

    const accentColor = locked ? C.border
      : isUser && !played ? C.gold
      : played ? C.border
      : C.blue;

    return (
      <motion.div
        layout
        style={{
          background: isUser && !played ? C.goldDim : C.surface,
          border: `1px solid ${accentColor}`,
          borderLeft: `3px solid ${accentColor}`,
          borderRadius: 6,
          padding: compact ? "8px 12px" : "10px 14px",
          marginBottom: 6,
          opacity: locked ? 0.4 : 1,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {isSimming && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
            background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)`,
            animation: "shimmer 1.2s infinite" }} />
        )}

        {/* Round label + format */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 8, gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
            color: isUser && !played ? C.gold : C.muted,
            textTransform: "uppercase" }}>
            {isUser && !played ? "★ " : ""}{m.round}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, color: C.muted,
            background: "rgba(255,255,255,.06)", padding: "2px 6px", borderRadius: 3,
            letterSpacing: 1 }}>
            BO{m.best_of}
          </span>
        </div>

        {/* Teams + score */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TeamSlot t={m.team1} isWinner={t1win} side="left" />

          <div style={{ minWidth: 52, textAlign: "center", flexShrink: 0 }}>
            {played ? (
              <span className="font-stats" style={{ fontSize: compact ? 18 : 22, fontWeight: 900, letterSpacing: 2 }}>
                <span style={{ color: t1win ? C.success : C.danger }}>{m.score1}</span>
                <span style={{ color: C.muted, margin: "0 3px", fontSize: 14 }}>–</span>
                <span style={{ color: t2win ? C.success : C.danger }}>{m.score2}</span>
              </span>
            ) : (
              <span style={{ color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>VS</span>
            )}
          </div>

          <TeamSlot t={m.team2} isWinner={t2win} side="right" />
        </div>

        {/* Action buttons */}
        {canSim && (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 6 }}>
            {isUser ? (
              draftMatchId === m.id && pendingDraft ? (
                <button onClick={() => simulate(m.id, pendingDraft)}
                  disabled={!!simming}
                  style={btnStyle("gold")}>
                  <GameController size={13} weight="bold" />
                  Lancer le match
                </button>
              ) : (
                <>
                  <button onClick={() => { setDraftMatchId(m.id); setPendingDraft(null); setShowDraft(true); }}
                    disabled={!!simming || simAllActive}
                    style={btnStyle("ghost")}>
                    <Sword size={13} />
                    {draftMatchId === m.id ? "Redraft" : "Draft"}
                  </button>
                  <button onClick={() => simulate(m.id)}
                    disabled={!!simming || simAllActive}
                    style={btnStyle("primary")}>
                    <GameController size={13} />
                    Simuler
                  </button>
                </>
              )
            ) : (
              <button onClick={() => simulate(m.id)}
                disabled={!!simming || simAllActive}
                style={btnStyle("ghost")}>
                {isSimming ? <><ArrowsClockwise size={12} style={{ animation: "spin 1s linear infinite" }} /> Simulation...</> : "Simuler"}
              </button>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  // Section header divider
  const SectionHead = ({ label, done, color }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 8px" }}>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2,
        color: done ? C.success : color || C.blue,
        textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {done && <span style={{ color: C.success, fontSize: 10 }}>✓</span>}
      <div style={{ flex: 1, height: 1, background: C.borderSub }} />
    </div>
  );

  // Column header (UB / LB)
  const ColHeader = ({ label, color }) => (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2,
      color: color || C.blue, textTransform: "uppercase",
      borderBottom: `2px solid ${color || C.blue}`,
      paddingBottom: 6, marginBottom: 10 }}>
      {label}
    </div>
  );

  // ── User status banner ──────────────────────────────────────────────────────
  const UserStatus = () => {
    if (!intl || !userTeam) return null;

    if (!intl.user_qualified) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", background: C.surface,
          border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 16 }}>
          <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={22} noClick />
          <span style={{ fontWeight: 700, fontSize: 13 }}>{userTeam.abbr}</span>
          <span style={{ color: C.muted, fontSize: 12 }}>·</span>
          <span style={{ fontSize: 12, color: C.muted }}>Non qualifié — Mode spectateur</span>
        </div>
      );
    }

    let statusText = "En compétition";
    let statusColor = C.blue;
    let statusBg = C.blueDim;

    if (intl.type === "msi") {
      const pi = intl.play_in; const bk = intl.bracket;
      const inPI = pi.teams?.some(t => t.id === uc);
      const inPreseeded = bk.pre_seeded?.some(t => t.id === uc);
      const inBK = bk.teams?.some(t => t.id === uc);
      if (intl.winner === uc)               { statusText = "🏆 Champion MSI 2026!"; statusColor = C.gold; statusBg = C.goldDim; }
      else if (inBK && bk.completed)        { statusText = "Éliminé au Bracket Stage"; statusColor = C.danger; statusBg = "rgba(255,51,102,.08)"; }
      else if (inBK || inPreseeded)         { statusText = "Bracket Stage — En compétition"; }
      else if (pi.completed && inPI)        { statusText = "Éliminé en Play-In"; statusColor = C.danger; statusBg = "rgba(255,51,102,.08)"; }
      else if (inPI)                        { statusText = "Play-In — En compétition"; }
    } else {
      const sw = intl.swiss; const ko = intl.knockout;
      const swTeam = sw.teams?.find(t => t.id === uc);
      const inPreQ = sw.pre_qualified?.some(t => t.id === uc);
      const inKO   = ko.teams?.some(t => t.id === uc);
      const inPI   = intl.play_in?.teams?.some(t => t.id === uc);
      if (intl.winner === uc)              { statusText = "🏆 Champion Worlds 2026!"; statusColor = C.gold; statusBg = C.goldDim; }
      else if (inKO && ko.completed)       { statusText = "Éliminé au Knockout"; statusColor = C.danger; statusBg = "rgba(255,51,102,.08)"; }
      else if (inKO)                       { statusText = "Knockout Stage — En compétition"; }
      else if (swTeam?.sw_eliminated)      { statusText = `Éliminé en Swiss (${swTeam.sw_wins}W-${swTeam.sw_losses}L)`; statusColor = C.danger; statusBg = "rgba(255,51,102,.08)"; }
      else if (swTeam?.sw_advanced)        { statusText = `Swiss Stage — Qualifié ✓ (${swTeam.sw_wins}W)`; statusColor = C.success; statusBg = "rgba(0,214,92,.08)"; }
      else if (swTeam || inPreQ)           { statusText = swTeam ? `Swiss Stage — ${swTeam.sw_wins}W · ${swTeam.sw_losses}L` : "Swiss Stage"; }
      else if (intl.play_in.completed && inPI) { statusText = "Éliminé en Play-In"; statusColor = C.danger; statusBg = "rgba(255,51,102,.08)"; }
      else if (inPI)                       { statusText = "Play-In — En compétition"; }
    }

    return (
      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", background: statusBg,
          border: `1px solid ${statusColor}40`, borderRadius: 6, marginBottom: 16 }}>
        <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={24} noClick />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontWeight: 800, fontSize: 12, color: C.text }}>{userTeam.name || userTeam.abbr}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusText}</span>
        </div>
      </motion.div>
    );
  };

  // ── MSI Play-In ─────────────────────────────────────────────────────────────
  const renderMSIPlayIn = () => {
    const ms = intl.play_in.matches || {};
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <ColHeader label="Upper Bracket" color={C.blue} />
          <SectionHead label="UB Round 1" done={ms.pi_ub1?.winner_id && ms.pi_ub2?.winner_id} />
          <MatchCard m={ms.pi_ub1} />
          <MatchCard m={ms.pi_ub2} />
          <SectionHead label="UB Final" done={!!ms.pi_ubf?.winner_id} />
          <MatchCard m={ms.pi_ubf} />
        </div>
        <div>
          <ColHeader label="Lower Bracket" color={C.danger} />
          <SectionHead label="LB Round 1" done={!!ms.pi_lb1?.winner_id} color={C.danger} />
          <MatchCard m={ms.pi_lb1} />
          <SectionHead label="LB Final" done={!!ms.pi_lbf?.winner_id} color={C.danger} />
          <MatchCard m={ms.pi_lbf} />
        </div>
      </div>
    );
  };

  // ── MSI Bracket ─────────────────────────────────────────────────────────────
  const renderMSIBracket = () => {
    const bm = intl.bracket.matches || {};
    if (Object.keys(bm).length === 0)
      return (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.muted }}>
          <Globe size={36} style={{ marginBottom: 12, opacity: .4 }} />
          <div style={{ fontSize: 13 }}>En attente de la fin du Play-In...</div>
        </div>
      );
    const ubR1Done = ["ub1_1","ub1_2","ub1_3","ub1_4"].every(id => bm[id]?.winner_id);
    const ubSFDone = bm.ub2_1?.winner_id && bm.ub2_2?.winner_id;
    const lbR1Done = bm.lb1_1?.winner_id && bm.lb1_2?.winner_id;
    const lbQFDone = bm.lb2_1?.winner_id && bm.lb2_2?.winner_id;
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <ColHeader label="Upper Bracket" color={C.blue} />
            <SectionHead label="Round 1" done={ubR1Done} />
            <MatchCard m={bm.ub1_1} compact /> <MatchCard m={bm.ub1_2} compact />
            <MatchCard m={bm.ub1_3} compact /> <MatchCard m={bm.ub1_4} compact />
            <SectionHead label="Demi-finales" done={ubSFDone} />
            <MatchCard m={bm.ub2_1} /> <MatchCard m={bm.ub2_2} />
            <SectionHead label="UB Final" done={!!bm.ubf?.winner_id} />
            <MatchCard m={bm.ubf} />
          </div>
          <div>
            <ColHeader label="Lower Bracket" color={C.danger} />
            <SectionHead label="Round 1" done={lbR1Done} color={C.danger} />
            <MatchCard m={bm.lb1_1} compact /> <MatchCard m={bm.lb1_2} compact />
            <SectionHead label="Quarts de finale" done={lbQFDone} color={C.danger} />
            <MatchCard m={bm.lb2_1} compact /> <MatchCard m={bm.lb2_2} compact />
            <SectionHead label="Demi-finale" done={!!bm.lb3?.winner_id} color={C.danger} />
            <MatchCard m={bm.lb3} />
            <SectionHead label="LB Final" done={!!bm.lbf?.winner_id} color={C.danger} />
            <MatchCard m={bm.lbf} />
          </div>
        </div>
        {/* Grand Final */}
        <div style={{ maxWidth: 460, margin: "24px auto 0" }}>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3,
              color: C.gold, textTransform: "uppercase",
              background: C.goldDim, padding: "4px 14px", borderRadius: 12,
              border: `1px solid ${C.goldBorder}` }}>
              ★ Grande Finale ★
            </span>
          </div>
          <MatchCard m={bm.gf} />
        </div>
      </div>
    );
  };

  // ── Worlds Play-In ──────────────────────────────────────────────────────────
  const renderWorldsPlayIn = () => (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: C.muted }}>
          1 place qualificative pour le Swiss Stage (16 équipes)
        </span>
      </div>
      <MatchCard m={intl.play_in.match} />
    </div>
  );

  // ── Worlds Swiss ────────────────────────────────────────────────────────────
  const renderWorldsSwiss = () => {
    const sw = intl.swiss;
    const rounds = sw.rounds || [];
    const curRound = rounds[rounds.length - 1];
    const curMs    = curRound ? Object.values(curRound.matches) : [];
    const teams    = sw.teams ? [...sw.teams].sort((a, b) => b.sw_wins - a.sw_wins || a.sw_losses - b.sw_losses) : [];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
        {/* Standings */}
        <div>
          <ColHeader label="Classement Swiss" color={C.muted} />
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {teams.map((t, i) => {
              const isUser   = t.id === uc;
              const lColor   = LEAGUE_COLOR[t.league] || C.muted;
              const advanced = t.sw_advanced;
              const elim     = t.sw_eliminated;
              const maxGames = 5;
              const winPct   = (t.sw_wins / maxGames) * 100;
              const lossPct  = (t.sw_losses / maxGames) * 100;
              return (
                <div key={t.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 10px", borderRadius: 5,
                  background: isUser ? C.goldDim : advanced ? "rgba(0,214,92,.05)" : elim ? "rgba(255,51,102,.04)" : C.surface,
                  border: `1px solid ${isUser ? C.goldBorder : advanced ? "rgba(0,214,92,.15)" : elim ? "rgba(255,51,102,.12)" : C.borderSub}`,
                  opacity: elim ? 0.55 : 1,
                }}>
                  <span style={{ fontSize: 11, color: C.muted, width: 16, textAlign: "right", flexShrink: 0 }}>{i+1}</span>
                  <TeamLogo teamId={t.id} abbr={t.abbr} size={20} noClick />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: isUser ? 800 : 600,
                        color: isUser ? C.gold : C.text, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.abbr}
                      </span>
                      <span style={{ fontSize: 9, color: lColor, flexShrink: 0 }}>{LEAGUE_FLAG[t.league]}</span>
                    </div>
                    {/* W/L bar */}
                    <div style={{ height: 3, borderRadius: 2, overflow: "hidden",
                      background: "rgba(255,255,255,.06)", marginTop: 3 }}>
                      <div style={{ display: "flex", height: "100%" }}>
                        <div style={{ width: `${winPct}%`, background: C.success, transition: "width .4s" }} />
                        <div style={{ width: `${lossPct}%`, background: C.danger, transition: "width .4s" }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.success }}>{t.sw_wins}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>–</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.danger }}>{t.sw_losses}</span>
                  </div>
                  <div style={{ width: 18, textAlign: "center", flexShrink: 0 }}>
                    {advanced && <span style={{ fontSize: 11, color: C.success }}>Q</span>}
                    {elim     && <span style={{ fontSize: 11, color: C.danger }}>E</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current round matches */}
        <div>
          {curRound && (
            <>
              <ColHeader
                label={`Round ${curRound.round} / 5${curRound.completed ? " ✓" : ""}`}
                color={curRound.completed ? C.success : C.blue}
              />
              {curMs.map(m => <MatchCard key={m.id} m={m} />)}
            </>
          )}
          {sw.completed && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>🏆</div>
              <div style={{ color: C.success, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Swiss Stage terminé
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>
                {sw.advanced?.length || 0} équipes qualifiées pour le Knockout Stage
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Worlds Knockout ─────────────────────────────────────────────────────────
  const renderWorldsKnockout = () => {
    const km = intl.knockout.matches || {};
    const qfDone = ["qf1","qf2","qf3","qf4"].every(id => km[id]?.winner_id);
    const sfDone = km.sf1?.winner_id && km.sf2?.winner_id;
    return (
      <div>
        <SectionHead label="Quarts de finale" done={qfDone} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
          <MatchCard m={km.qf1} /> <MatchCard m={km.qf3} />
          <MatchCard m={km.qf2} /> <MatchCard m={km.qf4} />
        </div>
        <SectionHead label="Demi-finales" done={sfDone} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
          <MatchCard m={km.sf1} /> <MatchCard m={km.sf2} />
        </div>
        <div style={{ maxWidth: 460, margin: "24px auto 0" }}>
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3,
              color: C.gold, textTransform: "uppercase",
              background: C.goldDim, padding: "4px 14px", borderRadius: 12,
              border: `1px solid ${C.goldBorder}` }}>
              ★ Grande Finale ★
            </span>
          </div>
          <MatchCard m={km.gf} />
        </div>
      </div>
    );
  };

  // ── Winner banner ────────────────────────────────────────────────────────────
  const renderWinner = () => {
    if (!intl?.completed) return null;
    const allTeams = intl.type === "msi"
      ? [...(intl.bracket?.teams || []), ...(intl.play_in?.teams || [])]
      : [...(intl.knockout?.teams || []), ...(intl.play_in?.teams || []),
         ...(intl.swiss?.teams || [])];
    const wt = allTeams.find(t => t.id === intl.winner);
    const isUserWinner = wt?.id === uc;
    const lColor = wt ? (LEAGUE_COLOR[wt.league] || C.muted) : C.muted;

    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        style={{
          background: isUserWinner
            ? `linear-gradient(135deg, rgba(255,184,0,.15) 0%, rgba(255,184,0,.04) 100%)`
            : `linear-gradient(135deg, rgba(79,195,247,.08) 0%, rgba(79,195,247,.02) 100%)`,
          border: `1px solid ${isUserWinner ? C.goldBorder : "rgba(79,195,247,.2)"}`,
          borderRadius: 8, padding: "20px 24px", marginBottom: 20,
          display: "flex", alignItems: "center", gap: 20,
        }}>
        <Trophy size={44} weight="fill"
          style={{ color: isUserWinner ? C.gold : C.blue, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2,
            color: isUserWinner ? C.gold : C.blue, textTransform: "uppercase", marginBottom: 4 }}>
            Champion — {intl.name} 2026
          </div>
          {wt ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <TeamLogo teamId={wt.id} abbr={wt.abbr} size={40} noClick />
              <div>
                <div className="font-heading" style={{ fontSize: 20, color: C.text }}>{wt.name}</div>
                <div style={{ fontSize: 12, color: lColor, fontWeight: 600 }}>
                  {LEAGUE_FLAG[wt.league] || ""} {wt.league}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {isUserWinner && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Star size={20} weight="fill" style={{ color: C.gold }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: C.gold, textAlign: "center", letterSpacing: .5 }}>
              Votre équipe<br />est championne !
            </span>
          </div>
        )}
      </motion.div>
    );
  };

  // ── Tab + content ────────────────────────────────────────────────────────────
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
          return <EmptyState label="En attente de la fin du Play-In..." />;
        return renderWorldsSwiss();
      }
      if (activeTab === "knockout") {
        if (!intl.swiss?.completed)
          return <EmptyState label="En attente du Swiss Stage..." />;
        return renderWorldsKnockout();
      }
    }
    return null;
  };

  const pendingCount = intl ? collectPending(intl).length : 0;

  // ── Loading / error / draft overlay ─────────────────────────────────────────
  if (loading) return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <ArrowsClockwise size={28} style={{ color: C.blue, animation: "spin 1.2s linear infinite" }} />
        <span style={{ color: C.muted, fontSize: 13 }}>Chargement du tournoi...</span>
      </div>
    </motion.div>
  );

  if (error) return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div style={{ background: "var(--bg)", border: `1px solid ${C.border}`,
        borderRadius: 8, padding: "40px 48px", textAlign: "center", maxWidth: 360 }}>
        <Globe size={36} style={{ color: C.muted, marginBottom: 12 }} />
        <div style={{ color: C.danger, marginBottom: 20, fontSize: 13 }}>{error}</div>
        <button style={btnStyle("ghost")} onClick={fetchIntl}>
          <ArrowsClockwise size={13} /> Réessayer
        </button>
      </div>
    </motion.div>
  );

  if (!intl) return null;

  if (showDraft) return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <DraftSystem
        champions={champions}
        matchId={null}
        onComplete={(completed) => {
          setShowDraft(false);
          setPendingDraft({
            picks: completed.user_picks || [],
            bans:  completed.user_bans  || [],
            enemy_picks: completed.enemy_picks || [],
            enemy_bans:  completed.enemy_bans  || [],
          });
        }}
        onCancel={() => setShowDraft(false)}
      />
    </motion.div>
  );

  // ── MAIN RENDER ──────────────────────────────────────────────────────────────
  const tourneyColor = isMSI ? C.blue : C.gold;
  const stageLabel   = {
    play_in:   "Play-In",
    bracket:   "Bracket Stage",
    swiss:     "Swiss Stage",
    knockout:  "Knockout Stage",
    completed: "Terminé",
  }[intl.stage] || intl.stage;

  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={{
          background: "var(--bg)",
          width: "95%", maxWidth: 920, maxHeight: "90vh",
          borderRadius: 8, display: "flex", flexDirection: "column",
          overflow: "hidden",
          border: `1px solid ${C.border}`,
          boxShadow: `0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04)`,
        }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{
          padding: "0 0 0 0",
          flexShrink: 0,
          background: `linear-gradient(135deg, rgba(10,12,24,1) 0%, rgba(14,20,40,1) 100%)`,
          borderBottom: `1px solid ${C.border}`,
          position: "relative", overflow: "hidden",
        }}>
          {/* Decorative glow */}
          <div style={{ position: "absolute", top: -40, right: -40,
            width: 160, height: 160, borderRadius: "50%",
            background: `${tourneyColor}18`, filter: "blur(40px)", pointerEvents: "none" }} />

          <div style={{ position: "relative", padding: "14px 20px 12px",
            display: "flex", alignItems: "center", gap: 14 }}>

            {/* Tournament badge */}
            <div style={{
              width: 44, height: 44, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(135deg, ${tourneyColor}22, ${tourneyColor}08)`,
              border: `1px solid ${tourneyColor}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {isMSI
                ? <Globe size={22} style={{ color: tourneyColor }} />
                : <Trophy size={22} weight="fill" style={{ color: tourneyColor }} />
              }
            </div>

            {/* Title block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3,
                color: tourneyColor, textTransform: "uppercase", marginBottom: 1 }}>
                Tournoi International 2026
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <h2 className="font-heading" style={{ fontSize: 20, margin: 0, color: C.text }}>
                  {intl.name}
                </h2>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: tourneyColor,
                  background: `${tourneyColor}18`, padding: "2px 8px", borderRadius: 10,
                  border: `1px solid ${tourneyColor}30`,
                }}>
                  {stageLabel}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {!intl.completed && pendingCount > 0 && (
                <button onClick={simulateAll}
                  disabled={simAllActive || !!simming}
                  style={btnStyle("ghost", simAllActive)}>
                  <ArrowsClockwise size={13}
                    style={{ animation: simAllActive ? "spin 1s linear infinite" : "none" }} />
                  {simAllActive ? "Simulation..." : `Simuler tout (${pendingCount})`}
                </button>
              )}
              {intl.completed && (
                <button onClick={onComplete} style={btnStyle("gold")}>
                  Continuer →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`,
          paddingLeft: 8, background: "rgba(0,0,0,.2)", flexShrink: 0 }}>
          {tabs.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: "10px 18px", fontSize: 12, fontWeight: 700,
                border: "none", cursor: "pointer", background: "transparent",
                outline: "none", letterSpacing: .5,
                borderBottom: active ? `2px solid ${C.blue}` : "2px solid transparent",
                color: active ? C.blue : tab.done ? C.success : C.muted,
                marginBottom: -1, transition: "color .15s",
              }}>
                {tab.done ? "✓ " : ""}{tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div style={{ padding: "16px 20px 28px", flex: 1, overflowY: "auto" }}>
          <UserStatus />
          {renderWinner()}
          <AnimatePresence mode="wait">
            <motion.div key={activeTab}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              {renderTabContent()}
            </motion.div>
          </AnimatePresence>
        </div>

      </motion.div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </motion.div>
  );
};

export default InternationalModal;
