import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Coins } from "@phosphor-icons/react";
import axios from "axios";
import { API, PlayerImagesContext, toFlag } from "../shared";
import PlayerDetailModal from "./PlayerDetailModal";

// Negotiations Page Component
const NegotiationsPage = ({ userTeam, teams, onMakeOffer }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [offerAmount, setOfferAmount] = useState(0);
  const [contractYears, setContractYears] = useState(2);
  const [negotiationResult, setNegotiationResult] = useState(null);
  const [positionFilter, setPositionFilter] = useState("ALL");

  useEffect(() => {
    axios.get(API + "/negotiations/available")
      .then(res => setAvailablePlayers(res.data))
      .catch(e => console.error("Error loading available players:", e))
      .finally(() => setLoadingPlayers(false));
  }, []);

  const filteredPlayers = useMemo(() =>
    positionFilter === "ALL"
      ? availablePlayers
      : availablePlayers.filter(p => p.position === positionFilter),
    [availablePlayers, positionFilter]
  );

  const handleOffer = async () => {
    if (!selectedPlayer) return;

    const result = await onMakeOffer(selectedPlayer.id, offerAmount, contractYears);
    setNegotiationResult(result);

    if (result.accepted) {
      setSelectedPlayer(null);
    }
  };

  const getTeamName = (teamId) => {
    const team = teams.find(t => t.id === teamId);
    return team ? team.abbr : "Unknown";
  };

  if (loadingPlayers) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
        Chargement des joueurs disponibles...
      </div>
    );
  }

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
        Négociations de Transfert
      </h2>

      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        {["ALL", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"].map(pos => (
          <button
            key={pos}
            className={positionFilter === pos ? "btn-primary" : "btn-secondary"}
            onClick={() => setPositionFilter(pos)}
            data-testid={"filter-" + pos}
          >
            {pos === "ALL" ? "Tous" : pos}
          </button>
        ))}
      </div>

      <div className="grid-4">
        {filteredPlayers.slice(0, 20).map(player => {
          const imgUrl = playerImages[player.name.toLowerCase()];
          return (
            <motion.div
              key={player.id}
              className="card"
              style={{ padding: 16, cursor: "pointer" }}
              whileHover={{ y: -4 }}
              onClick={() => {
                setSelectedPlayer(player);
                setOfferAmount(player.transfer_value);
                setNegotiationResult(null);
              }}
              data-testid={"negotiation-player-" + player.id}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                    {imgUrl
                      ? <img loading="lazy" src={imgUrl} alt={player.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display="none"; }} />
                      : player.name.substring(0, 2).toUpperCase()
                    }
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      {player.name}
                      <span style={{ fontSize: 14 }}>{toFlag(player.nationality)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {getTeamName(player.team_id)}
                    </div>
                  </div>
                </div>
                <span className={"pos-badge pos-" + player.position}>{player.position}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="font-stats" style={{ fontSize: 24, fontWeight: 700, color: "var(--primary)" }}>
                  {player.rating}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Valeur estimée</div>
                  <div className="font-stats" style={{ color: "var(--secondary)" }}>
                    {(player.transfer_value / 1000).toFixed(0)}K EUR
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedPlayer && (
          <PlayerDetailModal
            player={{ ...selectedPlayer, team_abbr: getTeamName(selectedPlayer.team_id) }}
            onClose={() => { setSelectedPlayer(null); setNegotiationResult(null); }}
            actions={
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Offer slider */}
                <div style={{ background: "var(--surface)", borderRadius: 2, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Montant de l'offre</span>
                    <span className="font-stats" style={{ fontSize: 20, fontWeight: 700, color: "var(--secondary)" }}>
                      {(offerAmount / 1000000).toFixed(2)}M EUR
                    </span>
                  </div>
                  <input type="range"
                    min={selectedPlayer.transfer_value * 0.5}
                    max={Math.min(selectedPlayer.transfer_value * 2, userTeam.budget)}
                    value={offerAmount}
                    onChange={e => setOfferAmount(parseInt(e.target.value))}
                    style={{ width: "100%" }}
                    data-testid="offer-slider"
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                    <span>Min: {(selectedPlayer.transfer_value * 0.5 / 1000000).toFixed(2)}M</span>
                    <span>Budget: {(userTeam.budget / 1000000).toFixed(2)}M</span>
                  </div>
                </div>

                {/* Contract duration */}
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>Durée du contrat</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {[1, 2, 3].map(years => (
                      <button key={years}
                        className={contractYears === years ? "btn-primary" : "btn-secondary"}
                        onClick={() => setContractYears(years)}
                        style={{ flex: 1 }}
                        data-testid={"contract-" + years + "y"}
                      >
                        {years} an{years > 1 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Result banner */}
                {negotiationResult && (
                  <div style={{ padding: 14, background: negotiationResult.accepted ? "rgba(0,230,118,0.1)" : "rgba(255,51,102,0.1)", border: "1px solid " + (negotiationResult.accepted ? "var(--success)" : "var(--danger)"), borderRadius: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {negotiationResult.accepted ? <Check size={18} style={{ color: "var(--success)" }} /> : <X size={18} style={{ color: "var(--danger)" }} />}
                      <strong>{negotiationResult.accepted ? "Offre acceptée !" : "Offre refusée"}</strong>
                    </div>
                    <div style={{ fontSize: 13 }}>{negotiationResult.message}</div>
                    {negotiationResult.counter_offer && (
                      <button className="btn-secondary" style={{ marginTop: 10, width: "100%" }}
                        onClick={() => setOfferAmount(negotiationResult.counter_offer.amount)}>
                        Accepter contre-offre : {(negotiationResult.counter_offer.amount / 1000000).toFixed(2)}M EUR
                      </button>
                    )}
                  </div>
                )}

                <button className="btn-primary" style={{ width: "100%" }}
                  onClick={handleOffer} disabled={offerAmount > userTeam.budget}
                  data-testid="submit-offer-btn">
                  <Coins size={18} style={{ marginRight: 8 }} />
                  Envoyer l'offre
                </button>
              </div>
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default NegotiationsPage;
