import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Coins, Lock, RocketLaunch, ArrowRight } from "@phosphor-icons/react";
import axios from "axios";
import { API, PlayerImagesContext, toFlag, formatMoney } from "../shared";
import PlayerDetailModal from "./PlayerDetailModal";

// Negotiations Page Component
const NegotiationsPage = ({ userTeam, teams, onMakeOffer, onSeasonStart }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [offerAmount, setOfferAmount] = useState(0);
  const [contractYears, setContractYears] = useState(2);
  const [negotiationResult, setNegotiationResult] = useState(null);
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [phase, setPhase] = useState(null);
  const [loadingPhase, setLoadingPhase] = useState(true);
  const [startingSeasonLoading, setStartingSeasonLoading] = useState(false);
  const [aiTransfers, setAiTransfers] = useState(null);

  useEffect(() => {
    axios.get(API + "/game/state")
      .then(res => {
        setPhase(res.data.phase || "regular");
        setLoadingPhase(false);
      })
      .catch(() => {
        setPhase("regular");
        setLoadingPhase(false);
      });
  }, []);

  useEffect(() => {
    if (phase !== "preseason") return;
    setLoadingPlayers(true);
    axios.get(API + "/negotiations/available")
      .then(res => setAvailablePlayers(res.data))
      .catch(() => {})
      .finally(() => setLoadingPlayers(false));
  }, [phase]);

  const filteredPlayers = useMemo(() =>
    positionFilter === "ALL"
      ? availablePlayers
      : availablePlayers.filter(p => p.position === positionFilter),
    [availablePlayers, positionFilter]
  );

  const handleOffer = async () => {
    if (!selectedPlayer) return;
    const playerToSwap = userTeam.players.find(p => p.position === selectedPlayer.position);
    const result = await onMakeOffer(selectedPlayer.id, offerAmount, contractYears, playerToSwap?.id);
    setNegotiationResult(result);
    if (result.accepted) setSelectedPlayer(null);
  };

  const handleStartSeason = async () => {
    setStartingSeasonLoading(true);
    try {
      const res = await axios.post(API + "/season/start");
      setAiTransfers(res.data.ai_transfers || []);
      setPhase("regular");
      if (onSeasonStart) onSeasonStart();
    } catch (e) {
      console.error("Error starting season:", e);
    } finally {
      setStartingSeasonLoading(false);
    }
  };

  const getTeamName = (teamId) => {
    const team = teams.find(t => t.id === teamId);
    return team ? team.abbr : "Unknown";
  };

  if (loadingPhase) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
        Chargement...
      </div>
    );
  }

  // Show AI transfers summary after season start
  if (aiTransfers !== null && phase === "regular") {
    return (
      <div className="animate-slide-up">
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 8 }}>
          Saison lancée !
        </h2>
        <div style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 14 }}>
          Les équipes adverses ont effectué leurs mouvements de transfert.
        </div>

        {aiTransfers.length === 0 ? (
          <div style={{ padding: "24px 20px", background: "var(--surface)", borderRadius: 4, color: "var(--text-secondary)", textAlign: "center" }}>
            Aucun transfert IA cette période d'offseason.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {aiTransfers.map((t, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "80px 1fr 32px 1fr 60px",
                alignItems: "center", gap: 12, padding: "12px 16px",
                background: "var(--surface)", borderRadius: 4,
                border: "1px solid var(--border-subtle)"
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                  {t.team_abbr}
                </span>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>Départ</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--danger)" }}>{t.out}</div>
                </div>
                <ArrowRight size={16} style={{ color: "var(--text-secondary)" }} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>Arrivée</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--success)" }}>{t.in}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={"pos-badge pos-" + t.position} style={{ fontSize: 10 }}>{t.position}</span>
                  {t.rating_change > 0 && (
                    <div style={{ fontSize: 11, color: "var(--success)", fontWeight: 700, marginTop: 2 }}>
                      +{t.rating_change}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 24, padding: "14px 20px", background: "rgba(0,230,118,0.08)", border: "1px solid var(--success)", borderRadius: 4, color: "var(--success)", fontSize: 13 }}>
          <strong>La saison régulière a commencé.</strong> Rendez-vous dans l'onglet Calendrier pour jouer votre premier match.
        </div>
      </div>
    );
  }

  // Locked during regular season / playoffs
  if (phase !== "preseason") {
    return (
      <div className="animate-slide-up">
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 24 }}>
          Négociations de Transfert
        </h2>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "60px 40px", background: "var(--surface)", borderRadius: 4,
          border: "1px solid var(--border-subtle)", textAlign: "center", gap: 16
        }}>
          <Lock size={48} style={{ color: "var(--text-secondary)", opacity: 0.5 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Mercato fermé
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 400 }}>
              Les négociations de transfert ne sont disponibles que pendant la période d'offseason,
              avant le début de chaque saison.
            </div>
          </div>
          <div style={{
            marginTop: 8, padding: "8px 16px", background: "var(--bg-dark)",
            borderRadius: 2, fontSize: 12, color: "var(--text-secondary)", fontFamily: "monospace"
          }}>
            Phase actuelle : <strong style={{ color: "var(--primary)" }}>{phase}</strong>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slide-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 4 }}>
            Négociations de Transfert
          </h2>
          <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 600 }}>
            ● Période d'offseason — Mercato ouvert
          </div>
        </div>
        <button
          className="btn-primary"
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px" }}
          onClick={handleStartSeason}
          disabled={startingSeasonLoading}
        >
          <RocketLaunch size={18} />
          {startingSeasonLoading ? "Lancement..." : "Lancer la saison"}
        </button>
      </div>

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

      {loadingPlayers ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
          Chargement des joueurs disponibles...
        </div>
      ) : (
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
      )}

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
                        onClick={async () => {
                          setOfferAmount(negotiationResult.counter_offer.amount);
                          const playerToSwap = userTeam.players.find(p => p.position === selectedPlayer.position);
                          const result = await onMakeOffer(selectedPlayer.id, negotiationResult.counter_offer.amount, contractYears, playerToSwap?.id, true);
                          setNegotiationResult(result);
                          if (result.accepted) setSelectedPlayer(null);
                        }}>
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
