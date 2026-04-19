import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
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

/**
 * MultiplayerHub — même interface que le mode solo.
 * Réutilise les composants solo en adaptant les données MP au format attendu.
 *
 * Vues disponibles : dashboard, roster, standings, schedule, training, chat
 * Vues MP-only : ready panel (dans dashboard), draft active, joueurs connectés
 */
export default function MultiplayerHub({ sessionId, token, onExit }) {
  const { state, connected, error: wsError } = useMultiplayerSocket(sessionId, token);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  // ── Helpers HTTP ───────────────────────────────────────────────────────────
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

  // ── Chargement ─────────────────────────────────────────────────────────────
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

  // ── Phase sélection d'équipe ───────────────────────────────────────────────
  if (state.phase === "waiting" || state.phase === "team_pick") {
    return (
      <TeamPickScreen
        state={state}
        token={token}
        sessionId={sessionId}
        onExit={onExit}
      />
    );
  }

  // ── Phase terminée ─────────────────────────────────────────────────────────
  if (state.phase === "finished") {
    return <FinishedScreen state={state} onExit={onExit} />;
  }

  // ── Adapters : données MP → format des composants solo ────────────────────

  // userTeam : shape attendue par Dashboard, RosterPage, TrainingPage
  const myPlayer = state.players?.find(p => p.side === state.my_side);
  const myTeamId = myPlayer?.team_id;

  const userTeam = useMemo(() => buildUserTeam(state), [state]);

  // standings : shape attendue par StandingsPage (array d'objets avec id, abbr, wins, losses…)
  const standings = useMemo(() => buildStandings(state), [state]);

  // schedule : shape attendue par SchedulePage (array avec team1, team2, week, played, id…)
  const schedule = useMemo(() => buildSchedule(state, myTeamId), [state, myTeamId]);

  // teams : liste minimale pour les abbr dans SchedulePage
  const teams = useMemo(() => buildTeamsList(state), [state]);

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

  // Navigation MP : sous-ensemble du menu solo (pas de négociations, playoffs, scouting, tactiques, historique, inbox)
  const MP_PAGES = ["dashboard", "roster", "standings", "schedule", "training", "chat"];

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
          loading={loading}
          onReady={() => post("/ready", { token })}
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

        {/* Draft active — s'affiche au-dessus du contenu quelle que soit la page */}
        {state.active_draft && (
          <MpDraftBanner
            draft={state.active_draft}
            myTeamId={myTeamId}
            sessionId={sessionId}
            token={token}
            post={post}
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
            onPlayMatch={null}
            onPlayPlayoffMatch={null}
            onSeasonStart={null}
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

        {currentPage === "chat" && (
          <MpChat
            sessionId={sessionId}
            token={token}
            me={myPlayer}
            players={state.players}
          />
        )}
      </div>
    </>
  );
}

// ── Navigation MP ──────────────────────────────────────────────────────────────
// Même sidebar que le solo mais limitée aux pages disponibles en multi + bouton quitter

import {
  ChartBar, Users, Trophy, Calendar, Target, ChatsCircle,
  ArrowsClockwise,
} from "@phosphor-icons/react";

const MP_NAV_ITEMS = [
  { id: "dashboard",  label: "Dashboard",      icon: ChartBar },
  { id: "roster",     label: "Effectif",        icon: Users },
  { id: "standings",  label: "Classement",      icon: Trophy },
  { id: "schedule",   label: "Calendrier",      icon: Calendar },
  { id: "training",   label: "Entraînement",    icon: Target },
  { id: "chat",       label: "Chat",            icon: ChatsCircle },
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
function MpStatusBar({ state, connected, loading, onReady, me }) {
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

      {/* Semaine + bouton prêt */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--text-2)" }}>Semaine {state.week}</span>
        {state.phase === "regular" && !me?.ready && (
          <button
            className="btn-primary"
            style={{ padding: "6px 14px", fontSize: 13 }}
            onClick={onReady}
            disabled={loading}
          >
            {loading ? "…" : "Prêt"}
          </button>
        )}
        {me?.ready && (
          <span style={{ color: "var(--success)", fontSize: 13 }}>En attente des autres…</span>
        )}
      </div>
    </div>
  );
}

// ── Bannière draft active ──────────────────────────────────────────────────────
function MpDraftBanner({ draft, myTeamId, sessionId, token, post }) {
  const [champion, setChampion] = useState("");
  const [draftError, setDraftError] = useState(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const inputRef = useRef(null);

  let draftState = {};
  try {
    draftState = typeof draft.draft_json === "string"
      ? JSON.parse(draft.draft_json)
      : (draft.draft_json || {});
  } catch {
    draftState = {};
  }

  const seq = draftState.sequence || [];
  const step = draftState.step || 0;
  const currentAction = step < seq.length ? seq[step] : null;

  let myDraftSide = null;
  if (draft.team1 === myTeamId) myDraftSide = 1;
  else if (draft.team2 === myTeamId) myDraftSide = 2;

  const isMyTurn = currentAction && Number(currentAction[1]) === myDraftSide;

  const handleAction = async () => {
    if (!champion.trim()) return;
    setDraftError(null);
    setDraftLoading(true);
    try {
      await post("/draft/action", { token, match_id: draft.id, champion: champion.trim() });
      setChampion("");
    } catch (e) {
      setDraftError(e?.response?.data?.detail || "Erreur");
    } finally {
      setDraftLoading(false);
    }
  };

  useEffect(() => {
    if (isMyTurn) inputRef.current?.focus();
  }, [isMyTurn, step]);

  const bans1  = draftState.bans?.[1]  || draftState.bans?.["1"]  || [];
  const bans2  = draftState.bans?.[2]  || draftState.bans?.["2"]  || [];
  const picks1 = draftState.picks?.[1] || draftState.picks?.["1"] || [];
  const picks2 = draftState.picks?.[2] || draftState.picks?.["2"] || [];

  return (
    <div style={{
      margin: "12px 20px",
      padding: "16px 20px",
      background: "var(--surface-1)",
      border: `1px solid ${isMyTurn ? "#8b5cf6" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      boxShadow: isMyTurn ? "0 0 20px rgba(139,92,246,0.15)" : "none",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <TeamLogo teamId={draft.team1} abbr={draft.team1?.toUpperCase()} size={28} />
          <span style={{ fontWeight: 700, color: myDraftSide === 1 ? "#a78bfa" : "var(--text-1)" }}>
            {draft.team1?.toUpperCase()}{myDraftSide === 1 ? " (vous)" : ""}
          </span>
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>vs</span>
          <TeamLogo teamId={draft.team2} abbr={draft.team2?.toUpperCase()} size={28} />
          <span style={{ fontWeight: 700, color: myDraftSide === 2 ? "#a78bfa" : "var(--text-1)" }}>
            {draft.team2?.toUpperCase()}{myDraftSide === 2 ? " (vous)" : ""}
          </span>
        </div>
        <div style={{
          padding: "5px 14px",
          borderRadius: "var(--radius-xs)",
          background: isMyTurn ? "rgba(139,92,246,0.2)" : "var(--surface-2)",
          color: isMyTurn ? "#a78bfa" : "var(--text-2)",
          fontWeight: 700, fontSize: 13,
          border: `1px solid ${isMyTurn ? "#8b5cf6" : "var(--border)"}`,
        }}>
          {currentAction
            ? (isMyTurn
                ? `Votre tour — ${currentAction[0] === "ban" ? "BAN" : "PICK"} (étape ${step + 1}/${seq.length})`
                : `Tour adversaire — ${currentAction[0] === "ban" ? "BAN" : "PICK"}`)
            : draftState.completed ? "Draft terminée" : "Initialisation…"
          }
        </div>
      </div>

      {/* Bans + picks */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
        <DraftSide
          label={draft.team1?.toUpperCase()}
          isMe={myDraftSide === 1}
          bans={bans1}
          picks={picks1}
        />
        <DraftSide
          label={draft.team2?.toUpperCase()}
          isMe={myDraftSide === 2}
          bans={bans2}
          picks={picks2}
        />
      </div>

      {/* Input action */}
      {isMyTurn && !draftState.completed && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            ref={inputRef}
            value={champion}
            onChange={e => setChampion(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !draftLoading && handleAction()}
            placeholder={`Champion à ${currentAction?.[0] === "ban" ? "bannir" : "choisir"}…`}
            style={{
              flex: 1,
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-xs)",
              color: "var(--text-1)",
              padding: "9px 12px", fontSize: 14, outline: "none",
            }}
          />
          <button
            className="btn-primary"
            style={{ padding: "9px 20px", background: "#8b5cf6" }}
            onClick={handleAction}
            disabled={draftLoading || !champion.trim()}
          >
            {currentAction?.[0] === "ban" ? "Bannir" : "Choisir"}
          </button>
        </div>
      )}
      {!isMyTurn && myDraftSide && !draftState.completed && (
        <div style={{ color: "var(--text-2)", fontSize: 13 }}>En attente de l&apos;adversaire…</div>
      )}
      {!myDraftSide && (
        <div style={{ color: "var(--text-2)", fontSize: 13 }}>
          Draft spectateur — {draft.team1?.toUpperCase()} vs {draft.team2?.toUpperCase()}
        </div>
      )}
      {draftError && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{draftError}</div>
      )}
    </div>
  );
}

function DraftSide({ label, isMe, bans, picks }) {
  return (
    <div style={{
      background: "var(--surface-2)",
      borderRadius: "var(--radius-xs)",
      padding: "12px 14px",
      border: isMe ? "1px solid rgba(139,92,246,0.3)" : "1px solid var(--border)",
    }}>
      <div style={{
        fontWeight: 700, fontSize: 13, marginBottom: 10,
        color: isMe ? "#a78bfa" : "var(--text-1)",
      }}>
        {label}{isMe ? " (vous)" : ""}
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Bans</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {bans.length > 0
            ? bans.map((c, i) => (
                <span key={i} style={{
                  padding: "2px 8px", borderRadius: 2,
                  background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
                  color: "var(--danger)", fontSize: 12,
                }}>{c}</span>
              ))
            : <span style={{ color: "var(--text-2)", fontSize: 12 }}>—</span>
          }
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Picks</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {picks.length > 0
            ? picks.map((c, i) => (
                <span key={i} style={{
                  padding: "2px 8px", borderRadius: 2,
                  background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.4)",
                  color: "var(--success)", fontSize: 12,
                }}>{c}</span>
              ))
            : <span style={{ color: "var(--text-2)", fontSize: 12 }}>—</span>
          }
        </div>
      </div>
    </div>
  );
}

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

// ── Chat ──────────────────────────────────────────────────────────────────────
function MpChat({ sessionId, token, me, players }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const wsRef = useRef(null);

  // Connexion WS dédié au chat (ou polling events)
  useEffect(() => {
    // Polling simple des events de type "chat"
    let alive = true;
    const poll = async () => {
      try {
        const res = await axios.get(`${API}/mp/${sessionId}/events`, { params: { token, type: "chat" } });
        if (alive && res.data?.events) {
          setMessages(res.data.events.map(e => ({
            username: e.data?.username || "?",
            text: e.data?.text || "",
            ts: e.created_at,
          })));
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(interval); };
  }, [sessionId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    try {
      await axios.post(`${API}/mp/${sessionId}/chat`, { token, text: input.trim() });
      setInput("");
    } catch {}
    setLoading(false);
  };

  return (
    <div className="animate-slide-up" style={{ padding: 20, display: "flex", flexDirection: "column", height: "calc(100vh - 120px)" }}>
      <h2 className="font-heading" style={{ fontSize: 24, marginBottom: 16 }}>Chat</h2>

      <div style={{
        flex: 1, overflowY: "auto",
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 16,
        display: "flex", flexDirection: "column", gap: 10,
        marginBottom: 12,
      }}>
        {messages.length === 0 && (
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>Aucun message — dites bonjour !</span>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <span style={{
              color: m.username === me?.username ? "#a78bfa" : "var(--accent)",
              fontWeight: 700, fontSize: 13, minWidth: 80,
            }}>
              {m.username}
            </span>
            <span style={{ color: "var(--text-1)", fontSize: 13 }}>{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Votre message…"
          style={{
            flex: 1,
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-xs)",
            color: "var(--text-1)",
            padding: "10px 14px", fontSize: 14, outline: "none",
          }}
        />
        <button className="btn-primary" onClick={send} disabled={loading || !input.trim()}>
          Envoyer
        </button>
      </div>
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
