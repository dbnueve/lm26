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
      if (stateRes.data?.phase) {
        setGameState(prev => ({ ...prev, phase: stateRes.data.phase }));
      }
      API_CLIENT.get("/inbox").then(r => setUnreadInbox(r.data.unread_total || 0)).catch(() => {});
    } catch (e) {
      console.error("Error loading game data:", e);
    }
  }, []);

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

  const loadUserTeam = useCallback(async (teamId) => {
    try {
      const response = await API_CLIENT.get("/teams/" + teamId);
      setUserTeamData(response.data);
    } catch (e) {
      console.error("Error loading user team:", e);
    }
  }, []);

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

  const handleSeasonStart = async () => {
    if (mp2.sid) {
      const voted = await mpReady("season/start");
      if (!voted.fired) {
        showToast("En attente des autres joueurs…", "info");
        return;
      }
    } else {
      await API_CLIENT.post("/season/start");
    }
    setGameState(prev => ({ ...prev, phase: "regular" }));
    await loadGameData();
    if (gameState.userTeam) await loadUserTeam(gameState.userTeam);
  };

  const handleDraftComplete = (completedDraft) => {
    setShowDraft(false);
    setDraftCompleted(true);
    setDraftState(completedDraft);
    showToast("Draft terminée! Prêt à lancer le match!", "success");
  };

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
          />
        )}

        {currentPage === "training" && userTeamData && (
          <TrainingPage
            userTeam={userTeamData}
            onApplyTraining={handleApplyTraining}
            onSetTrainingPlan={handleSetTrainingPlan}
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
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDraft && (
          <DraftSystem
            champions={champions}
            onComplete={handleDraftComplete}
            onCancel={() => setShowDraft(false)}
          />
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
