import React, { useState } from "react";
import { motion } from "framer-motion";
import { Star } from "@phosphor-icons/react";
import { API_CLIENT } from "../shared";
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

  const handleConfirm = async () => {
    if (selectedTeam) {
      try {
        await axios.post(API + "/teams/select/" + selectedTeam.id);
        onSelectTeam(selectedTeam);
      } catch (e) {
        console.error("Error selecting team:", e);
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
      </motion.div>

      <motion.div
        className="teams-grid"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {teams.map((team, index) => (
          <motion.div
            key={team.id}
            className={"team-card " + (selectedTeam?.id === team.id ? "selected" : "")}
            onClick={() => setSelectedTeam(team)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ scale: 1.02 }}
            data-testid={"team-card-" + team.id}
          >
            <div className="team-abbr"><TeamLogo teamId={team.id} abbr={team.abbr} size={48} noClick /></div>
            <div className="team-name">{team.name}</div>
            <div className="team-rating">
              <Star weight="fill" style={{ color: "var(--amber)", marginRight: 4 }} />
              {team.rating}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.button
        className="btn-primary"
        onClick={handleConfirm}
        disabled={!selectedTeam}
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
