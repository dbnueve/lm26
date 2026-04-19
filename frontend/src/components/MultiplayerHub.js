import React, { useState, useCallback } from "react";
import axios from "axios";
import { API } from "../shared";
import { useMultiplayerSocket } from "../hooks/useMultiplayerSocket";

/**
 * MultiplayerHub — interface principale de session multijoueur (v2).
 * Reproduit le mode solo : roster, standings, schedule, draft, résultats.
 *
 * Props:
 *   sessionId  string
 *   token      string
 *   onExit()   retour au menu
 */
export default function MultiplayerHub({ sessionId, token, onExit }) {
  const { state, connected } = useMultiplayerSocket(sessionId, token);
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");

  const post = useCallback(async (path, body = {}) => {
    setError(null);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/mp/${sessionId}${path}`, body);
      return res.data;
    } catch (e) {
      const msg = e?.response?.data?.detail || "Erreur";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const get = useCallback(async (path) => {
    try {
      const res = await axios.get(`${API}/mp/${sessionId}${path}`, { params: { token } });
      return res.data;
    } catch (e) {
      return null;
    }
  }, [sessionId, token]);

  if (!state) {
    return (
      <div style={S.overlay}>
        <div style={S.center}>
          {connected ? "Chargement…" : "Connexion au serveur…"}
        </div>
      </div>
    );
  }

  const me = state.players?.find(p => p.side === state.my_side);
  const others = state.players?.filter(p => p.side !== state.my_side) || [];

  // ── Phase team_pick : sélection d'équipe ───────────────────────────────────
  if (state.phase === "waiting" || state.phase === "team_pick") {
    return (
      <div style={S.overlay}>
        <TeamPickScreen
          state={state}
          token={token}
          sessionId={sessionId}
          onExit={onExit}
        />
      </div>
    );
  }

  // ── Phase finished ─────────────────────────────────────────────────────────
  if (state.phase === "finished") {
    const standings = Object.entries(state.standings || {})
      .sort((a, b) => b[1].wins - a[1].wins);
    const winner = standings[0]?.[0];
    return (
      <div style={S.overlay}>
        <div style={S.centeredCard}>
          <h2 style={{ ...S.cardTitle, textAlign: "center" }}>Split terminé !</h2>
          <div style={{ textAlign: "center", color: "#f59e0b", fontWeight: 700, fontSize: 20 }}>
            {winner?.toUpperCase()} remporte le split !
          </div>
          <StandingsTab standings={state.standings} players={state.players} />
          <button style={S.btnPrimary} onClick={onExit}>Retour au menu</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.overlay}>
      <div style={S.shell}>

        {/* ── Header ── */}
        <div style={S.header}>
          <div style={S.headerLeft}>
            <span style={S.leagueBadge}>{state.league}</span>
            <span style={S.phaseBadge}>{phaseLabel(state.phase)}</span>
            {state.phase === "regular" && (
              <span style={S.weekBadge}>Semaine {state.week}</span>
            )}
          </div>
          <div style={S.headerRight}>
            <span style={{ ...S.dot, background: connected ? "#22c55e" : "#ef4444" }} />
            <span style={S.connLabel}>{connected ? "Connecté" : "Reconnexion…"}</span>
            <button style={S.exitBtn} onClick={onExit}>Quitter</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={S.tabs}>
          {TABS.map(t => (
            <button
              key={t.id}
              style={tab === t.id ? S.tabActive : S.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <div style={S.error}>{error}</div>}

        {/* ── Content ── */}
        <div style={S.content}>
          {tab === "dashboard" && (
            <Dashboard
              state={state}
              me={me}
              others={others}
              loading={loading}
              onReady={() => post("/ready", { token })}
              onDraftAction={(matchId, champion) =>
                post("/draft/action", { token, match_id: matchId, champion })
              }
            />
          )}
          {tab === "roster" && (
            <RosterTab
              sessionId={sessionId}
              token={token}
              get={get}
              post={post}
              loading={loading}
            />
          )}
          {tab === "standings" && (
            <StandingsTab standings={state.standings} players={state.players} />
          )}
          {tab === "schedule" && (
            <ScheduleTab matches={state.schedule} players={state.players} currentWeek={state.week} />
          )}
          {tab === "chat" && (
            <ChatTab
              chat={chat}
              input={chatInput}
              onInput={setChatInput}
              me={me}
            />
          )}
        </div>

        {/* ── Players sidebar ── */}
        <div style={S.sidebar}>
          <div style={S.sidebarTitle}>Joueurs</div>
          {state.players?.map(p => (
            <PlayerRow key={p.token} player={p} isMe={p.side === state.my_side} />
          ))}
        </div>

      </div>
    </div>
  );
}

// ── Phase: waiting / team_pick ─────────────────────────────────────────────────
function TeamPickScreen({ state, token, sessionId, onExit }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
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

  if (myTeam) {
    return (
      <div style={S.centeredCard}>
        <h3 style={S.cardTitle}>Équipe choisie : <strong style={{ color: "#4a90d9" }}>{myTeam.toUpperCase()}</strong></h3>
        <p style={S.hint}>En attente des autres joueurs… ({state.players?.filter(p => p.team_id).length}/{state.players?.length})</p>
        <PlayersList players={state.players} />
        <button style={S.btnSecondary} onClick={onExit}>Quitter</button>
      </div>
    );
  }

  return (
    <div style={S.centeredCard}>
      <h3 style={S.cardTitle}>Choisissez votre équipe — {state.league}</h3>
      {error && <div style={S.error}>{error}</div>}
      <div style={S.teamGrid}>
        {teams.map(t => {
          const isTaken = taken.includes(t.id);
          return (
            <button
              key={t.id}
              style={isTaken ? S.teamBtnDis : S.teamBtn}
              onClick={() => !isTaken && !loading && handlePick(t.id)}
              disabled={isTaken || loading}
            >
              {t.name || t.id.toUpperCase()}
              {isTaken && <span style={S.takenBadge}>Pris</span>}
            </button>
          );
        })}
      </div>
      <button style={S.btnSecondary} onClick={onExit}>Quitter</button>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ state, me, others, loading, onReady, onDraftAction }) {
  const [draftChamp, setDraftChamp] = useState("");
  const [draftError, setDraftError] = useState(null);
  const [draftLoading, setDraftLoading] = useState(false);

  const activeDraft = state.active_draft;
  const myTeam = me?.team_id;

  // Determine my side in the draft (1 = team1, 2 = team2)
  let myDraftSide = null;
  if (activeDraft) {
    if (activeDraft.team1 === myTeam) myDraftSide = 1;
    else if (activeDraft.team2 === myTeam) myDraftSide = 2;
  }

  const handleDraft = async () => {
    if (!draftChamp.trim()) return;
    setDraftError(null);
    setDraftLoading(true);
    try {
      await onDraftAction(activeDraft.id, draftChamp.trim());
      setDraftChamp("");
    } catch (e) {
      setDraftError(e?.response?.data?.detail || "Erreur");
    } finally {
      setDraftLoading(false);
    }
  };

  return (
    <div style={S.dashGrid}>

      {/* Classement rapide */}
      <div style={S.dashCard}>
        <div style={S.dashCardTitle}>Classement</div>
        {Object.entries(state.standings || {})
          .sort((a, b) => b[1].wins - a[1].wins)
          .slice(0, 6)
          .map(([tid, s]) => (
            <div key={tid} style={{ ...S.standingRow, fontWeight: tid === myTeam ? 700 : 400 }}>
              <span style={{ color: tid === myTeam ? "#4a90d9" : "#ccc" }}>
                {tid.toUpperCase()}
              </span>
              <span style={{ color: "#888" }}>{s.wins}W {s.losses}L</span>
            </div>
          ))}
      </div>

      {/* Matchs de la semaine */}
      <div style={S.dashCard}>
        <div style={S.dashCardTitle}>Semaine {state.week}</div>
        {(state.week_matches || []).map((m, i) => (
          <div key={i} style={S.matchRow}>
            <span style={{ color: m.team1 === myTeam ? "#4a90d9" : "#ccc" }}>
              {m.team1?.toUpperCase()}
            </span>
            <span style={{ color: "#555" }}>vs</span>
            <span style={{ color: m.team2 === myTeam ? "#4a90d9" : "#ccc" }}>
              {m.team2?.toUpperCase()}
            </span>
            {m.result_json && <span style={{ color: "#22c55e", fontSize: 11 }}>✓</span>}
            {m.is_human_vs_human && !m.result_json && (
              <span style={{ color: "#f59e0b", fontSize: 11 }}>⚔ Draft</span>
            )}
          </div>
        ))}
      </div>

      {/* Prêt */}
      <div style={S.dashCard}>
        <div style={S.dashCardTitle}>Statut</div>
        {state.players?.map(p => (
          <div key={p.side} style={S.readyRow}>
            <span style={{ ...S.readyDot, background: p.ready ? "#22c55e" : "#555" }} />
            <span style={{ color: p.side === state.my_side ? "#4a90d9" : "#ccc", fontSize: 13 }}>
              {p.username || `Joueur ${p.side}`} {p.team_id ? `(${p.team_id.toUpperCase()})` : ""}
            </span>
          </div>
        ))}
        {state.phase === "regular" && !me?.ready && (
          <button
            style={loading ? S.btnDis : S.btnPrimary}
            onClick={onReady}
            disabled={loading}
          >
            Prêt pour la semaine
          </button>
        )}
        {me?.ready && <p style={S.hint}>En attente des autres…</p>}
      </div>

      {/* Draft active */}
      {activeDraft && (
        <div style={{ ...S.dashCard, gridColumn: "1 / -1" }}>
          <div style={S.dashCardTitle}>
            Draft — {activeDraft.team1?.toUpperCase()} vs {activeDraft.team2?.toUpperCase()}
          </div>
          <DraftPanel
            draft={activeDraft}
            myDraftSide={myDraftSide}
            draftChamp={draftChamp}
            setDraftChamp={setDraftChamp}
            draftError={draftError}
            draftLoading={draftLoading}
            onSubmit={handleDraft}
          />
        </div>
      )}

    </div>
  );
}

function DraftPanel({ draft, myDraftSide, draftChamp, setDraftChamp, draftError, draftLoading, onSubmit }) {
  if (!draft.draft_json) return <p style={S.hint}>Initialisation de la draft…</p>;

  let draftState = {};
  try {
    draftState = typeof draft.draft_json === "string"
      ? JSON.parse(draft.draft_json)
      : draft.draft_json;
  } catch {
    return <p style={S.hint}>Chargement de la draft…</p>;
  }

  const step = draftState.step || 0;
  // sequence peut être stockée comme tableau de tableaux [action, side]
  const seq = draftState.sequence || [];
  const currentAction = step < seq.length ? seq[step] : null;
  // side peut être number ou string selon la sérialisation
  const isMyTurn = currentAction && Number(currentAction[1]) === myDraftSide;

  return (
    <div>
      {currentAction && (
        <div style={{
          ...S.turnBanner,
          background: isMyTurn ? "rgba(37,99,235,0.2)" : "rgba(80,80,80,0.15)",
          borderColor: isMyTurn ? "#2563eb" : "#444",
        }}>
          {isMyTurn
            ? `Votre tour — ${currentAction[0] === "ban" ? "BAN" : "PICK"}`
            : `Tour adversaire — ${currentAction[0] === "ban" ? "BAN" : "PICK"}`}
        </div>
      )}
      <div style={S.draftCols}>
        <DraftCol label={`${draft.team1?.toUpperCase()} (vous)`}
          bans={draftState.bans?.["1"] || []} picks={draftState.picks?.["1"] || []} />
        <DraftCol label={draft.team2?.toUpperCase()}
          bans={draftState.bans?.["2"] || []} picks={draftState.picks?.["2"] || []} />
      </div>
      {draftError && <div style={S.error}>{draftError}</div>}
      {isMyTurn && !draftState.completed && (
        <div style={S.inputRow}>
          <input
            style={{ ...S.input, flex: 1 }}
            value={draftChamp}
            onChange={e => setDraftChamp(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSubmit()}
            placeholder="Nom du champion"
          />
          <button
            style={draftLoading ? S.btnDis : S.btnPrimary}
            onClick={onSubmit}
            disabled={draftLoading}
          >
            {currentAction?.[0] === "ban" ? "Bannir" : "Choisir"}
          </button>
        </div>
      )}
      {!isMyTurn && myDraftSide && !draftState.completed && (
        <p style={S.hint}>En attente de l&apos;adversaire…</p>
      )}
      {!myDraftSide && <p style={S.hint}>Draft en cours entre {draft.team1?.toUpperCase()} et {draft.team2?.toUpperCase()}</p>}
    </div>
  );
}

function DraftCol({ label, bans, picks }) {
  return (
    <div style={S.draftCol}>
      <div style={{ color: "#4a90d9", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "#666", fontSize: 11, marginBottom: 4 }}>BANS</div>
      {bans.length ? bans.map((c, i) => <span key={i} style={S.banTag}>{c}</span>) : <span style={{ color: "#444", fontSize: 12 }}>—</span>}
      <div style={{ color: "#666", fontSize: 11, margin: "8px 0 4px" }}>PICKS</div>
      {picks.length ? picks.map((c, i) => <span key={i} style={S.pickTag}>{c}</span>) : <span style={{ color: "#444", fontSize: 12 }}>—</span>}
    </div>
  );
}

// ── Roster tab ────────────────────────────────────────────────────────────────
function RosterTab({ sessionId, token, get, post, loading }) {
  const [data, setData] = useState(null);

  React.useEffect(() => {
    get("/team").then(setData);
  }, [get]);

  if (!data) return <div style={S.hint}>Chargement du roster…</div>;

  const { team, players } = data;
  const starters = players.filter(p => p.is_starter);
  const bench = players.filter(p => !p.is_starter);

  const handleSwap = async (p1id, p2id) => {
    await post("/roster/swap", { token, player1_id: p1id, player2_id: p2id });
    get("/team").then(setData);
  };

  return (
    <div>
      <div style={S.rosterSection}>
        <div style={S.sectionTitle}>Titulaires</div>
        {starters.map(p => (
          <PlayerCard key={p.id} player={p} bench={bench} onSwap={handleSwap} loading={loading} />
        ))}
      </div>
      <div style={S.rosterSection}>
        <div style={S.sectionTitle}>Remplaçants</div>
        {bench.map(p => (
          <PlayerCard key={p.id} player={p} bench={starters} onSwap={handleSwap} loading={loading} isSwapTarget />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({ player, bench, onSwap, loading, isSwapTarget }) {
  const [showSwap, setShowSwap] = useState(false);
  return (
    <div style={S.playerCard}>
      <div style={S.playerInfo}>
        <span style={S.playerPos}>{player.position}</span>
        <span style={S.playerName}>{player.name}</span>
        <span style={S.playerRating}>{Math.round(player.rating)}</span>
      </div>
      <div style={S.playerStats}>
        <Stat label="Meca" val={player.mechanics} />
        <Stat label="Sens" val={player.game_sense} />
        <Stat label="Form" val={player.moral} />
      </div>
      {!isSwapTarget && (
        <button style={S.swapBtn} onClick={() => setShowSwap(!showSwap)}>
          Swap
        </button>
      )}
      {showSwap && (
        <div style={S.swapMenu}>
          {bench.map(b => (
            <button key={b.id} style={S.swapOption}
              onClick={() => { onSwap(player.id, b.id); setShowSwap(false); }}
              disabled={loading}>
              ↔ {b.position} {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, val }) {
  return (
    <span style={S.stat}>
      <span style={{ color: "#666", fontSize: 10 }}>{label}</span>
      <span style={{ color: "#ccc", fontSize: 12 }}>{Math.round(val)}</span>
    </span>
  );
}

// ── Standings tab ─────────────────────────────────────────────────────────────
function StandingsTab({ standings, players }) {
  const humanTeams = new Set((players || []).map(p => p.team_id).filter(Boolean));
  const sorted = Object.entries(standings || {})
    .sort((a, b) => b[1].wins - a[1].wins || a[1].losses - b[1].losses);

  return (
    <div>
      <div style={S.sectionTitle}>Classement</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>#</th>
            <th style={S.th}>Équipe</th>
            <th style={S.th}>V</th>
            <th style={S.th}>D</th>
            <th style={S.th}>Type</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(([tid, s], i) => (
            <tr key={tid} style={{ background: i % 2 ? "#0d0d1a" : "transparent" }}>
              <td style={S.td}>{i + 1}</td>
              <td style={{ ...S.td, color: humanTeams.has(tid) ? "#4a90d9" : "#ccc", fontWeight: humanTeams.has(tid) ? 700 : 400 }}>
                {tid.toUpperCase()}
              </td>
              <td style={{ ...S.td, color: "#22c55e" }}>{s.wins}</td>
              <td style={{ ...S.td, color: "#ef4444" }}>{s.losses}</td>
              <td style={{ ...S.td, color: "#888", fontSize: 11 }}>
                {humanTeams.has(tid) ? "Humain" : "IA"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Schedule tab ──────────────────────────────────────────────────────────────
function ScheduleTab({ matches, players, currentWeek }) {
  const humanTeams = new Set((players || []).map(p => p.team_id).filter(Boolean));
  const byWeek = {};
  for (const m of (matches || [])) {
    if (!byWeek[m.week]) byWeek[m.week] = [];
    byWeek[m.week].push(m);
  }

  return (
    <div>
      {Object.entries(byWeek).map(([week, wmatches]) => (
        <div key={week} style={{ marginBottom: 16 }}>
          <div style={{ ...S.sectionTitle, color: +week === currentWeek ? "#4a90d9" : "#666" }}>
            Semaine {week} {+week === currentWeek ? "← actuelle" : ""}
          </div>
          {wmatches.map((m, i) => {
            let result = null;
            try { result = m.result_json ? JSON.parse(m.result_json) : null; } catch {}
            const winner = result ? (result.winner === 1 ? m.team1 : m.team2) : null;
            return (
              <div key={i} style={S.scheduleRow}>
                <span style={{ color: humanTeams.has(m.team1) ? "#4a90d9" : "#ccc", minWidth: 60 }}>
                  {m.team1?.toUpperCase()}
                </span>
                <span style={{ color: "#555" }}>vs</span>
                <span style={{ color: humanTeams.has(m.team2) ? "#4a90d9" : "#ccc", minWidth: 60 }}>
                  {m.team2?.toUpperCase()}
                </span>
                {winner && (
                  <span style={{ color: "#22c55e", fontSize: 11 }}>
                    → {winner.toUpperCase()} gagne
                  </span>
                )}
                {m.is_human_vs_human && !result && (
                  <span style={{ color: "#f59e0b", fontSize: 11 }}>⚔ Draft requise</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Chat tab ──────────────────────────────────────────────────────────────────
function ChatTab({ chat, input, onInput, me }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      <div style={S.chatBox}>
        {chat.length === 0 && <span style={S.hint}>Aucun message</span>}
        {chat.map((m, i) => (
          <div key={i} style={S.chatMsg}>
            <span style={{ color: "#4a90d9", fontSize: 12 }}>{m.username}</span>
            <span style={{ color: "#ccc", fontSize: 13 }}>{m.text}</span>
          </div>
        ))}
      </div>
      <div style={S.inputRow}>
        <input style={{ ...S.input, flex: 1 }} value={input} onChange={e => onInput(e.target.value)} placeholder="Message…" />
        <button style={S.btnPrimary} onClick={() => {}}>Envoyer</button>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function PlayerRow({ player, isMe }) {
  return (
    <div style={S.playerRow}>
      <span style={{ ...S.dot, background: player.connected ? "#22c55e" : "#555" }} />
      <span style={{ color: isMe ? "#4a90d9" : "#ccc", fontSize: 13 }}>
        {player.username || `J${player.side}`}
      </span>
      {player.team_id && (
        <span style={{ color: "#666", fontSize: 11 }}>{player.team_id.toUpperCase()}</span>
      )}
    </div>
  );
}

function PlayersList({ players }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {(players || []).map(p => (
        <div key={p.side} style={{ color: "#ccc", fontSize: 13 }}>
          {p.username} {p.team_id ? `→ ${p.team_id.toUpperCase()}` : "(en attente)"}
        </div>
      ))}
    </div>
  );
}

function phaseLabel(phase) {
  return {
    waiting: "Attente",
    team_pick: "Sélection",
    regular: "Saison régulière",
    playoffs: "Playoffs",
    finished: "Terminé",
  }[phase] || phase;
}

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "roster", label: "Roster" },
  { id: "standings", label: "Classement" },
  { id: "schedule", label: "Calendrier" },
  { id: "chat", label: "Chat" },
];

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  overlay: { position: "fixed", inset: 0, background: "#0d0d1a", zIndex: 1000, display: "flex", flexDirection: "column" },
  shell: { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", background: "#111", borderBottom: "1px solid #222" },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  leagueBadge: { background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 6, color: "#4a90d9", padding: "3px 10px", fontWeight: 700, fontSize: 13 },
  phaseBadge: { color: "#888", fontSize: 13 },
  weekBadge: { color: "#f59e0b", fontSize: 13, fontWeight: 700 },
  dot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block" },
  connLabel: { color: "#888", fontSize: 12 },
  exitBtn: { background: "transparent", border: "1px solid #333", borderRadius: 6, color: "#666", padding: "5px 14px", fontSize: 13, cursor: "pointer" },
  tabs: { display: "flex", gap: 0, background: "#111", borderBottom: "1px solid #222" },
  tab: { padding: "10px 20px", background: "transparent", border: "none", color: "#666", cursor: "pointer", fontSize: 14, borderBottom: "2px solid transparent" },
  tabActive: { padding: "10px 20px", background: "transparent", border: "none", color: "#4a90d9", cursor: "pointer", fontSize: 14, borderBottom: "2px solid #4a90d9", fontWeight: 700 },
  content: { flex: 1, overflowY: "auto", padding: 20, marginRight: 200 },
  sidebar: { position: "fixed", right: 0, top: 0, bottom: 0, width: 180, background: "#111", borderLeft: "1px solid #222", padding: "60px 14px 14px", display: "flex", flexDirection: "column", gap: 8 },
  sidebarTitle: { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  error: { background: "rgba(220,50,50,0.15)", border: "1px solid #c0392b", borderRadius: 6, padding: "8px 12px", color: "#e74c3c", fontSize: 13, margin: "8px 20px" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888", fontSize: 18 },
  hint: { color: "#666", fontSize: 13, textAlign: "center" },
  dashGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
  dashCard: { background: "#111", border: "1px solid #222", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 8 },
  dashCardTitle: { color: "#888", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  standingRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" },
  matchRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" },
  readyRow: { display: "flex", alignItems: "center", gap: 8 },
  readyDot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  btnPrimary: { background: "#2563eb", border: "none", borderRadius: 8, color: "#fff", padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  btnDis: { background: "#333", border: "none", borderRadius: 8, color: "#666", padding: "10px 18px", fontSize: 14, cursor: "not-allowed" },
  btnSecondary: { background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#666", padding: "9px 16px", fontSize: 13, cursor: "pointer" },
  turnBanner: { textAlign: "center", padding: "10px", borderRadius: 8, border: "1px solid", color: "#e0e0e0", fontWeight: 700, fontSize: 14, marginBottom: 12 },
  draftCols: { display: "flex", gap: 16, marginBottom: 12 },
  draftCol: { flex: 1, background: "#0d0d1a", borderRadius: 8, padding: 12 },
  banTag: { display: "inline-block", background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: 4, padding: "2px 8px", color: "#ef4444", fontSize: 12, marginRight: 4, marginBottom: 4 },
  pickTag: { display: "inline-block", background: "rgba(34,197,94,0.15)", border: "1px solid #22c55e", borderRadius: 4, padding: "2px 8px", color: "#22c55e", fontSize: 12, marginRight: 4, marginBottom: 4 },
  inputRow: { display: "flex", gap: 10, alignItems: "center" },
  input: { background: "#0d0d1a", border: "1px solid #333", borderRadius: 6, color: "#e0e0e0", padding: "9px 12px", fontSize: 14, outline: "none" },
  rosterSection: { marginBottom: 20 },
  sectionTitle: { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  playerCard: { background: "#111", border: "1px solid #222", borderRadius: 8, padding: "10px 14px", marginBottom: 8 },
  playerInfo: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  playerPos: { background: "#1e3a5f", color: "#4a90d9", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 },
  playerName: { color: "#e0e0e0", fontSize: 14, fontWeight: 600 },
  playerRating: { color: "#f59e0b", fontSize: 13, fontWeight: 700, marginLeft: "auto" },
  playerStats: { display: "flex", gap: 12 },
  stat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  swapBtn: { marginTop: 8, background: "transparent", border: "1px solid #333", borderRadius: 6, color: "#888", padding: "4px 12px", fontSize: 12, cursor: "pointer" },
  swapMenu: { marginTop: 8, display: "flex", flexDirection: "column", gap: 4 },
  swapOption: { background: "#0d0d1a", border: "1px solid #333", borderRadius: 6, color: "#ccc", padding: "6px 10px", fontSize: 12, cursor: "pointer", textAlign: "left" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { color: "#666", fontSize: 11, padding: "6px 10px", textAlign: "left", textTransform: "uppercase", letterSpacing: 1, borderBottom: "1px solid #222" },
  td: { color: "#ccc", fontSize: 13, padding: "8px 10px" },
  scheduleRow: { display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid #1a1a1a", fontSize: 13 },
  centeredCard: { background: "#111", border: "1px solid #222", borderRadius: 12, padding: 32, maxWidth: 560, margin: "40px auto", display: "flex", flexDirection: "column", gap: 16 },
  cardTitle: { color: "#e0e0e0", fontSize: 18, fontWeight: 700, margin: 0 },
  teamGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  teamBtn: { background: "#0d1b2e", border: "1px solid #2a4a6a", borderRadius: 8, color: "#e0e0e0", padding: "10px 16px", cursor: "pointer", fontSize: 14, fontWeight: 600 },
  teamBtnDis: { background: "#111", border: "1px solid #1a1a1a", borderRadius: 8, color: "#333", padding: "10px 16px", cursor: "not-allowed", fontSize: 14 },
  takenBadge: { display: "block", fontSize: 10, color: "#555", marginTop: 2 },
  playerRow: { display: "flex", alignItems: "center", gap: 8 },
  chatBox: { flex: 1, background: "#0d0d1a", borderRadius: 8, padding: 12, minHeight: 300, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" },
  chatMsg: { display: "flex", gap: 8, alignItems: "baseline" },
};
