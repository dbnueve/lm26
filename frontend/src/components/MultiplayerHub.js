import React, { useState, useCallback, useMemo, useEffect } from "react";
import axios from "axios";
import { API } from "../shared";
import { useMultiplayerSocket } from "../hooks/useMultiplayerSocket";

// Composants solo réutilisés tels quels
import Dashboard from "./Dashboard";
import RosterPage from "./RosterPage";
import StandingsPage from "./StandingsPage";
import SchedulePage from "./SchedulePage";
import TrainingPage from "./TrainingPage";
import TeamLogo from "./TeamLogo";
import DraftSystem from "./DraftSystem";

/**
 * MultiplayerHub — même interface que le mode solo.
 * Réutilise les composants solo en adaptant les données MP au format attendu.
 *
 * Vues disponibles : dashboard, roster, standings, schedule, training, chat
 * Vues MP-only : ready panel (dans dashboard), draft active, joueurs connectés
 */
export default function MultiplayerHub({ sessionId, token, onExit, champions }) {
  const { state, connected, error: wsError } = useMultiplayerSocket(sessionId, token);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const post = useCallback(async (path, body = {}) => {
    setActionError(null);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/mp/${sessionId}${path}`, body);
      return res.data;
    } catch (e) {
      const msg = e?.response?.data?.detail || "Erreur";
      setActionError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const get = useCallback(async (path) => {
    try {
      const res = await axios.get(`${API}/mp/${sessionId}${path}`, { params: { token } });
      return res.data;
    } catch {
      return null;
    }
  }, [sessionId, token]);

  // ── Tous les useMemo AVANT tout return conditionnel ────────────────────────
  const myPlayer = state?.players?.find(p => p.side === state.my_side);
  const myTeamId = myPlayer?.team_id;
  const userTeam  = useMemo(() => state ? buildUserTeam(state) : null,              [state]);
  const standings = useMemo(() => state ? buildStandings(state) : null,             [state]);
  const schedule  = useMemo(() => state ? buildSchedule(state, myTeamId) : null,   [state, myTeamId]);
  const teams     = useMemo(() => state ? buildTeamsList(state) : null,             [state]);

  // ── Returns conditionnels APRÈS les hooks ─────────────────────────────────
  if (!state) {
    return (
      <div className="app-with-sidebar" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        {wsError
          ? <div style={{ textAlign: "center" }}>
              <div style={{ color: "var(--danger)", marginBottom: 16 }}>{wsError}</div>
              <button className="btn-secondary" onClick={onExit}>Retour au menu</button>
            </div>
          : <div style={{ color: "var(--text-2)" }}>
              {connected ? "Chargement…" : "Connexion au serveur…"}
            </div>
        }
      </div>
    );
  }

  if (state.phase === "waiting" || state.phase === "team_pick") {
    return <TeamPickScreen state={state} token={token} sessionId={sessionId} onExit={onExit} />;
  }

  if (state.phase === "finished") {
    return <FinishedScreen state={state} onExit={onExit} />;
  }
  // splitStatus minimal
  const splitStatus = { split_label: `Session MP — ${state.league} — Semaine ${state.week}` };

  // Handlers adaptés
  const handleSwapPlayers = async (p1id, p2id) => {
    await post("/roster/swap", { token, player1_id: p1id, player2_id: p2id });
  };

  const handleSetTrainingPlan = async (playerId, trainingType) => {
    const res = await post("/training/plan", { token, player_id: playerId, training_type: trainingType });
    if (!res) throw new Error(actionError || "Erreur");
    return res;
  };

  // "Jouer le match" en MP = marquer prêt → advance_week → draft démarre si HvH
  const handlePlayMatch = async () => {
    if (myPlayer?.ready) return; // déjà prêt
    await post("/ready", { token });
  };

  // Draft MP : parse l'état depuis active_draft
  const mpDraftRaw = useMemo(() => {
    if (!state?.active_draft) return null;
    try {
      const d = state.active_draft;
      const ds = typeof d.draft_json === "string" ? JSON.parse(d.draft_json) : (d.draft_json || {});
      // Injecter le côté "moi" pour que DraftSystem sache qui est user/enemy
      let mySide = null;
      if (d.team1 === myTeamId) mySide = 1;
      else if (d.team2 === myTeamId) mySide = 2;
      return { ...ds, _mySide: mySide, _team1: d.team1, _team2: d.team2, _matchId: d.id };
    } catch { return null; }
  }, [state?.active_draft, myTeamId]);

  const mpMyTurn = useMemo(() => {
    if (!mpDraftRaw) return false;
    const seq = mpDraftRaw.sequence || [];
    const step = mpDraftRaw.step || 0;
    const currentAction = step < seq.length ? seq[step] : null;
    if (!currentAction) return false;
    return Number(currentAction[1]) === mpDraftRaw._mySide;
  }, [mpDraftRaw]);

  const handleMpDraftAction = useCallback(async (champion, actionType) => {
    if (!state?.active_draft) return;
    await post("/draft/action", {
      token,
      match_id: state.active_draft.id,
      champion,
    });
  }, [post, state?.active_draft, token]);

  const MP_PAGES = ["dashboard", "roster", "standings", "schedule", "training", "playoffs"];

  // ── Rendu principal (même layout que le solo) ──────────────────────────────
  return (
    <>
      {/* Sidebar Navigation solo — filtrée pour le multi */}
      <MpNavigation
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        userTeam={userTeam}
        onExit={onExit}
        connected={connected}
        allowedPages={MP_PAGES}
      />

      <div className="app-with-sidebar">
        {/* Bandeau statut MP (connexion + joueurs) */}
        <MpStatusBar
          state={state}
          connected={connected}
          me={myPlayer}
        />

        {actionError && (
          <div style={{
            margin: "0 20px 0",
            padding: "10px 14px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius)",
            color: "var(--danger)",
            fontSize: 13,
          }}>
            {actionError}
          </div>
        )}

        {/* Draft active — plein écran comme en solo */}
        {state.active_draft && mpDraftRaw && !mpDraftRaw.completed && (
          <DraftSystem
            champions={champions || {}}
            onComplete={() => {/* la WS met à jour state.active_draft */}}
            onCancel={null}
            onMpAction={handleMpDraftAction}
            mpDraftState={mpDraftRaw}
            mpMyTurn={mpMyTurn}
            mpLabel={`Draft — ${mpDraftRaw._team1?.toUpperCase()} vs ${mpDraftRaw._team2?.toUpperCase()}${!mpDraftRaw._mySide ? " (spectateur)" : ""}`}
          />
        )}

        {/* Contenu — composants solo */}
        {currentPage === "dashboard" && (
          <Dashboard
            userTeam={userTeam}
            schedule={schedule}
            standings={standings}
            splitStatus={splitStatus}
            phase="regular"
            playoffsData={null}
            onPlayMatch={state.active_draft ? null : handlePlayMatch}
            onPlayPlayoffMatch={null}
            onSeasonStart={null}
            playMatchLabel={myPlayer?.ready ? "En attente des autres…" : "Jouer le match"}
            playMatchDisabled={!!myPlayer?.ready || !!state.active_draft}
          />
        )}

        {currentPage === "roster" && (
          <MpRosterWrapper
            sessionId={sessionId}
            token={token}
            get={get}
            onSwapPlayers={handleSwapPlayers}
          />
        )}

        {currentPage === "standings" && (
          <StandingsPage
            standings={standings}
            userTeam={userTeam}
          />
        )}

        {currentPage === "schedule" && (
          <SchedulePage
            schedule={schedule}
            teams={teams}
            userTeam={userTeam}
            onSimulateSeason={undefined}
          />
        )}

        {currentPage === "training" && (
          <MpTrainingWrapper
            sessionId={sessionId}
            token={token}
            get={get}
            onSetTrainingPlan={handleSetTrainingPlan}
          />
        )}

        {currentPage === "playoffs" && (
          <MpPlayoffsPage
            sessionId={sessionId}
            token={token}
            state={state}
            userTeam={userTeam}
            post={post}
          />
        )}
      </div>
    </>
  );
}

// ── Navigation MP ──────────────────────────────────────────────────────────────
// Même sidebar que le solo mais limitée aux pages disponibles en multi + bouton quitter

import {
  ChartBar, Users, Trophy, Calendar, Target, Sword,
  ArrowsClockwise,
} from "@phosphor-icons/react";

const MP_NAV_ITEMS = [
  { id: "dashboard",  label: "Dashboard",      icon: ChartBar },
  { id: "roster",     label: "Effectif",        icon: Users },
  { id: "standings",  label: "Classement",      icon: Trophy },
  { id: "schedule",   label: "Calendrier",      icon: Calendar },
  { id: "training",   label: "Entraînement",    icon: Target },
  { id: "playoffs",   label: "Playoffs",        icon: Sword },
];

function MpNavigation({ currentPage, setCurrentPage, userTeam, onExit, connected }) {
  const [hovered, setHovered] = useState(null);

  return (
    <aside style={{
      width: 56,
      minHeight: "100vh",
      background: "var(--surface-1)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "12px 0",
      position: "fixed",
      top: 0,
      left: 0,
      zIndex: 100,
      gap: 2,
    }}>
      {/* Logo LM */}
      <div style={{
        width: 32, height: 32,
        background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        borderRadius: "var(--radius-sm)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 13, color: "white",
        boxShadow: "var(--shadow-accent)",
        marginBottom: 14, flexShrink: 0,
      }} title="Mode Multijoueur">
        MP
      </div>

      {/* Indicateur connexion */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: connected ? "var(--success)" : "var(--danger)",
        marginBottom: 10,
        boxShadow: connected ? "0 0 6px var(--success)" : "none",
      }} title={connected ? "Connecté" : "Reconnexion…"} />

      {/* Items nav */}
      {MP_NAV_ITEMS.map(item => {
        const Icon = item.icon;
        const isActive = currentPage === item.id;
        return (
          <div key={item.id} style={{ position: "relative" }}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <button
              onClick={() => setCurrentPage(item.id)}
              style={{
                width: 40, height: 40,
                borderRadius: "var(--radius-sm)",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: isActive ? "rgba(139,92,246,0.15)" : hovered === item.id ? "var(--surface-2)" : "transparent",
                color: isActive ? "#8b5cf6" : hovered === item.id ? "var(--text-3)" : "var(--text-2)",
                border: "none", cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
              aria-label={item.label}
            >
              <Icon size={18} weight={isActive ? "fill" : "regular"} />
            </button>
            {hovered === item.id && (
              <div style={{
                position: "absolute", left: "calc(100% + 10px)", top: "50%",
                transform: "translateY(-50%)",
                background: "var(--surface-3)", color: "var(--text-1)",
                fontSize: 12, fontWeight: 500, padding: "5px 10px",
                borderRadius: "var(--radius-xs)", whiteSpace: "nowrap",
                border: "1px solid var(--border-strong)", zIndex: 200,
              }}>
                {item.label}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* Logo équipe + budget */}
      {userTeam?.id && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          marginBottom: 8, width: "100%", padding: "8px 6px",
          borderTop: "1px solid var(--border)",
        }}>
          <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={24} />
          <span style={{ fontSize: 10, color: "var(--text-2)", textAlign: "center" }}>
            {userTeam.abbr?.toUpperCase()}
          </span>
        </div>
      )}

      {/* Quitter */}
      <div style={{ position: "relative" }}
        onMouseEnter={() => setHovered("__exit")}
        onMouseLeave={() => setHovered(null)}
      >
        <button
          onClick={onExit}
          style={{
            width: 40, height: 40,
            borderRadius: "var(--radius-sm)",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: hovered === "__exit" ? "rgba(239,68,68,0.1)" : "transparent",
            color: hovered === "__exit" ? "var(--danger)" : "var(--text-2)",
            border: "none", cursor: "pointer",
          }}
          aria-label="Quitter la session"
        >
          <ArrowsClockwise size={16} />
        </button>
        {hovered === "__exit" && (
          <div style={{
            position: "absolute", left: "calc(100% + 10px)", top: "50%",
            transform: "translateY(-50%)",
            background: "var(--surface-3)", color: "var(--danger)",
            fontSize: 12, fontWeight: 500, padding: "5px 10px",
            borderRadius: "var(--radius-xs)", whiteSpace: "nowrap",
            border: "1px solid var(--danger)", zIndex: 200,
          }}>
            Quitter la session
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Bandeau statut MP ──────────────────────────────────────────────────────────
function MpStatusBar({ state, connected, me }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "10px 20px",
      background: "var(--surface-1)",
      borderBottom: "1px solid var(--border)",
      fontSize: 13,
    }}>
      {/* Joueurs connectés */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, flexWrap: "wrap" }}>
        {(state.players || []).map(p => (
          <span key={p.side} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: "var(--radius-xs)",
            background: p.side === state.my_side ? "rgba(139,92,246,0.12)" : "var(--surface-2)",
            border: p.side === state.my_side ? "1px solid #8b5cf6" : "1px solid var(--border)",
            color: p.side === state.my_side ? "#a78bfa" : "var(--text-2)",
            fontWeight: p.side === state.my_side ? 700 : 400,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: p.ready ? "var(--success)" : p.connected ? "var(--amber)" : "var(--text-2)",
              flexShrink: 0,
            }} />
            {p.username || `J${p.side}`}
            {p.team_id && <span style={{ color: "var(--text-2)", fontSize: 11 }}>·{p.team_id.toUpperCase()}</span>}
            {p.ready && <span style={{ color: "var(--success)", fontSize: 10 }}>✓</span>}
          </span>
        ))}
      </div>

      {/* Semaine */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--text-2)" }}>Semaine {state.week}</span>
        {state.active_draft && (
          <span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700 }}>DRAFT EN COURS</span>
        )}
      </div>
    </div>
  );
}

// MpDraftBanner et DraftSide supprimés — remplacés par DraftSystem en mode MP

// ── Roster wrapper (charge depuis /team) ──────────────────────────────────────
function MpRosterWrapper({ sessionId, token, get, onSwapPlayers }) {
  const [teamData, setTeamData] = useState(null);

  const reload = useCallback(() => {
    get("/team").then(d => {
      if (d) setTeamData(d);
    });
  }, [get]);

  useEffect(() => { reload(); }, [reload]);

  if (!teamData) {
    return (
      <div className="animate-slide-up" style={{ padding: 20, color: "var(--text-2)" }}>
        Chargement du roster…
      </div>
    );
  }

  // Construire le userTeam au format attendu par RosterPage
  const userTeam = {
    id: teamData.team?.id || "",
    name: teamData.team?.name || teamData.team?.id || "",
    abbr: teamData.team?.abbr || teamData.team?.id?.toUpperCase() || "",
    players: teamData.players || [],
    budget: teamData.team?.budget || 0,
    wins: teamData.team?.wins || 0,
    losses: teamData.team?.losses || 0,
  };

  const handleSwap = async (p1id, p2id) => {
    await onSwapPlayers(p1id, p2id);
    reload();
  };

  return <RosterPage userTeam={userTeam} onSwapPlayers={handleSwap} />;
}

// ── Training wrapper (charge depuis /team) ────────────────────────────────────
function MpTrainingWrapper({ sessionId, token, get, onSetTrainingPlan }) {
  const [teamData, setTeamData] = useState(null);

  useEffect(() => {
    get("/team").then(d => { if (d) setTeamData(d); });
  }, [get]);

  if (!teamData) {
    return (
      <div className="animate-slide-up" style={{ padding: 20, color: "var(--text-2)" }}>
        Chargement…
      </div>
    );
  }

  const userTeam = {
    id: teamData.team?.id || "",
    name: teamData.team?.name || teamData.team?.id || "",
    abbr: teamData.team?.abbr || teamData.team?.id?.toUpperCase() || "",
    players: teamData.players || [],
    budget: teamData.team?.budget || 0,
  };

  return <TrainingPage userTeam={userTeam} onSetTrainingPlan={onSetTrainingPlan} />;
}

// ── MpPlayoffsPage ────────────────────────────────────────────────────────────
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

function MpPlayoffsPage({ sessionId, token, state, userTeam, post }) {
  const [playoffsData, setPlayoffsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // match_id en cours
  const [error, setError] = useState(null);

  const fetchPlayoffs = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/mp/${sessionId}/playoffs`, { params: { token } });
      setPlayoffsData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur chargement playoffs");
    } finally {
      setLoading(false);
    }
  }, [sessionId, token]);

  useEffect(() => { fetchPlayoffs(); }, [fetchPlayoffs]);

  // Rafraîchit aussi quand la phase change (le state WS le détecte)
  useEffect(() => {
    if (state.phase === "playoffs" || state.phase === "finished") {
      fetchPlayoffs();
    }
  }, [state.phase, fetchPlayoffs]);

  const handleSimulate = async (matchId) => {
    setActionLoading(matchId);
    setError(null);
    try {
      await axios.post(`${API}/mp/${sessionId}/playoffs/simulate`, { token, match_id: matchId });
      await fetchPlayoffs();
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur simulation");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePlayGame = async (matchId) => {
    setActionLoading(matchId);
    setError(null);
    try {
      const res = await axios.post(`${API}/mp/${sessionId}/playoffs/play-game`, { token, match_id: matchId });
      await fetchPlayoffs();
      if (res.data.series_over) {
        // petit délai pour que l'animation soit visible
      }
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur");
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartPlayoffs = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/mp/${sessionId}/playoffs/start`, { token });
      await fetchPlayoffs();
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur démarrage playoffs");
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-slide-up" style={{ padding: 40, textAlign: "center", color: "var(--text-2)" }}>
        Chargement…
      </div>
    );
  }

  // ── Phase "saison régulière pas finie" ──────────────────────────────────────
  if (!playoffsData?.active) {
    const canForceStart = playoffsData?.unplayed_count === 0 && state.phase !== "playoffs";
    return (
      <div className="animate-slide-up" style={{ padding: 20 }}>
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <Sword size={28} style={{ color: "var(--amber)" }} />
          Playoffs
        </h2>
        {error && (
          <div style={{ padding: "10px 14px", marginBottom: 16, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", color: "var(--danger)", fontSize: 13 }}>
            {error}
          </div>
        )}
        <div className="card" style={{ textAlign: "center", padding: 60 }}>
          <Sword size={56} style={{ color: "var(--text-2)", marginBottom: 20 }} />
          <h3 className="font-heading" style={{ marginBottom: 12 }}>
            {playoffsData?.message || "Les playoffs n'ont pas encore commencé"}
          </h3>
          {playoffsData?.unplayed_count > 0 && (
            <p style={{ color: "var(--text-2)", marginBottom: 24, fontSize: 14 }}>
              {playoffsData.unplayed_count} match{playoffsData.unplayed_count > 1 ? "s" : ""} restant{playoffsData.unplayed_count > 1 ? "s" : ""} en saison régulière.
            </p>
          )}
          {canForceStart && (
            <button className="btn-primary" onClick={handleStartPlayoffs}>
              Démarrer les playoffs
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Champion couronné ───────────────────────────────────────────────────────
  if (playoffsData.champion) {
    return (
      <div className="animate-slide-up" style={{ padding: 20 }}>
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>Playoffs</h2>
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🏆</div>
          <h3 className="font-heading" style={{ fontSize: 24, marginBottom: 8 }}>Champion du split !</h3>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 24 }}>
            <TeamLogo teamId={playoffsData.champion.id} abbr={playoffsData.champion.abbr} size={52} />
            <span style={{ fontSize: 28, fontWeight: 900, color: "var(--amber)" }}>
              {playoffsData.champion.abbr}
            </span>
          </div>
          <PlaceholderBracket matches={playoffsData.matches} userTeamId={userTeam.id} />
        </div>
      </div>
    );
  }

  // ── Bracket actif ───────────────────────────────────────────────────────────
  const activeRounds = playoffsData.active_rounds || [];
  const byRound = {};
  for (const m of playoffsData.matches || []) {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  }

  const roundOrder = ["ub_r1", "ub_r2", "ub_final", "lb_r1", "lb_r2", "lb_r3", "lb_sf", "lb_final", "grand_final"];

  return (
    <div className="animate-slide-up" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h2 className="font-heading" style={{ fontSize: 32 }}>Playoffs</h2>
        <span style={{ padding: "3px 10px", borderRadius: 2, background: "rgba(245,158,11,0.15)", border: "1px solid var(--amber)", color: "var(--amber)", fontSize: 12, fontWeight: 700 }}>
          {activeRounds.map(r => ROUND_LABELS[r] || r).join(" · ")}
        </span>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", marginBottom: 16, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Équipes qualifiées */}
      <div className="card" style={{ padding: "14px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          Équipes qualifiées
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(playoffsData.qualified_teams || []).map(qt => (
            <div key={qt.id} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 10px", borderRadius: "var(--radius-xs)",
              background: qt.id === userTeam.id ? "rgba(139,92,246,0.12)" : "var(--surface-2)",
              border: `1px solid ${qt.id === userTeam.id ? "#8b5cf6" : "var(--border)"}`,
            }}>
              <span style={{ color: "var(--text-2)", fontSize: 11, minWidth: 18 }}>#{qt.seed}</span>
              <TeamLogo teamId={qt.id} abbr={qt.abbr} size={20} />
              <span style={{ fontSize: 13, fontWeight: qt.id === userTeam.id ? 700 : 400, color: qt.id === userTeam.id ? "#a78bfa" : "var(--text-1)" }}>
                {qt.abbr}
              </span>
              <span style={{
                fontSize: 10, padding: "1px 5px", borderRadius: 2, fontWeight: 700,
                background: qt.bracket === "UB" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                color: qt.bracket === "UB" ? "var(--success)" : "var(--danger)",
                border: `1px solid ${qt.bracket === "UB" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
              }}>
                {qt.bracket}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Matches par round */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {roundOrder
          .filter(rnd => byRound[rnd])
          .map(rnd => (
            <div key={rnd}>
              <div style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                {ROUND_LABELS[rnd] || rnd}
                {activeRounds.includes(rnd) && (
                  <span style={{ padding: "1px 6px", background: "rgba(245,158,11,0.2)", border: "1px solid var(--amber)", color: "var(--amber)", borderRadius: 2, fontSize: 10 }}>
                    EN COURS
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                {byRound[rnd].map(match => (
                  <PlayoffMatchCard
                    key={match.id}
                    match={match}
                    isActive={activeRounds.includes(match.round)}
                    userTeamId={userTeam.id}
                    actionLoading={actionLoading}
                    onSimulate={handleSimulate}
                    onPlayGame={handlePlayGame}
                  />
                ))}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

function PlayoffMatchCard({ match, isActive, userTeamId, actionLoading, onSimulate, onPlayGame }) {
  const isUserMatch = match.team1 === userTeamId || match.team2 === userTeamId;
  const t1win = match.winner === match.team1;
  const t2win = match.winner === match.team2;
  const isLoading = actionLoading === match.id;
  const winsNeeded = Math.ceil(match.best_of / 2);

  return (
    <div style={{
      background: "var(--surface-1)",
      border: `1px solid ${isActive && isUserMatch ? "#8b5cf6" : isActive ? "var(--border-strong)" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      padding: 16,
      opacity: !match.completed && !isActive ? 0.5 : 1,
      boxShadow: isActive && isUserMatch ? "0 0 16px rgba(139,92,246,0.12)" : "none",
    }}>
      <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <span>Bo{match.best_of}</span>
        {match.completed && (
          <span style={{ background: "var(--success)", color: "#000", padding: "1px 6px", borderRadius: 2, fontWeight: 700 }}>
            TERMINÉ
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Team 1 */}
        <div style={{ flex: 1, textAlign: "center" }}>
          <TeamLogo teamId={match.team1_data?.id} abbr={match.team1_data?.abbr || ""} size={36} />
          <div style={{ fontSize: 12, marginTop: 4, color: t1win ? "var(--success)" : "var(--text-2)", fontWeight: t1win ? 700 : 400 }}>
            {match.team1_data?.abbr}
          </div>
          {match.team1 === userTeamId && (
            <div style={{ fontSize: 10, color: "#a78bfa" }}>vous</div>
          )}
        </div>

        {/* Score */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", background: "var(--surface-2)", borderRadius: 4, minWidth: 70, justifyContent: "center" }}>
          <span className="font-stats" style={{ fontSize: 26, fontWeight: 900, color: t1win ? "var(--success)" : match.completed ? "var(--danger)" : "var(--text-1)" }}>
            {match.team1_wins}
          </span>
          <span style={{ color: "var(--text-2)" }}>-</span>
          <span className="font-stats" style={{ fontSize: 26, fontWeight: 900, color: t2win ? "var(--success)" : match.completed ? "var(--danger)" : "var(--text-1)" }}>
            {match.team2_wins}
          </span>
        </div>

        {/* Team 2 */}
        <div style={{ flex: 1, textAlign: "center" }}>
          <TeamLogo teamId={match.team2_data?.id} abbr={match.team2_data?.abbr || ""} size={36} />
          <div style={{ fontSize: 12, marginTop: 4, color: t2win ? "var(--success)" : "var(--text-2)", fontWeight: t2win ? 700 : 400 }}>
            {match.team2_data?.abbr}
          </div>
          {match.team2 === userTeamId && (
            <div style={{ fontSize: 10, color: "#a78bfa" }}>vous</div>
          )}
        </div>
      </div>

      {/* Actions */}
      {isActive && !match.completed && (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 8 }}>
          {isUserMatch ? (
            <button
              className="btn-primary"
              style={{ fontSize: 13, padding: "8px 18px", background: "#8b5cf6", opacity: isLoading ? 0.6 : 1 }}
              onClick={() => !isLoading && onPlayGame(match.id)}
              disabled={isLoading}
            >
              {isLoading ? "…" : `Jouer (${match.team1_wins + match.team2_wins} games / ${match.best_of})`}
            </button>
          ) : (
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6, opacity: isLoading ? 0.6 : 1 }}
              onClick={() => !isLoading && onSimulate(match.id)}
              disabled={isLoading}
            >
              <ArrowsClockwise size={14} />
              {isLoading ? "Simulation…" : "Simuler"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlaceholderBracket({ matches, userTeamId }) {
  // Vue compacte du bracket complet une fois terminé
  const roundOrder = ["ub_r1", "ub_r2", "ub_final", "lb_r1", "lb_r2", "lb_r3", "lb_sf", "lb_final", "grand_final"];
  const byRound = {};
  for (const m of matches || []) {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  }
  return (
    <div style={{ textAlign: "left", marginTop: 24 }}>
      {roundOrder.filter(r => byRound[r]).map(rnd => (
        <div key={rnd} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            {ROUND_LABELS[rnd]}
          </div>
          {byRound[rnd].map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "4px 0" }}>
              <span style={{ color: m.winner === m.team1 ? "var(--success)" : "var(--text-2)", fontWeight: m.winner === m.team1 ? 700 : 400 }}>
                {m.team1_data?.abbr}
              </span>
              <span style={{ color: "var(--text-2)" }}>{m.team1_wins} - {m.team2_wins}</span>
              <span style={{ color: m.winner === m.team2 ? "var(--success)" : "var(--text-2)", fontWeight: m.winner === m.team2 ? 700 : 400 }}>
                {m.team2_data?.abbr}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── TeamPickScreen ────────────────────────────────────────────────────────────
function TeamPickScreen({ state, token, sessionId, onExit }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get(`${API}/mp/league-teams/${state.league}`)
      .then(r => setTeams(r.data))
      .catch(() => {});
  }, [state.league]);

  const taken = state.players?.map(p => p.team_id).filter(Boolean) || [];
  const myTeam = state.my_team;

  const handlePick = async (teamId) => {
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API}/mp/${sessionId}/team`, { token, team_id: teamId });
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const readyCount = state.players?.filter(p => p.team_id).length || 0;
  const totalCount = state.players?.length || 0;

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--surface-0, #0a0c12)",
      padding: 20,
    }}>
      <div style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 36, maxWidth: 600, width: "100%",
      }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 10px", borderRadius: 2,
            background: "rgba(139,92,246,0.12)", border: "1px solid #8b5cf6",
            color: "#a78bfa", fontSize: 12, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: 1, marginBottom: 12,
          }}>
            {state.league} · Code : {state.code}
          </div>
          <h2 className="font-heading" style={{ fontSize: 26, marginBottom: 6 }}>
            {myTeam ? "Équipe choisie" : "Choisissez votre équipe"}
          </h2>
          <div style={{ color: "var(--text-2)", fontSize: 13 }}>
            {readyCount}/{totalCount} joueur{readyCount > 1 ? "s" : ""} ont choisi
          </div>
        </div>

        {/* Joueurs */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {(state.players || []).map(p => (
            <span key={p.side} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: "var(--radius-xs)",
              background: p.side === state.my_side ? "rgba(139,92,246,0.12)" : "var(--surface-2)",
              border: p.side === state.my_side ? "1px solid #8b5cf6" : "1px solid var(--border)",
              color: p.side === state.my_side ? "#a78bfa" : "var(--text-1)",
              fontSize: 13, fontWeight: p.side === state.my_side ? 700 : 400,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: p.team_id ? "var(--success)" : "var(--text-2)",
              }} />
              {p.username || `J${p.side}`}
              {p.team_id && (
                <span style={{ color: "var(--text-2)", fontSize: 11 }}>→ {p.team_id.toUpperCase()}</span>
              )}
            </span>
          ))}
        </div>

        {myTeam ? (
          <div style={{
            padding: "14px 18px",
            background: "rgba(34,197,94,0.08)",
            border: "1px solid var(--success)",
            borderRadius: "var(--radius-xs)",
            color: "var(--success)", fontSize: 14, fontWeight: 600,
            textAlign: "center", marginBottom: 20,
          }}>
            {myTeam.toUpperCase()} sélectionné — en attente des autres joueurs…
          </div>
        ) : (
          <>
            {error && (
              <div style={{
                padding: "10px 14px", marginBottom: 16,
                background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)",
                borderRadius: "var(--radius-xs)", color: "var(--danger)", fontSize: 13,
              }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {teams.map(t => {
                const isTaken = taken.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => !isTaken && !loading && handlePick(t.id)}
                    disabled={isTaken || loading}
                    style={{
                      padding: "10px 18px",
                      borderRadius: "var(--radius-xs)",
                      border: `1px solid ${isTaken ? "var(--border)" : "var(--border-strong)"}`,
                      background: isTaken ? "var(--surface-2)" : "var(--surface-2)",
                      color: isTaken ? "var(--text-2)" : "var(--text-1)",
                      cursor: isTaken ? "not-allowed" : "pointer",
                      fontSize: 14, fontWeight: 600,
                      opacity: isTaken ? 0.5 : 1,
                      transition: "border-color 0.15s, background 0.15s",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                    }}
                    onMouseEnter={e => { if (!isTaken) e.currentTarget.style.borderColor = "#8b5cf6"; }}
                    onMouseLeave={e => { if (!isTaken) e.currentTarget.style.borderColor = "var(--border-strong)"; }}
                  >
                    <TeamLogo teamId={t.id} abbr={t.abbr || t.id} size={32} />
                    {t.name || t.id.toUpperCase()}
                    {isTaken && <span style={{ fontSize: 10, color: "var(--danger)" }}>Pris</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <button className="btn-secondary" onClick={onExit} style={{ fontSize: 13 }}>
          Quitter la session
        </button>
      </div>
    </div>
  );
}

// ── FinishedScreen ────────────────────────────────────────────────────────────
function FinishedScreen({ state, onExit }) {
  const standings = buildStandings(state);
  const winner = standings[0];

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--surface-0, #0a0c12)", padding: 20,
    }}>
      <div style={{
        background: "var(--surface-1)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: 36, maxWidth: 500, width: "100%",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🏆</div>
        <h2 className="font-heading" style={{ fontSize: 28, marginBottom: 8 }}>Split terminé</h2>
        {winner && (
          <div style={{ color: "var(--amber)", fontWeight: 700, fontSize: 20, marginBottom: 24 }}>
            {winner.abbr?.toUpperCase()} remporte le split !
          </div>
        )}
        <div style={{ marginBottom: 24 }}>
          {standings.slice(0, 8).map((t, i) => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
              borderBottom: "1px solid var(--border)",
            }}>
              <span style={{ width: 24, color: i < 3 ? "var(--amber)" : "var(--text-2)", fontWeight: 700 }}>
                {i + 1}
              </span>
              <TeamLogo teamId={t.id} abbr={t.abbr} size={22} />
              <span style={{ flex: 1, textAlign: "left" }}>{t.abbr?.toUpperCase()}</span>
              <span style={{ color: "var(--success)" }}>{t.wins}V</span>
              <span style={{ color: "var(--danger)", marginLeft: 6 }}>{t.losses}D</span>
            </div>
          ))}
        </div>
        <button className="btn-primary" onClick={onExit}>Retour au menu</button>
      </div>
    </div>
  );
}

// ── Helpers de conversion MP → format solo ────────────────────────────────────

function buildUserTeam(state) {
  // Le backend retourne my_team_data avec joueurs hydratés et stats complètes
  const d = state.my_team_data;
  const id = state.my_team || "";
  if (!id) return { id: "", name: "", abbr: "", players: [], wins: 0, losses: 0, budget: 0, league: state.league };

  if (d) {
    return {
      id,
      name: d.name || id,
      abbr: d.abbr || id.toUpperCase(),
      league: state.league || d.league || "",
      players: d.players || [],
      wins: d.wins || 0,
      losses: d.losses || 0,
      budget: d.budget || 0,
    };
  }

  // Fallback si my_team_data absent (ex: phase team_pick)
  const s = (state.standings || {})[id] || {};
  return {
    id,
    name: s.name || id,
    abbr: s.abbr || id.toUpperCase(),
    league: state.league || "",
    players: [],
    wins: s.wins || 0,
    losses: s.losses || 0,
    budget: 0,
  };
}

function buildStandings(state) {
  const standingsMap = state.standings || {};
  const humanTeams = new Set((state.players || []).map(p => p.team_id).filter(Boolean));
  const totalWeeks = (state.schedule || []).reduce((m, s) => Math.max(m, s.week || 0), 0);
  // Top ~40% qualifiés playoffs
  const total = Object.keys(standingsMap).length;
  const qualifyCutoff = Math.ceil(total * 0.4);

  return Object.entries(standingsMap)
    .map(([id, s]) => ({
      id,
      abbr: s.abbr || id.toUpperCase(),
      name: s.name || id,
      wins: s.wins || 0,
      losses: s.losses || 0,
      winrate: (s.wins || 0) + (s.losses || 0) > 0
        ? Math.round(((s.wins || 0) / ((s.wins || 0) + (s.losses || 0))) * 100)
        : 0,
      elo: s.elo || 1000,
      qualified: false, // mis à jour après tri
      is_human: humanTeams.has(id),
      rank: 0,
    }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.elo - a.elo)
    .map((t, i) => ({ ...t, rank: i + 1, qualified: i < qualifyCutoff }));
}

function buildSchedule(state, myTeamId) {
  return (state.schedule || []).map(m => {
    let result = null;
    try { result = m.result_json ? JSON.parse(m.result_json) : null; } catch {}
    const winner = result ? (result.winner === 1 ? m.team1 : m.team2) : null;
    return {
      id: m.id,
      week: m.week,
      team1: m.team1,
      team2: m.team2,
      played: !!m.result_json,
      winner,
      result,
      is_human_vs_human: m.is_human_vs_human,
      // Pour la SchedulePage solo — elle filtre sur userTeam.id
    };
  });
}

function buildTeamsList(state) {
  const standingsMap = state.standings || {};
  return Object.keys(standingsMap).map(id => ({
    id,
    abbr: id.toUpperCase(),
    name: id,
  }));
}
