import React, { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { AnimatePresence } from "framer-motion";
import { API, API_CLIENT, PlayerImagesContext, TeamLogosContext, TeamModalContext, withTimeout, useSession } from "./shared";
import { useMp2Socket } from "./hooks/useMp2Socket";

import TeamLogo from "./components/TeamLogo";
import TeamPicker from "./components/TeamPicker";
import Navigation from "./components/Navigation";
import Dashboard from "./components/Dashboard";
import RosterPage from "./components/RosterPage";
import NegotiationsPage from "./components/NegotiationsPage";
import TrainingPage from "./components/TrainingPage";
import SchedulePage from "./components/SchedulePage";
import StandingsPage from "./components/StandingsPage";
import PlayoffsPage from "./components/PlayoffsPage";
import StatsPage from "./components/StatsPage";
import ScoutingPage from "./components/ScoutingPage";
import HistoryPage from "./components/HistoryPage";
import TacticsPage from "./components/TacticsPage";
import InboxPage from "./components/InboxPage";
import MatchSimulation from "./components/MatchSimulation";
import DraftSystem from "./components/DraftSystem";
import PlayoffSeriesModal from "./components/PlayoffSeriesModal";
import Toast from "./components/Toast";
import InternationalModal from "./components/InternationalModal";
import SplitEndOverlay from "./components/SplitEndOverlay";
import SaveSelectionPage from "./components/SaveSelectionPage";
import TeamDetailModal from "./components/TeamDetailModal";
import ErrorBoundary from "./components/ErrorBoundary";

// Main App Component
function App() {
  const [gameState, setGameState] = useState({
    initialized: false,
    userTeam: null
  });
  const [teams, setTeams] = useState([]);
  const [userTeamData, setUserTeamData] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [playoffBracket, setPlayoffBracket] = useState(null);
  const [standings, setStandings] = useState([]);
  const [champions, setChampions] = useState({});
  const [playerImages, setPlayerImages] = useState({});
  const [teamLogos, setTeamLogos] = useState({});
  const [globalTeamModal, setGlobalTeamModal] = useState(null); // {id, abbr}
  const openTeam = React.useCallback((teamId, abbr) => setGlobalTeamModal({ id: teamId, abbr }), []);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [activeMatch, setActiveMatch] = useState(null);
  const [activePlayoffMatch, setActivePlayoffMatch] = useState(null);
  const [playoffsRefreshKey, setPlayoffsRefreshKey] = useState(0);
  const [showDraft, setShowDraft] = useState(false);
  const [draftCompleted, setDraftCompleted] = useState(false);
  const [draftState, setDraftState] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSaveSelection, setShowSaveSelection] = useState(false);
  const [unreadInbox, setUnreadInbox] = useState(0);
  // Split continuity
  const [splitStatus, setSplitStatus] = useState(null);
  const [showSplitEnd, setShowSplitEnd] = useState(false);
  const [showInternational, setShowInternational] = useState(false);

  // Multiplayer state: now lives in SessionProvider (shared.js). The legacy
  // `multiplayerSession` glue that gated MultiplayerHub has been removed.
  //
  // In MP we also track the full players roster (token-less view from
  // /mp2/{sid}/info) so we can detect PvP matches (both teams taken by humans)
  // and drive the shared "ready to play" gate + auto-draft open across peers.
  const [mp2Players, setMp2Players] = useState([]); // [{username, team_id}]
  // When a PvP match gate fires (both players voted "Prêt"), we auto-open
  // the DraftSystem for each peer. This carries the match metadata across
  // the async WS event → state change → render boundary.
  const [pvpDraftMatch, setPvpDraftMatch] = useState(null);
  // Versus draft state streamed from the server (via `mp_draft_update` WS
  // broadcasts + /mp2/{sid}/draft fetch). Null in solo or before start.
  const [mpDraftState, setMpDraftState] = useState(null);

  const showToast = (message, type = "info") => {
    setToast({ message, type });
  };

  // Fetch lolesports player headshots + team logos once on mount
  useEffect(() => {
    const controller = new AbortController();
    axios.get(API + "/player-images", { signal: controller.signal })
      .then(r => setPlayerImages(r.data))
      .catch(e => { if (!axios.isCancel(e)) console.error("player-images:", e); });
    axios.get(API + "/team-logos", { signal: controller.signal })
      .then(r => setTeamLogos(r.data))
      .catch(e => { if (!axios.isCancel(e)) console.error("team-logos:", e); });
    return () => controller.abort();
  }, []);

  // Defined here (before loadGameData) so loadGameData can call it after a
  // reconnect/poll to hydrate userTeamData from the server-resolved user_team.
  const loadUserTeam = useCallback(async (teamId) => {
    try {
      const response = await API_CLIENT.get("/teams/" + teamId);
      setUserTeamData(response.data);
    } catch (e) {
      console.error("Error loading user team:", e);
    }
  }, []);

  const loadGameData = useCallback(async () => {
    try {
      const [teamsRes, scheduleRes, standingsRes, championsRes, playoffsRes, stateRes] = await withTimeout(
        Promise.all([
          API_CLIENT.get("/teams"),
          API_CLIENT.get("/schedule"),
          API_CLIENT.get("/standings"),
          API_CLIENT.get("/draft/champions"),
          API_CLIENT.get("/playoffs").catch(() => ({ data: null })),
          API_CLIENT.get("/game/state").catch(() => ({ data: {} })),
        ])
      );

      setTeams(teamsRes.data);
      setSchedule(scheduleRes.data);
      setStandings(standingsRes.data);
      setChampions(championsRes.data);
      setPlayoffBracket(playoffsRes.data?.active ? playoffsRes.data : null);
      // Sync user_team from the server. Critical in MP:
      //   - After reconnect, middleware resolves user_team from
      //     session.players[token] → must hydrate so we land on the dashboard.
      //   - After fresh MP create/join (no team yet), server returns null
      //     → must overwrite any leftover userTeam from a previous solo slot,
      //     otherwise we skip TeamPicker and land on a stale team's dashboard.
      // We only authoritatively sync when the server actually returned a
      // user_team field (not when /game/state failed and stateRes.data is {}).
      const stateData = stateRes.data || {};
      const serverHasState = "user_team" in stateData;
      const serverUserTeam = stateData.user_team || null;
      setGameState(prev => {
        const next = { ...prev };
        if (stateData.phase) next.phase = stateData.phase;
        if (serverHasState && serverUserTeam !== prev.userTeam) {
          next.userTeam = serverUserTeam;
        }
        return next;
      });
      if (serverUserTeam) {
        // Fire and forget — userTeamData hydration shouldn't block loadGameData.
        loadUserTeam(serverUserTeam);
      } else if (serverHasState) {
        // Server says no team picked → clear stale data from a previous slot.
        setUserTeamData(null);
      }
      API_CLIENT.get("/inbox").then(r => setUnreadInbox(r.data.unread_total || 0)).catch(() => {});
    } catch (e) {
      console.error("Error loading game data:", e);
    }
  }, [loadUserTeam]);

  // ── MP2 WebSocket wiring ────────────────────────────────────────────────────
  // When a multiplayer session is active, subscribe to its WS and refetch
  // game data on any server-pushed event. This is the simplest possible
  // sync strategy: server is truth, frontend just reacts to "something changed".
  const mp2 = useSession();
  const onMp2Event = useCallback((event, data) => {
    // Fan-out to any listening component (e.g. TeamPicker refreshes its
    // "taken teams" map on peer picks). Skip heartbeat noise.
    if (event !== "ping" && event !== "pong") {
      try {
        window.dispatchEvent(new CustomEvent("mp2:session_event", {
          detail: { event, data },
        }));
      } catch { /* CustomEvent unsupported in very old browsers — ignore */ }
    }
    // Ignore purely informational events; react to anything state-related.
    if (event === "hello" || event === "chat" || event === "ping" || event === "pong") return;
    loadGameData();
  }, [loadGameData]);
  useMp2Socket(mp2.sid, mp2.token, onMp2Event);

  // Keep the roster (players + their team_ids) in sync whenever an MP session
  // is active. Used to drive PvP detection in <MatchSimulation />.
  const refreshMp2Roster = useCallback(async () => {
    if (!mp2.sid) return;
    try {
      const res = await axios.get(`${API}/mp2/${mp2.sid}/info`, {
        params: mp2.token ? { token: mp2.token } : {},
      });
      setMp2Players(res.data?.players || []);
    } catch (e) {
      // Non-fatal: the UI falls back to solo behaviour if roster is missing.
      console.warn("mp2 roster refresh failed:", e);
    }
  }, [mp2.sid, mp2.token]);

  useEffect(() => {
    if (!mp2.sid) { setMp2Players([]); return; }
    refreshMp2Roster();
    const handler = (evt) => {
      const ev = evt?.detail?.event;
      // Roster changes on team_picked / peer_joined / ready_changed / state_changed.
      if (["team_picked", "peer_joined", "ready_changed", "state_changed"].includes(ev)) {
        refreshMp2Roster();
      }
      // When a PvP match gate fires ("match:<id>" trigger), open the draft
      // on every peer simultaneously. We use the schedule to look up the
      // full match record the modal needs.
      if (ev === "state_changed" && typeof evt?.detail?.data?.trigger === "string"
          && evt.detail.data.trigger.startsWith("match:")) {
        const mid = evt.detail.data.trigger.slice("match:".length);
        setSchedule((current) => {
          const m = current.find((x) => x.id === mid);
          if (m) {
            setActiveMatch(m);
            setPvpDraftMatch(m);
            setShowDraft(true);
          }
          return current;
        });
      }
    };
    window.addEventListener("mp2:session_event", handler);
    return () => window.removeEventListener("mp2:session_event", handler);
  }, [mp2.sid, refreshMp2Roster]);

  // When the schedule refreshes (typically after a state_changed broadcast),
  // re-resolve `activeMatch` from the fresh data. Critical for PvP side 2:
  // side 1 posts /match/simulate → backend writes `match_details` → schedule
  // updates → this effect pushes the updated match into MatchSimulation, which
  // flips its phase to "timeline". Without this, side 2 stays stuck on
  // "Draft terminée — en attente…".
  useEffect(() => {
    if (!activeMatch?.id || !schedule?.length) return;
    const fresh = schedule.find(m => m.id === activeMatch.id);
    if (!fresh) return;
    // Shallow identity check on the few fields MatchSimulation reads. Avoids
    // a setState loop when the schedule reference changes but match contents
    // are identical.
    if (
      fresh.match_details === activeMatch.match_details
      && fresh.score1 === activeMatch.score1
      && fresh.score2 === activeMatch.score2
      && fresh.winner === activeMatch.winner
      && fresh.played === activeMatch.played
    ) return;
    setActiveMatch(fresh);
  }, [schedule, activeMatch?.id, activeMatch?.match_details, activeMatch?.score1, activeMatch?.score2, activeMatch?.winner, activeMatch?.played]);

  const loadSplitStatus = useCallback(async (userTeamId) => {
    try {
      const res = await API_CLIENT.get("/split/status");
      setSplitStatus(res.data);
      if (res.data.is_offseason && userTeamId) {
        // Check if international tournament is done before showing split end
        try {
          const intlRes = await API_CLIENT.get("/international");
          if (intlRes.data.completed) {
            setShowSplitEnd(true);
          } else {
            setShowInternational(true);
          }
        } catch {
          // Tournament not started yet — show it
          setShowInternational(true);
        }
      }
    } catch (e) {
      console.error("Error loading split status:", e);
    }
  }, []);

  // In MP, shared progression actions go through /mp2/{sid}/ready and only
  // fire once every player has voted. Returns the inner "result" (or null if
  // still waiting on peers). In solo, just hits the endpoint directly.
  const mpReady = useCallback(async (action) => {
    if (!mp2.sid || !mp2.token) return { fired: true, result: null }; // solo
    const res = await axios.post(`${API}/mp2/${mp2.sid}/ready`, {
      token: mp2.token,
      action,
    });
    return res.data; // { info, fired, result }
  }, [mp2.sid, mp2.token]);

  const handleNextSplit = async () => {
    try {
      let newSplitLabel = null;
      if (mp2.sid) {
        const voted = await mpReady("split/next");
        if (!voted.fired) {
          showToast("En attente des autres joueurs…", "info");
          return;
        }
        newSplitLabel = voted.result?.new_split?.label;
      } else {
        const res = await API_CLIENT.post("/split/next");
        newSplitLabel = res.data?.new_split?.label;
      }
      setShowSplitEnd(false);
      setShowInternational(false);
      setCurrentPage("dashboard");
      // Reload everything
      await loadGameData();
      const newUserTeam = gameState.userTeam;
      if (newUserTeam) await loadUserTeam(newUserTeam);
      await loadSplitStatus(newUserTeam);
      showToast(newSplitLabel ? `Nouveau split : ${newSplitLabel} !` : "Nouveau split !", "success");
    } catch (e) {
      console.error("Error advancing split:", e);
      showToast("Erreur lors du passage au split suivant", "error");
    }
  };

  const handleChangeTeam = () => {
    // Reset team selection — go back to team picker for next split
    setShowSplitEnd(false);
    setGameState(prev => ({ ...prev, userTeam: null }));
  };

  const getSlotStorageKey = (league) => `esports_manager_active_slot_${league || "LEC"}`;

  const loadSlot = async (slot) => {
    const res = await API_CLIENT.post(`/saves/${slot}/load`);
    const league = res.data.league || "LEC";
    localStorage.setItem(getSlotStorageKey(league), slot);
    setGameState({ initialized: res.data.initialized, userTeam: res.data.user_team, league, phase: res.data.phase || "regular" });
    if (res.data.user_team) await loadUserTeam(res.data.user_team);
    await loadGameData();
    await loadSplitStatus(res.data.user_team);
    setShowSaveSelection(false);
  };

  const startNewSlot = async (slot, league = "LEC") => {
    await API_CLIENT.post(`/saves/${slot}/new`, { league });
    localStorage.setItem(getSlotStorageKey(league), slot);
    setGameState({ initialized: true, userTeam: null, league });
    await loadGameData();
    setShowSaveSelection(false);
  };

  const goToSaveSelection = () => {
    // Clear all possible slot keys
    ["LEC", "LCK", "LCS", "CBLOL", "LPL"].forEach(l => {
      localStorage.removeItem(getSlotStorageKey(l));
    });
    setShowSaveSelection(true);
  };

  useEffect(() => {
    const initGame = async () => {
      // Try to find any saved slot from any league
      let foundSlot = null;
      let foundLeague = "LEC";
      ["LEC", "LCK", "LCS", "CBLOL", "LPL"].forEach(l => {
        const slot = localStorage.getItem(getSlotStorageKey(l));
        if (slot && !foundSlot) {
          foundSlot = slot;
          foundLeague = l;
        }
      });
      if (foundSlot) {
        try {
          await loadSlot(parseInt(foundSlot, 10));
          return;
        } catch (e) {
          // Save not found or corrupted — show selection
          localStorage.removeItem(getSlotStorageKey(foundLeague));
        }
      }
      setShowSaveSelection(true);
    };
    initGame();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectTeam = async (team) => {
    setGameState(prev => ({ ...prev, userTeam: team.id }));
    await loadUserTeam(team.id);
    await loadGameData();
  };

  const handlePlayMatch = (match) => {
    setActiveMatch(match);
  };

  const handleSimulateSeason = async () => {
    if (mp2.sid) {
      const voted = await mpReady("season/simulate");
      if (!voted.fired) {
        showToast("En attente des autres joueurs…", "info");
        return;
      }
    } else {
      await API_CLIENT.post("/season/simulate");
    }
    await loadGameData();
    await loadUserTeam(gameState.userTeam);
    await loadSplitStatus(gameState.userTeam);
    showToast("Saison simulée! Les playoffs commencent.", "success");
  };

  const handleMatchComplete = async (playedMatchId) => {
    setActiveMatch(null);
    await loadGameData();
    // Apply optimistic mark AFTER loading from backend — this prevents the
    // match from reappearing if the backend returned stale data (e.g., a
    // silent save_state() failure left the match as unplayed in the file).
    if (playedMatchId) {
      setSchedule(prev => prev.map(m =>
        m.id === playedMatchId ? { ...m, played: true } : m
      ));
    }
    await loadUserTeam(gameState.userTeam);
    await loadSplitStatus(gameState.userTeam);
    showToast("Match terminé!", "success");
  };

  const handleMakeOffer = async (playerId, amount, years, playerToSwapId = null, isCounterOffer = false) => {
    try {
      const response = await API_CLIENT.post("/negotiations/offer", {
        player_id: playerId,
        offered_amount: amount,
        contract_years: years,
        is_counter_offer: isCounterOffer,
        ...(playerToSwapId ? { player_to_swap_id: playerToSwapId } : {}),
      });

      if (response.data.accepted) {
        await loadUserTeam(gameState.userTeam);
        await loadGameData();
        showToast("Transfert réussi!", "success");
      }

      return response.data;
    } catch (e) {
      console.error("Error making offer:", e);
      showToast("Erreur lors de l offre", "error");
      return { accepted: false, message: "Erreur lors de l offre" };
    }
  };

  const handleSwapPlayers = async (player1Id, player2Id) => {
    try {
      await API_CLIENT.post("/roster/swap", {
        player1_id: player1Id,
        player2_id: player2Id
      });
      await loadUserTeam(gameState.userTeam);
      showToast("Joueurs échangés!", "success");
    } catch (e) {
      console.error("Error swapping players:", e);
      showToast("Erreur lors du swap", "error");
    }
  };

  const handleApplyTraining = async (playerId, trainingType) => {
    try {
      const res = await API_CLIENT.post("/training/apply", {
        player_id: playerId,
        training_type: trainingType
      });
      await loadUserTeam(gameState.userTeam);
      showToast("Entraînement appliqué!", "success");
      return res.data;
    } catch (e) {
      const msg = e?.response?.data?.detail || "Erreur lors de l'entraînement";
      showToast(msg, "error");
      throw e;
    }
  };

  const handleSetTrainingPlan = async (playerId, trainingType) => {
    const res = await API_CLIENT.post("/training/set-plan", {
      player_id: playerId,
      training_type: trainingType
    });
    await loadUserTeam(gameState.userTeam);
    return res.data;
  };

  const handleSetTeamTrainingPlan = async (trainingType) => {
    const res = await API_CLIENT.post("/training/set-team-plan", {
      training_type: trainingType
    });
    await loadUserTeam(gameState.userTeam);
    return res.data;
  };

  const handleSeasonStart = async () => {
    let aiTransfers = null;
    if (mp2.sid) {
      const voted = await mpReady("season/start");
      if (!voted.fired) {
        showToast("En attente des autres joueurs…", "info");
        return { fired: false, pending: true, ai_transfers: null };
      }
      aiTransfers = voted.result?.ai_transfers || [];
    } else {
      const res = await API_CLIENT.post("/season/start");
      aiTransfers = res.data?.ai_transfers || [];
    }
    setGameState(prev => ({ ...prev, phase: "regular" }));
    await loadGameData();
    if (gameState.userTeam) await loadUserTeam(gameState.userTeam);
    return { fired: true, pending: false, ai_transfers: aiTransfers };
  };

  const handleDraftComplete = (completedDraft) => {
    setShowDraft(false);
    setDraftCompleted(true);
    // MP versus-draft payload carries bans/picks keyed by side (1/2) with
    // a _mySide hint. Normalise to the solo shape (user_* / enemy_*) so the
    // rest of the pipeline (MatchSimulation → /match/simulate user_draft)
    // is unchanged.
    let normalised = completedDraft;
    if (completedDraft && (completedDraft.bans || completedDraft.picks)) {
      const mySide = completedDraft._mySide ?? 1;
      const oppSide = mySide === 1 ? 2 : 1;
      const ms = String(mySide);
      const os = String(oppSide);
      normalised = {
        ...completedDraft,
        user_bans:    completedDraft.bans?.[ms]  || completedDraft.bans?.[mySide]  || [],
        enemy_bans:   completedDraft.bans?.[os]  || completedDraft.bans?.[oppSide] || [],
        user_picks:  (completedDraft.picks?.[ms] || completedDraft.picks?.[mySide] || []),
        enemy_picks: (completedDraft.picks?.[os] || completedDraft.picks?.[oppSide] || []),
      };
    }
    setDraftState(normalised);
    setPvpDraftMatch(null);
    setMpDraftState(null);
    showToast("Draft terminée! Prêt à lancer le match!", "success");
  };

  // ── MP2 versus draft helpers ────────────────────────────────────────────────
  // Determine whether the currently active match is a PvP (both teams owned by
  // different humans in this session). Used to flip DraftSystem into MP mode.
  const isPvpMatch = React.useMemo(() => {
    if (!mp2.sid || !activeMatch) return false;
    const t1 = mp2Players.find(p => p.team_id === activeMatch.team1);
    const t2 = mp2Players.find(p => p.team_id === activeMatch.team2);
    return Boolean(t1 && t2 && t1.username !== t2.username);
  }, [mp2.sid, activeMatch, mp2Players]);

  // My side in the versus draft (1=blue/team1, 2=red/team2). Derived from the
  // streamed mpDraftState so it stays in sync across reconnects.
  const mpMySide = mpDraftState?._mySide ?? null;
  const mpMyTurn = Boolean(mpDraftState && !mpDraftState.completed
    && mpDraftState.current_side === mpMySide);
  const mpLabel = React.useMemo(() => {
    if (!mpDraftState) return null;
    if (mpDraftState.completed) return "Draft terminée";
    const kind = mpDraftState.current_action === "ban" ? "Ban" : "Pick";
    return mpMyTurn ? `À toi — ${kind}` : `Tour adverse — ${kind}`;
  }, [mpDraftState, mpMyTurn]);

  // Fetch the versus draft state (used on mount + on WS updates).
  const fetchMpDraft = useCallback(async () => {
    if (!mp2.sid || !mp2.token) return;
    try {
      const res = await axios.get(`${API}/mp2/${mp2.sid}/draft`, {
        params: { token: mp2.token },
      });
      setMpDraftState(res.data || null);
    } catch (e) {
      console.warn("mp2 draft fetch failed:", e);
    }
  }, [mp2.sid, mp2.token]);

  // Kick off the shared draft for a PvP match (either player can start it).
  const startMpDraft = useCallback(async (matchId) => {
    if (!mp2.sid || !mp2.token) return;
    try {
      const res = await axios.post(`${API}/mp2/${mp2.sid}/draft/start`, {
        token: mp2.token, match_id: matchId,
      });
      setMpDraftState(res.data || null);
    } catch (e) {
      // Most likely: draft already started by peer. Fall back to fetch.
      fetchMpDraft();
    }
  }, [mp2.sid, mp2.token, fetchMpDraft]);

  // Called by <DraftSystem> in MP mode. Posts the action; state arrives via WS.
  const onMpDraftAction = useCallback(async (champion, action) => {
    if (!mp2.sid || !mp2.token) return;
    try {
      const res = await axios.post(`${API}/mp2/${mp2.sid}/draft/action`, {
        token: mp2.token, action, champion,
      });
      setMpDraftState(res.data || null);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Action draft refusée";
      showToast(msg, "error");
    }
  }, [mp2.sid, mp2.token]);

  // When a PvP draft opens, start/fetch the versus draft state and keep it
  // in sync with WS `mp_draft_update` broadcasts.
  useEffect(() => {
    if (!showDraft || !isPvpMatch || !pvpDraftMatch) return;
    startMpDraft(pvpDraftMatch.id);
    const handler = (evt) => {
      const ev = evt?.detail?.event;
      if (ev === "mp_draft_update") fetchMpDraft();
    };
    window.addEventListener("mp2:session_event", handler);
    return () => window.removeEventListener("mp2:session_event", handler);
  }, [showDraft, isPvpMatch, pvpDraftMatch, startMpDraft, fetchMpDraft]);

  if (showSaveSelection) {
    return (
      <TeamModalContext.Provider value={{ openTeam }}>
      <TeamLogosContext.Provider value={teamLogos}>
      <PlayerImagesContext.Provider value={playerImages}>
      <div className="hex-bg">
        <SaveSelectionPage
          onLoad={loadSlot}
          onNew={startNewSlot}
          onEnterSession={async () => {
            setShowSaveSelection(false);
            await loadGameData();
          }}
        />
      </div>
      </PlayerImagesContext.Provider>
      </TeamLogosContext.Provider>
      </TeamModalContext.Provider>
    );
  }

  if (!gameState.userTeam) {
    return (
      <TeamModalContext.Provider value={{ openTeam }}>
      <TeamLogosContext.Provider value={teamLogos}>
      <PlayerImagesContext.Provider value={playerImages}>
      <div className="hex-bg">
        <TeamPicker teams={teams} onSelectTeam={handleSelectTeam} league={gameState.league || "LEC"} />
      </div>
      </PlayerImagesContext.Provider>
      </TeamLogosContext.Provider>
      </TeamModalContext.Provider>
    );
  }

  return (
    <TeamModalContext.Provider value={{ openTeam }}>
    <TeamLogosContext.Provider value={teamLogos}>
    <PlayerImagesContext.Provider value={playerImages}>
    <div className="app-container">
      <Navigation
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        userTeam={userTeamData}
        onChangeSave={goToSaveSelection}
        unreadInbox={unreadInbox}
      />

      <main className="main-content app-with-sidebar">
        <ErrorBoundary label="Erreur dans la page">
        {currentPage === "dashboard" && userTeamData && (
          <Dashboard
            userTeam={userTeamData}
            schedule={schedule}
            standings={standings}
            splitStatus={splitStatus}
            phase={gameState.phase}
            playoffsData={playoffBracket}
            onPlayMatch={handlePlayMatch}
            onPlayPlayoffMatch={(m) => setActivePlayoffMatch(m)}
            onSeasonStart={handleSeasonStart}
          />
        )}

        {currentPage === "roster" && userTeamData && (
          <RosterPage
            userTeam={userTeamData}
            onSwapPlayers={handleSwapPlayers}
          />
        )}

        {currentPage === "negotiations" && userTeamData && (
          <NegotiationsPage
            userTeam={userTeamData}
            teams={teams}
            phase={gameState.phase}
            onMakeOffer={handleMakeOffer}
            onSeasonStart={async () => {
              await loadGameData();
              if (gameState.userTeam) await loadUserTeam(gameState.userTeam);
            }}
            onPendingResolved={async () => {
              if (gameState.userTeam) await loadUserTeam(gameState.userTeam);
              await loadGameData();
              API_CLIENT.get("/inbox").then(r => setUnreadInbox(r.data.unread_total || 0)).catch(() => {});
            }}
          />
        )}

        {currentPage === "training" && userTeamData && (
          <TrainingPage
            userTeam={userTeamData}
            onSetTeamTrainingPlan={handleSetTeamTrainingPlan}
          />
        )}

        {currentPage === "schedule" && userTeamData && (
          <SchedulePage
            schedule={schedule}
            teams={teams}
            userTeam={userTeamData}
            onSimulateSeason={handleSimulateSeason}
          />
        )}

        {currentPage === "standings" && userTeamData && (
          <StandingsPage
            standings={standings}
            userTeam={userTeamData}
          />
        )}

        {currentPage === "playoffs" && userTeamData && (
          <PlayoffsPage
            key={playoffsRefreshKey}
            userTeam={userTeamData}
            showToast={showToast}
            onSplitEnd={() => loadSplitStatus(gameState.userTeam)}
            onPlayPlayoffMatch={(m) => setActivePlayoffMatch(m)}
            onSimulateSeason={handleSimulateSeason}
            league={gameState.league || "LEC"}
          />
        )}

        {currentPage === "tactics" && userTeamData && (
          <TacticsPage
            userTeam={userTeamData}
            players={null}
            teams={teams}
            nextMatch={
              schedule.find(m => !m.played && (m.team1 === userTeamData.id || m.team2 === userTeamData.id)) ||
              (playoffBracket?.matches || []).find(m => !m.played && (m.team1 === userTeamData.id || m.team2 === userTeamData.id)) ||
              null
            }
          />
        )}

        {currentPage === "stats" && <StatsPage />}

        {currentPage === "history" && <HistoryPage userTeam={userTeamData} showToast={showToast} />}

        {currentPage === "scouting" && userTeamData && (
          <ScoutingPage
            userTeam={userTeamData}
            onSignPlayer={async () => {
              await loadUserTeam(gameState.userTeam);
              await loadGameData();
              showToast("Joueur recruté!", "success");
            }}
          />
        )}

        {currentPage === "inbox" && (
          <InboxPage onUnreadChange={setUnreadInbox} />
        )}
        </ErrorBoundary>
      </main>

      <ErrorBoundary label="Erreur dans la simulation">
      <AnimatePresence>
        {activeMatch && !showDraft && (
          <MatchSimulation
            match={activeMatch}
            userTeam={userTeamData}
            teams={teams}
            onClose={() => {
              handleMatchComplete(activeMatch?.id);
              setDraftCompleted(false);
              setDraftState(null);
            }}
            onStartDraft={() => setShowDraft(true)}
            draftCompleted={draftCompleted}
            draftState={draftState}
            mpActive={!!mp2.sid}
            mpPlayers={mp2Players}
            mpReady={mpReady}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDraft && (
          isPvpMatch ? (
            <DraftSystem
              champions={champions}
              onComplete={handleDraftComplete}
              onCancel={() => setShowDraft(false)}
              onMpAction={onMpDraftAction}
              mpDraftState={mpDraftState}
              mpMyTurn={mpMyTurn}
              mpLabel={mpLabel}
              mpSessionId={mp2.sid}
              mpMatchId={pvpDraftMatch?.id}
              mpToken={mp2.token}
            />
          ) : (
            <DraftSystem
              champions={champions}
              onComplete={handleDraftComplete}
              onCancel={() => setShowDraft(false)}
            />
          )
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activePlayoffMatch && (
          <PlayoffSeriesModal
            match={activePlayoffMatch}
            userTeam={userTeamData}
            teams={teams}
            champions={champions}
            showToast={showToast}
            onClose={async () => {
              setActivePlayoffMatch(null);
              setPlayoffsRefreshKey(k => k + 1);
              await loadGameData();
              await loadUserTeam(gameState.userTeam);
              await loadSplitStatus(gameState.userTeam);
            }}
            onSplitEnd={async () => {
              setActivePlayoffMatch(null);
              await loadSplitStatus(gameState.userTeam);
            }}
          />
        )}
      </AnimatePresence>

      {/* International Tournament — shown after playoffs, before split end */}
      <AnimatePresence>
        {showInternational && !activePlayoffMatch && (
          <InternationalModal
            userTeam={userTeamData}
            champions={champions}
            onComplete={() => {
              setShowInternational(false);
              setShowSplitEnd(true);
            }}
          />
        )}
      </AnimatePresence>

      </ErrorBoundary>

      {/* Split End Overlay — shown when playoffs finish */}
      <AnimatePresence>
        {showSplitEnd && splitStatus && (
          <SplitEndOverlay
            splitStatus={splitStatus}
            userTeam={userTeamData}
            onNextSplit={handleNextSplit}
            onChangeTeam={handleChangeTeam}
          />
        )}
      </AnimatePresence>
      {/* Global team detail modal — triggered by any TeamLogo click */}
      <AnimatePresence>
        {globalTeamModal && (
          <TeamDetailModal team={globalTeamModal} onClose={() => setGlobalTeamModal(null)} />
        )}
      </AnimatePresence>
    </div>
    </PlayerImagesContext.Provider>
    </TeamLogosContext.Provider>
    </TeamModalContext.Provider>
  );
}

export default App;
