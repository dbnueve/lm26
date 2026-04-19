import React, { useState, useEffect, useRef, useCallback } from "react";
import { API } from "../shared";
import axios from "axios";

/**
 * MultiplayerGame — main screen once a session is running.
 * Handles phases: waiting → team_pick → regular → draft → match → finished
 *
 * Props:
 *   sessionId  string
 *   token      string
 *   mySide     number (1 or 2)
 *   onExit()   go back to main menu
 */
export default function MultiplayerGame({ sessionId, token, mySide, onExit }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState([]);
  const pollingRef = useRef(null);

  // ── Polling ────────────────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    try {
      const res = await axios.get(
        `${API}/multiplayer/${sessionId}/state`,
        { params: { token } }
      );
      setSession(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur de connexion");
    }
  }, [sessionId, token]);

  useEffect(() => {
    fetchSession();
    pollingRef.current = setInterval(fetchSession, 2500);
    return () => clearInterval(pollingRef.current);
  }, [fetchSession]);

  // Load teams list for the session league
  useEffect(() => {
    if (!session?.league) return;
    axios.get(API + "/teams")
      .then(res => {
        const leagueTeams = res.data.filter(t => t.league === session.league);
        setTeams(leagueTeams);
      })
      .catch(() => {});
  }, [session?.league]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handlePickTeam = async (teamId) => {
    setLoading(true);
    try {
      await axios.post(`${API}/multiplayer/${sessionId}/team`, {
        token, team_id: teamId,
      });
      await fetchSession();
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur sélection équipe");
    } finally {
      setLoading(false);
    }
  };

  const handleReady = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/multiplayer/${sessionId}/ready`, { token });
      await fetchSession();
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const handleDraftAction = async (champion) => {
    setLoading(true);
    try {
      await axios.post(`${API}/multiplayer/${sessionId}/draft/action`, {
        token, champion,
      });
      await fetchSession();
    } catch (e) {
      setError(e?.response?.data?.detail || "Action invalide");
    } finally {
      setLoading(false);
    }
  };

  const handleSimulate = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/multiplayer/${sessionId}/simulate`, { token });
      await fetchSession();
      return res.data;
    } catch (e) {
      setError(e?.response?.data?.detail || "Erreur simulation");
    } finally {
      setLoading(false);
    }
  };

  // ── Render guards ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={styles.overlay}>
        <div style={styles.center}>
          {error
            ? <div style={styles.error}>{error}</div>
            : <div style={styles.spinner}>Chargement…</div>}
        </div>
      </div>
    );
  }

  const myPlayer = Object.values(session.players).find(p => p.side === mySide);
  const oppPlayer = Object.values(session.players).find(p => p.side !== mySide);
  const myTeamId = myPlayer?.team;
  const oppTeamId = oppPlayer?.team;

  // ── Phase: team_pick ───────────────────────────────────────────────────────
  if (session.phase === "team_pick") {
    const takenTeams = Object.values(session.players)
      .filter(p => p.team)
      .map(p => p.team);

    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <h2 style={styles.title}>Choisissez votre équipe — {session.league}</h2>
          <p style={styles.sub}>
            {myTeamId
              ? `Vous avez choisi : ${myTeamId.toUpperCase()}. En attente de l'adversaire…`
              : "Sélectionnez votre équipe"
            }
          </p>
          {!myTeamId && (
            <div style={styles.teamGrid}>
              {teams.map(t => {
                const taken = takenTeams.includes(t.id);
                return (
                  <button
                    key={t.id}
                    style={taken ? styles.teamBtnDisabled : styles.teamBtn}
                    onClick={() => !taken && handlePickTeam(t.id)}
                    disabled={taken || loading}
                  >
                    <span style={styles.teamName}>{t.name || t.id.toUpperCase()}</span>
                    {taken && <span style={styles.takenBadge}>Pris</span>}
                  </button>
                );
              })}
            </div>
          )}
          {error && <div style={styles.error}>{error}</div>}
          <button style={styles.btnSecondary} onClick={onExit}>Quitter</button>
        </div>
      </div>
    );
  }

  // ── Phase: regular ─────────────────────────────────────────────────────────
  if (session.phase === "regular") {
    const myReady = myPlayer?.ready;
    const oppReady = oppPlayer?.ready;
    const currentWeek = session.week;
    const currentMatch = session.schedule?.find(m => m.week === currentWeek);

    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <h2 style={styles.title}>Semaine {currentWeek}</h2>

          <div style={styles.matchupBar}>
            <TeamBadge teamId={myTeamId} label="Vous" />
            <span style={styles.vs}>VS</span>
            <TeamBadge teamId={oppTeamId} label={oppPlayer?.username || "Adversaire"} />
          </div>

          <StandingsBlock standings={session.standings} myTeam={myTeamId} oppTeam={oppTeamId} />

          <div style={styles.readyRow}>
            <ReadyIndicator label="Vous" ready={myReady} />
            <ReadyIndicator label={oppPlayer?.username || "Adversaire"} ready={oppReady} />
          </div>

          {currentMatch && (
            <p style={styles.hint}>
              Match de la semaine : <strong>{currentMatch.team1.toUpperCase()}</strong>
              {" "}vs{" "}
              <strong>{currentMatch.team2.toUpperCase()}</strong>
            </p>
          )}

          {error && <div style={styles.error}>{error}</div>}

          {!myReady && (
            <button
              style={loading ? styles.btnDisabled : styles.btnPrimary}
              onClick={handleReady}
              disabled={loading}
            >
              Prêt pour la semaine
            </button>
          )}
          {myReady && !oppReady && (
            <p style={styles.hint}>En attente de l&apos;adversaire…</p>
          )}

          <RecentResults results={session.match_results} myTeam={myTeamId} />
          <button style={styles.btnSecondary} onClick={onExit}>Quitter</button>
        </div>
      </div>
    );
  }

  // ── Phase: draft ───────────────────────────────────────────────────────────
  if (session.phase === "draft") {
    return (
      <DraftPhase
        session={session}
        mySide={mySide}
        myTeamId={myTeamId}
        oppTeamId={oppTeamId}
        oppUsername={oppPlayer?.username}
        loading={loading}
        error={error}
        onDraftAction={handleDraftAction}
        onExit={onExit}
      />
    );
  }

  // ── Phase: match ───────────────────────────────────────────────────────────
  if (session.phase === "match") {
    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <h2 style={styles.title}>Draft terminée !</h2>
          <DraftSummary draft={session.draft_state} mySide={mySide} />
          {error && <div style={styles.error}>{error}</div>}
          <button
            style={loading ? styles.btnDisabled : styles.btnPrimary}
            onClick={handleSimulate}
            disabled={loading}
          >
            {loading ? "Simulation…" : "Simuler le match"}
          </button>
          <button style={styles.btnSecondary} onClick={onExit}>Quitter</button>
        </div>
      </div>
    );
  }

  // ── Phase: finished ────────────────────────────────────────────────────────
  if (session.phase === "finished") {
    const myWins = session.standings?.[myTeamId]?.wins ?? 0;
    const myLosses = session.standings?.[myTeamId]?.losses ?? 0;
    const oppWins = session.standings?.[oppTeamId]?.wins ?? 0;
    const won = myWins > oppWins;

    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <h2 style={styles.title}>{won ? "Victoire !" : "Défaite"}</h2>
          <div style={styles.finalScore}>
            <span style={styles.scoreTeam}>{myTeamId?.toUpperCase()}</span>
            <span style={styles.scoreLine}>{myWins} — {oppWins}</span>
            <span style={styles.scoreTeam}>{oppTeamId?.toUpperCase()}</span>
          </div>
          <StandingsBlock standings={session.standings} myTeam={myTeamId} oppTeam={oppTeamId} />
          <RecentResults results={session.match_results} myTeam={myTeamId} />
          <button style={styles.btnPrimary} onClick={onExit}>Retour au menu</button>
        </div>
      </div>
    );
  }

  // ── Phase: waiting (host seul) ─────────────────────────────────────────────
  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h2 style={styles.title}>En attente du joueur 2…</h2>
        <p style={styles.hint}>Code : <strong style={{ color: "#4a90d9" }}>{session.code}</strong></p>
        <button style={styles.btnSecondary} onClick={onExit}>Annuler</button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function DraftPhase({ session, mySide, myTeamId, oppTeamId, oppUsername, loading, error, onDraftAction, onExit }) {
  const [champInput, setChampInput] = useState("");
  const draft = session.draft_state;
  if (!draft) return null;

  const step = draft.step;
  const sequence = draft.sequence || [];
  const currentAction = step < sequence.length ? sequence[step] : null;
  const isMyTurn = currentAction && currentAction[1] === mySide;

  const allBans = [...(draft.bans?.[1] || []), ...(draft.bans?.[2] || [])];
  const allPicks = [...(draft.picks?.[1] || []), ...(draft.picks?.[2] || [])];
  const usedChamps = new Set([...allBans, ...allPicks]);

  const handleSubmit = () => {
    if (!champInput.trim()) return;
    onDraftAction(champInput.trim());
    setChampInput("");
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, width: 580 }}>
        <h2 style={styles.title}>Draft — Semaine {session.week}</h2>

        <div style={styles.matchupBar}>
          <TeamBadge teamId={myTeamId} label="Vous" />
          <span style={styles.vs}>VS</span>
          <TeamBadge teamId={oppTeamId} label={oppUsername || "Adversaire"} />
        </div>

        {currentAction && (
          <div style={{
            ...styles.turnBanner,
            background: isMyTurn ? "rgba(37,99,235,0.2)" : "rgba(80,80,80,0.2)",
            borderColor: isMyTurn ? "#2563eb" : "#555",
          }}>
            {isMyTurn
              ? `Votre tour — ${currentAction[0] === "ban" ? "BAN" : "PICK"}`
              : `Tour adversaire — ${currentAction[0] === "ban" ? "BAN" : "PICK"}`
            }
          </div>
        )}

        <div style={styles.draftColumns}>
          <DraftColumn
            label="Vous"
            bans={draft.bans?.[mySide] || []}
            picks={draft.picks?.[mySide] || []}
          />
          <DraftColumn
            label="Adversaire"
            bans={draft.bans?.[mySide === 1 ? 2 : 1] || []}
            picks={draft.picks?.[mySide === 1 ? 2 : 1] || []}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {isMyTurn && !draft.completed && (
          <div style={styles.inputRow}>
            <input
              style={{ ...styles.input, flex: 1 }}
              value={champInput}
              onChange={e => setChampInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="Nom du champion (ex: Jinx)"
            />
            <button
              style={loading ? styles.btnDisabled : styles.btnPrimary}
              onClick={handleSubmit}
              disabled={loading}
            >
              {currentAction?.[0] === "ban" ? "Bannir" : "Choisir"}
            </button>
          </div>
        )}

        {!isMyTurn && !draft.completed && (
          <p style={styles.hint}>En attente de l&apos;adversaire…</p>
        )}

        <button style={styles.btnSecondary} onClick={onExit}>Quitter</button>
      </div>
    </div>
  );
}

function DraftColumn({ label, bans, picks }) {
  return (
    <div style={styles.draftCol}>
      <div style={styles.draftColTitle}>{label}</div>
      <div style={styles.draftSection}>
        <div style={styles.draftSectionLabel}>Bans</div>
        {bans.length === 0
          ? <span style={styles.draftEmpty}>—</span>
          : bans.map((c, i) => (
              <span key={i} style={styles.banTag}>{c}</span>
            ))
        }
      </div>
      <div style={styles.draftSection}>
        <div style={styles.draftSectionLabel}>Picks</div>
        {picks.length === 0
          ? <span style={styles.draftEmpty}>—</span>
          : picks.map((c, i) => (
              <span key={i} style={styles.pickTag}>{c}</span>
            ))
        }
      </div>
    </div>
  );
}

function DraftSummary({ draft, mySide }) {
  if (!draft) return null;
  const oppSide = mySide === 1 ? 2 : 1;
  return (
    <div style={styles.draftColumns}>
      <DraftColumn label="Votre équipe" bans={draft.bans?.[mySide] || []} picks={draft.picks?.[mySide] || []} />
      <DraftColumn label="Adversaire" bans={draft.bans?.[oppSide] || []} picks={draft.picks?.[oppSide] || []} />
    </div>
  );
}

function TeamBadge({ teamId, label }) {
  return (
    <div style={styles.teamBadge}>
      <div style={styles.teamBadgeId}>{teamId ? teamId.toUpperCase() : "?"}</div>
      <div style={styles.teamBadgeLabel}>{label}</div>
    </div>
  );
}

function ReadyIndicator({ label, ready }) {
  return (
    <div style={styles.readyIndicator}>
      <span style={{ ...styles.readyDot, background: ready ? "#22c55e" : "#555" }} />
      <span style={styles.readyLabel}>{label}: {ready ? "Prêt" : "En attente"}</span>
    </div>
  );
}

function StandingsBlock({ standings, myTeam, oppTeam }) {
  if (!standings || !myTeam || !oppTeam) return null;
  const my = standings[myTeam] || { wins: 0, losses: 0 };
  const opp = standings[oppTeam] || { wins: 0, losses: 0 };
  return (
    <div style={styles.standingsRow}>
      <span style={styles.standingsEntry}>{myTeam?.toUpperCase()} {my.wins}W {my.losses}L</span>
      <span style={styles.standingsSep}>·</span>
      <span style={styles.standingsEntry}>{oppTeam?.toUpperCase()} {opp.wins}W {opp.losses}L</span>
    </div>
  );
}

function RecentResults({ results, myTeam }) {
  if (!results?.length) return null;
  return (
    <div style={styles.resultsBlock}>
      <div style={styles.draftSectionLabel}>Résultats récents</div>
      {results.slice(-5).reverse().map((r, i) => {
        const winnerTeam = r.result?.winner === 1 ? r.team1 : r.team2;
        const iWon = winnerTeam === myTeam;
        return (
          <div key={i} style={styles.resultRow}>
            <span style={{ color: iWon ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
              {iWon ? "V" : "D"}
            </span>
            <span style={styles.resultDesc}>
              {" "}S{r.week} — {r.team1.toUpperCase()} vs {r.team2.toUpperCase()}
              {" "}({r.result?.duration}min)
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.80)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    overflowY: "auto",
  },
  center: { color: "#aaa", fontSize: 18 },
  spinner: { color: "#aaa", fontSize: 18 },
  card: {
    background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: 14,
    padding: "32px 36px", width: 460, display: "flex", flexDirection: "column",
    gap: 16, maxHeight: "90vh", overflowY: "auto",
  },
  title: { color: "#e0e0e0", fontSize: 20, fontWeight: 700, margin: 0, textAlign: "center" },
  sub: { color: "#aaa", textAlign: "center", fontSize: 14, margin: 0 },
  hint: { color: "#888", textAlign: "center", fontSize: 13, margin: 0 },
  error: {
    background: "rgba(220,50,50,0.15)", border: "1px solid #c0392b",
    borderRadius: 6, padding: "8px 12px", color: "#e74c3c", fontSize: 13,
  },
  matchupBar: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
  },
  vs: { color: "#555", fontWeight: 700, fontSize: 18 },
  teamBadge: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  teamBadgeId: {
    background: "#0d1b2e", border: "1px solid #2563eb", borderRadius: 8,
    padding: "8px 16px", color: "#4a90d9", fontWeight: 800, fontSize: 16,
    fontFamily: "monospace",
  },
  teamBadgeLabel: { color: "#888", fontSize: 12 },
  teamGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  teamBtn: {
    background: "#0d1b2e", border: "1px solid #2a4a6a", borderRadius: 8,
    color: "#e0e0e0", padding: "10px 16px", cursor: "pointer", fontSize: 14,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    minWidth: 90,
  },
  teamBtnDisabled: {
    background: "#111", border: "1px solid #222", borderRadius: 8,
    color: "#444", padding: "10px 16px", cursor: "not-allowed", fontSize: 14,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
    minWidth: 90,
  },
  teamName: { fontWeight: 700 },
  takenBadge: { fontSize: 11, color: "#666", background: "#1a1a1a", padding: "2px 6px", borderRadius: 4 },
  readyRow: { display: "flex", justifyContent: "space-around" },
  readyIndicator: { display: "flex", alignItems: "center", gap: 8 },
  readyDot: { width: 12, height: 12, borderRadius: "50%", display: "inline-block" },
  readyLabel: { color: "#ccc", fontSize: 13 },
  standingsRow: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 12, background: "#0d0d1a", borderRadius: 8, padding: "10px 16px",
  },
  standingsEntry: { color: "#ccc", fontSize: 14, fontWeight: 600 },
  standingsSep: { color: "#444" },
  finalScore: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 20, padding: "16px 0",
  },
  scoreTeam: { color: "#4a90d9", fontWeight: 800, fontSize: 18, fontFamily: "monospace" },
  scoreLine: { color: "#e0e0e0", fontSize: 28, fontWeight: 900 },
  turnBanner: {
    textAlign: "center", padding: "10px 0", borderRadius: 8, border: "1px solid",
    color: "#e0e0e0", fontWeight: 700, fontSize: 15,
  },
  draftColumns: { display: "flex", gap: 16 },
  draftCol: {
    flex: 1, background: "#0d0d1a", borderRadius: 8, padding: "12px",
    display: "flex", flexDirection: "column", gap: 10,
  },
  draftColTitle: { color: "#4a90d9", fontWeight: 700, fontSize: 14, textAlign: "center" },
  draftSection: { display: "flex", flexDirection: "column", gap: 4 },
  draftSectionLabel: { color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  draftEmpty: { color: "#444", fontSize: 13 },
  banTag: {
    background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444",
    borderRadius: 4, padding: "2px 8px", color: "#ef4444", fontSize: 12,
    display: "inline-block", marginBottom: 2,
  },
  pickTag: {
    background: "rgba(34,197,94,0.15)", border: "1px solid #22c55e",
    borderRadius: 4, padding: "2px 8px", color: "#22c55e", fontSize: 12,
    display: "inline-block", marginBottom: 2,
  },
  inputRow: { display: "flex", gap: 10, alignItems: "center" },
  input: {
    background: "#0d0d1a", border: "1px solid #444", borderRadius: 6,
    color: "#e0e0e0", padding: "10px 12px", fontSize: 15, outline: "none",
  },
  resultsBlock: { display: "flex", flexDirection: "column", gap: 6 },
  resultRow: { display: "flex", alignItems: "center", gap: 6 },
  resultDesc: { color: "#888", fontSize: 13 },
  btnPrimary: {
    background: "#2563eb", border: "none", borderRadius: 8, color: "#fff",
    padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "pointer",
  },
  btnDisabled: {
    background: "#444", border: "none", borderRadius: 8, color: "#888",
    padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "not-allowed",
  },
  btnSecondary: {
    background: "transparent", border: "1px solid #333", borderRadius: 8,
    color: "#666", padding: "10px 0", fontSize: 14, cursor: "pointer",
  },
};
