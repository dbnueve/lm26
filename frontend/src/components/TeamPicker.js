import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Star, LockSimple } from "@phosphor-icons/react";
import axios from "axios";
import { API_CLIENT, API, useSession } from "../shared";
import TeamLogo from "./TeamLogo";

// Team Picker Component
const LEAGUE_SUBTITLES = {
  LEC:   "Choisissez votre équipe et dominez la compétition européenne",
  LCK:   "Choisissez votre équipe et régnez sur la Corée",
  LPL:   "Choisissez votre équipe et conquérez la Chine",
  LCS:   "Choisissez votre équipe et dominez l'Amérique du Nord",
  CBLOL: "Choisissez votre équipe et triomphez au Brésil",
};

const TeamPicker = ({ teams, onSelectTeam, league = "LEC" }) => {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [mpPlayers, setMpPlayers] = useState([]); // [{ username, team_id }]
  const [myMpTeamId, setMyMpTeamId] = useState(null); // authoritative per-caller
  const mp = useSession();
  const mpActive = !!mp.sid;

  // Fetch MP roster (who has picked what). Skipped in solo. The interceptor
  // injects session_id + mp_token, but /mp2/* is not session-gated, so we
  // call the raw endpoint without those params.
  const refreshMpState = useCallback(async () => {
    if (!mpActive) return;
    try {
      const res = await axios.get(`${API}/mp2/${mp.sid}/info`, { params: { token: mp.token } });
      setMpPlayers(res.data?.players || []);
      setMyMpTeamId(res.data?.my_team_id || null);
    } catch (e) {
      console.warn("mp2 info fetch failed:", e);
    }
  }, [mp.sid, mp.token, mpActive]);

  useEffect(() => {
    refreshMpState();
  }, [refreshMpState]);

  // Listen to WS team_picked / state_changed broadcasts to refresh the taken
  // teams list without polling. The global App.js WS hook already routes
  // events into loadGameData; here we add a lightweight document event hook
  // so this picker refreshes whenever the session state advances.
  useEffect(() => {
    if (!mpActive) return;
    const handler = () => refreshMpState();
    window.addEventListener("mp2:session_event", handler);
    return () => window.removeEventListener("mp2:session_event", handler);
  }, [mpActive, refreshMpState]);

  // Build a map of team_id -> username (to show who owns each taken team).
  const takenBy = {};
  for (const p of mpPlayers) {
    if (p.team_id && p.username) takenBy[p.team_id] = p.username;
  }
  // Authoritative "my team" comes from the backend `/info` response
  // (sess.players[myToken]). The badge "Vous" must only appear on MY pick,
  // never on another player's team.
  const myTeamId = myMpTeamId ? { team_id: myMpTeamId } : null;

  const handleConfirm = async () => {
    if (!selectedTeam) return;
    setErrorMsg(null);
    try {
      await API_CLIENT.post("/teams/select/" + selectedTeam.id);
      // In MP: refresh the taken map so both players see the update.
      if (mpActive) await refreshMpState();
      onSelectTeam(selectedTeam);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 409 && detail) {
        setErrorMsg(detail);
        // Refresh to show the real state of taken teams.
        if (mpActive) refreshMpState();
        setSelectedTeam(null);
      } else {
        console.error("Error selecting team:", e);
        setErrorMsg("Erreur lors de la sélection de l'équipe");
      }
    }
  };

  const subtitle = LEAGUE_SUBTITLES[league] || "Choisissez votre équipe";

  return (
    <div className="team-picker hex-bg">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="font-heading">
          {league} <span>Manager</span> 2026
        </h1>
        <p className="subtitle">{subtitle}</p>
        {mpActive && mpPlayers.length > 1 && (
          <p style={{ color: "var(--muted, #888)", fontSize: 14, marginTop: 6 }}>
            Multijoueur · {mpPlayers.length} joueur{mpPlayers.length > 1 ? "s" : ""} dans la session
          </p>
        )}
      </motion.div>

      {errorMsg && (
        <div
          role="alert"
          style={{
            margin: "12px auto 0",
            maxWidth: 600,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(220, 38, 38, 0.12)",
            color: "#fecaca",
            textAlign: "center",
            fontSize: 14,
          }}
        >
          {errorMsg}
        </div>
      )}

      <motion.div
        className="teams-grid"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {teams.map((team, index) => {
          const owner = takenBy[team.id];
          const isMine = owner && myTeamId && myTeamId.team_id === team.id;
          const isLocked = !!owner && !isMine;
          return (
            <motion.div
              key={team.id}
              className={
                "team-card " +
                (selectedTeam?.id === team.id ? "selected " : "") +
                (isLocked ? "locked " : "") +
                (isMine ? "mine " : "")
              }
              onClick={() => {
                if (isLocked) return;
                setSelectedTeam(team);
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              whileHover={isLocked ? {} : { scale: 1.02 }}
              data-testid={"team-card-" + team.id}
              style={
                isLocked
                  ? {
                      opacity: 0.45,
                      cursor: "not-allowed",
                      position: "relative",
                      filter: "grayscale(0.6)",
                    }
                  : { position: "relative" }
              }
            >
              <div className="team-abbr">
                <TeamLogo teamId={team.id} abbr={team.abbr} size={48} noClick />
              </div>
              <div className="team-name">{team.name}</div>
              <div className="team-rating">
                <Star weight="fill" style={{ color: "var(--amber)", marginRight: 4 }} />
                {team.rating}
              </div>
              {owner && (
                <div
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: isMine ? "var(--amber, #f59e0b)" : "#fca5a5",
                    background: "rgba(0,0,0,0.55)",
                    padding: "3px 7px",
                    borderRadius: 6,
                  }}
                >
                  {isLocked && <LockSimple size={12} weight="fill" />}
                  {isMine ? "Vous" : owner}
                </div>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      <motion.button
        className="btn-primary"
        onClick={handleConfirm}
        disabled={!selectedTeam || !!takenBy[selectedTeam?.id] && !(myTeamId && myTeamId.team_id === selectedTeam?.id)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        data-testid="confirm-team-btn"
        style={{ padding: "16px 48px", fontSize: "18px" }}
      >
        Confirmer la sélection
      </motion.button>
    </div>
  );
};

export default TeamPicker;
