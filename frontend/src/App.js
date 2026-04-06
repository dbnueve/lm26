import React, { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { AnimatePresence } from "framer-motion";
import { API, PlayerImagesContext, TeamLogosContext, TeamModalContext, withTimeout } from "./shared";

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
  const [standings, setStandings] = useState([]);
  const [champions, setChampions] = useState({});
  const [playerImages, setPlayerImages] = useState({});
  const [teamLogos, setTeamLogos] = useState({});
  const [globalTeamModal, setGlobalTeamModal] = useState(null); // {id, abbr}
  const openTeam = React.useCallback((teamId, abbr) => setGlobalTeamModal({ id: teamId, abbr }), []);
  const currentPage_ref = React.useRef("dashboard");
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [activeMatch, setActiveMatch] = useState(null);
  const [activePlayoffMatch, setActivePlayoffMatch] = useState(null);
  const [playoffsRefreshKey, setPlayoffsRefreshKey] = useState(0);
  const [showDraft, setShowDraft] = useState(false);
  const [draftCompleted, setDraftCompleted] = useState(false);
  const [draftState, setDraftState] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSaveSelection, setShowSaveSelection] = useState(false);
  // Split continuity
  const [splitStatus, setSplitStatus] = useState(null);
  const [showSplitEnd, setShowSplitEnd] = useState(false);
  const [showInternational, setShowInternational] = useState(false);

  const showToast = (message, type = "info") => {
    setToast({ message, type });
  };

  // Fetch lolesports player headshots + team logos once on mount
  useEffect(() => {
    axios.get(API + "/player-images").then(r => setPlayerImages(r.data)).catch(() => {});
    axios.get(API + "/team-logos").then(r => setTeamLogos(r.data)).catch(() => {});
  }, []);

  const loadGameData = useCallback(async () => {
    try {
      // allPlayers is no longer stored globally — NegotiationsPage fetches its own data
     const [teamsRes, scheduleRes, standingsRes, championsRes] = await withTimeout(
        Promise.all([
          axios.get(API + "/teams"),
          axios.get(API + "/schedule"),
          axios.get(API + "/standings"),
          axios.get(API + "/draft/champions")
        ])
      );

      setTeams(teamsRes.data);
      setSchedule(scheduleRes.data);
      setStandings(standingsRes.data);
      setChampions(championsRes.data);
    } catch (e) {
      console.error("Error loading game data:", e);
    }
  }, []);

  const loadSplitStatus = useCallback(async (userTeamId) => {
    try {
      const res = await axios.get(API + "/split/status");
      setSplitStatus(res.data);
      if (res.data.is_offseason && userTeamId) {
        // Check if international tournament is done before showing split end
        try {
          const intlRes = await axios.get(API + "/international");
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

  const handleNextSplit = async () => {
    try {
      const res = await axios.post(API + "/split/next");
      setShowSplitEnd(false);
      setShowInternational(false);
      setCurrentPage("dashboard");
      // Reload everything
      await loadGameData();
      const newUserTeam = gameState.userTeam;
      if (newUserTeam) await loadUserTeam(newUserTeam);
      await loadSplitStatus(newUserTeam);
      showToast(`Nouveau split : ${res.data.new_split.label} !`, "success");
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
      const response = await axios.get(API + "/teams/" + teamId);
      setUserTeamData(response.data);
    } catch (e) {
      console.error("Error loading user team:", e);
    }
  }, []);

  const loadSlot = async (slot) => {
    const res = await axios.post(API + `/saves/${slot}/load`);
    localStorage.setItem("lec_active_slot", slot);
    setGameState({ initialized: res.data.initialized, userTeam: res.data.user_team, league: res.data.league || "LEC" });
    if (res.data.user_team) await loadUserTeam(res.data.user_team);
    await loadGameData();
    await loadSplitStatus(res.data.user_team);
    setShowSaveSelection(false);
  };

  const startNewSlot = async (slot, league = "LEC") => {
    await axios.post(API + `/saves/${slot}/new`, { league });
    localStorage.setItem("lec_active_slot", slot);
    setGameState({ initialized: true, userTeam: null, league });
    await loadGameData();
    setShowSaveSelection(false);
  };

  const goToSaveSelection = () => {
    localStorage.removeItem("lec_active_slot");
    setShowSaveSelection(true);
  };

  useEffect(() => {
    const initGame = async () => {
      const savedSlot = localStorage.getItem("lec_active_slot");
      if (savedSlot) {
        try {
          await loadSlot(parseInt(savedSlot, 10));
          return;
        } catch (e) {
          // Save not found or corrupted — show selection
          localStorage.removeItem("lec_active_slot");
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
    await axios.post(API + "/season/simulate");
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

  const handleMakeOffer = async (playerId, amount, years) => {
    try {
      const response = await axios.post(API + "/negotiations/offer", {
        player_id: playerId,
        offered_amount: amount,
        contract_years: years
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
      await axios.post(API + "/roster/swap", {
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
      await axios.post(API + "/training/apply", {
        player_id: playerId,
        training_type: trainingType
      });
      await loadUserTeam(gameState.userTeam);
      showToast("Entrainement appliqué!", "success");
    } catch (e) {
      console.error("Error applying training:", e);
      showToast("Erreur lors de l entrainement", "error");
    }
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
        <SaveSelectionPage onLoad={loadSlot} onNew={startNewSlot} />
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
    <div className="app-container hex-bg">
      <Navigation
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        userTeam={userTeamData}
        onChangeSave={goToSaveSelection}
      />

      <main className="main-content">
        <ErrorBoundary label="Erreur dans la page">
        {currentPage === "dashboard" && userTeamData && (
          <Dashboard
            userTeam={userTeamData}
            schedule={schedule}
            standings={standings}
            onPlayMatch={handlePlayMatch}
            onPlayPlayoffMatch={(m) => setActivePlayoffMatch(m)}
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
            onMakeOffer={handleMakeOffer}
          />
        )}

        {currentPage === "training" && userTeamData && (
          <TrainingPage
            userTeam={userTeamData}
            onApplyTraining={handleApplyTraining}
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

        {currentPage === "stats" && <StatsPage />}

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
            onSplitEnd={() => loadSplitStatus(gameState.userTeam)}
          />
        )}
      </AnimatePresence>

      {/* International Tournament — shown after playoffs, before split end */}
      <AnimatePresence>
        {showInternational && !activePlayoffMatch && (
          <InternationalModal
            userTeam={userTeamData}
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
