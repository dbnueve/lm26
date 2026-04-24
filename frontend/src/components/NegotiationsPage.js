import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Coins, Lock, RocketLaunch, ArrowRight, Hourglass } from "@phosphor-icons/react";
import { API, API_CLIENT, PlayerImagesContext, toFlag, formatMoney, useSession } from "../shared";
import axios from "axios";
import PlayerDetailModal from "./PlayerDetailModal";

// Negotiations Page Component
const NegotiationsPage = ({ userTeam, teams, phase: phaseProp, onMakeOffer, onSeasonStart, onPendingResolved, mpReady }) => {
  const mp = useSession();
  const mpActive = Boolean(mp?.sid && mp?.token);
  const playerImages = React.useContext(PlayerImagesContext);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [offerAmount, setOfferAmount] = useState(0);
  const [contractYears, setContractYears] = useState(2);
  const [negotiationResult, setNegotiationResult] = useState(null);
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [startingSeasonLoading, setStartingSeasonLoading] = useState(false);
  const [aiTransfers, setAiTransfers] = useState(null);
  const [pendingTab, setPendingTab] = useState("incoming");
  const [pending, setPending] = useState({ incoming: [], outgoing: [] });
  const [counterDrafts, setCounterDrafts] = useState({});
  const [mpSessionInfo, setMpSessionInfo] = useState(null); // { players, ready, ... }

  const loadMpSession = React.useCallback(() => {
    if (!mpActive) return;
    axios.get(`${API}/mp2/${mp.sid}/info`, { params: { token: mp.token } })
      .then(res => setMpSessionInfo(res.data))
      .catch(() => {});
  }, [mpActive, mp?.sid, mp?.token]);

  const loadPending = React.useCallback(() => {
    API_CLIENT.get("/negotiations/pending")
      .then(res => setPending(res.data || { incoming: [], outgoing: [] }))
      .catch(() => {});
  }, []);

  // Use phase from parent (App.js) — no redundant GET /game/state needed
  const phase = phaseProp || "regular";
  const loadingPhase = false;

  useEffect(() => {
    if (phase !== "preseason") return;
    setLoadingPlayers(true);
    API_CLIENT.get("/negotiations/available")
      .then(res => setAvailablePlayers(res.data))
      .catch(() => {})
      .finally(() => setLoadingPlayers(false));
    loadPending();
    loadMpSession();
  }, [phase, loadPending, loadMpSession]);

  // Poll MP session info + pending offers during preseason so players see
  // each other's ready votes and incoming offers without a manual refresh.
  useEffect(() => {
    if (phase !== "preseason" || !mpActive) return undefined;
    const id = setInterval(() => {
      loadMpSession();
      loadPending();
    }, 4000);
    return () => clearInterval(id);
  }, [phase, mpActive, loadMpSession, loadPending]);

  const refreshAfterMutation = async () => {
    loadPending();
    if (onPendingResolved) await onPendingResolved();
  };

  const handleAcceptPending = async (negId) => {
    try {
      await API_CLIENT.post(`/negotiations/${negId}/accept`);
      await refreshAfterMutation();
    } catch (e) {
      console.error("Accept failed:", e);
    }
  };

  const handleRejectPending = async (negId) => {
    try {
      await API_CLIENT.post(`/negotiations/${negId}/reject`);
      await refreshAfterMutation();
    } catch (e) {
      console.error("Reject failed:", e);
    }
  };

  const handleCounterPending = async (negId) => {
    const amount = parseInt(counterDrafts[negId], 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      await API_CLIENT.post(`/negotiations/${negId}/counter`, { counter_amount: amount });
      setCounterDrafts(d => ({ ...d, [negId]: "" }));
      await refreshAfterMutation();
    } catch (e) {
      console.error("Counter failed:", e);
    }
  };

  const handleWithdrawPending = async (negId) => {
    try {
      await API_CLIENT.post(`/negotiations/${negId}/withdraw`);
      await refreshAfterMutation();
    } catch (e) {
      console.error("Withdraw failed:", e);
    }
  };

  const filteredPlayers = useMemo(() =>
    positionFilter === "ALL"
      ? availablePlayers
      : availablePlayers.filter(p => p.position === positionFilter),
    [availablePlayers, positionFilter]
  );

  const handleOffer = async () => {
    if (!selectedPlayer) return;
    // Prefer swapping a starter; fall back to any player of the same position
    const playerToSwap = userTeam.players.find(p => p.position === selectedPlayer.position && p.is_starter)
      || userTeam.players.find(p => p.position === selectedPlayer.position);
    const result = await onMakeOffer(selectedPlayer.id, offerAmount, contractYears, playerToSwap?.id);
    setNegotiationResult(result);
    if (result.accepted) setSelectedPlayer(null);
    if (result.pending) loadPending();
  };

  const handleStartSeason = async () => {
    setStartingSeasonLoading(true);
    try {
      // In MP, delegate to App.js handler which gates via /mp2/*/ready so the
      // mercato only closes when every human player has voted.
      // In solo, same handler just calls /season/start directly.
      if (onSeasonStart) {
        const result = await onSeasonStart();
        // result may be: undefined (solo), or { fired, pending, ai_transfers }
        if (result && result.pending) {
          // MP: waiting on peers — refresh ready snapshot so the UI shows
          // "3/4 joueurs prêts" etc.
          loadMpSession();
        } else if (result && result.fired && result.ai_transfers) {
          setAiTransfers(result.ai_transfers);
        }
      }
    } catch (e) {
      console.error("Error starting season:", e);
    } finally {
      setStartingSeasonLoading(false);
    }
  };

  const handleCancelReady = async () => {
    if (!mpActive) return;
    try {
      await axios.delete(`${API}/mp2/${mp.sid}/ready`, {
        params: { token: mp.token, action: "season/start" },
      });
      loadMpSession();
    } catch (e) {
      console.error("Unready failed:", e);
    }
  };

  // Ready state derived from the session info (MP only).
  const seasonStartReady = mpSessionInfo?.ready?.["season/start"] || [];
  const totalPlayers = mpSessionInfo?.players?.length || 0;
  const meUsername = mp?.username;
  const iAmReady = meUsername ? seasonStartReady.includes(meUsername) : false;
  const waitingForPeers = mpActive && iAmReady && seasonStartReady.length < totalPlayers;

  const getTeamName = (teamId) => {
    const team = teams.find(t => t.id === teamId);
    return team ? team.abbr : "Unknown";
  };

  // Show AI transfers summary after season start
  if (aiTransfers !== null && phase === "regular") {
    return (
      <div className="animate-slide-up">
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 8 }}>
          Saison lancée !
        </h2>
        <div style={{ color: "var(--text-2)", marginBottom: 24, fontSize: 14 }}>
          Les équipes adverses ont effectué leurs mouvements de transfert.
        </div>

        {aiTransfers.length === 0 ? (
          <div style={{ padding: "24px 20px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", color: "var(--text-2)", textAlign: "center" }}>
            Aucun transfert IA cette période d'offseason.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {aiTransfers.map((t, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "80px 1fr 32px 1fr 60px",
                alignItems: "center", gap: 12, padding: "12px 16px",
                background: "var(--surface-1)", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)"
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase" }}>
                  {t.team_abbr}
                </span>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1 }}>Départ</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--danger)" }}>{t.out}</div>
                </div>
                <ArrowRight size={16} style={{ color: "var(--text-2)" }} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 1 }}>Arrivée</div>
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

        <div style={{ marginTop: 24, padding: "14px 20px", background: "var(--success-dim)", border: "1px solid var(--success-border)", borderRadius: "var(--radius-sm)", color: "var(--success)", fontSize: 13 }}>
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
          padding: "60px 40px", background: "var(--surface-1)", borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)", textAlign: "center", gap: 16
        }}>
          <Lock size={48} style={{ color: "var(--text-2)", opacity: 0.5 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Mercato fermé
            </div>
            <div style={{ color: "var(--text-2)", fontSize: 14, maxWidth: 400 }}>
              Les négociations de transfert ne sont disponibles que pendant la période d'offseason,
              avant le début de chaque saison.
            </div>
          </div>
          <div style={{
            marginTop: 8, padding: "8px 16px", background: "var(--surface-2)",
            borderRadius: "var(--radius-xs)", fontSize: 12, color: "var(--text-2)", fontFamily: "var(--font-mono)"
          }}>
            Phase actuelle : <strong style={{ color: "var(--accent)" }}>{phase}</strong>
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {waitingForPeers ? (
            <button
              className="btn-secondary"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px" }}
              onClick={handleCancelReady}
              data-testid="cancel-ready-btn"
            >
              <Hourglass size={18} />
              Annuler mon vote
            </button>
          ) : (
            <button
              className="btn-primary"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px" }}
              onClick={handleStartSeason}
              disabled={startingSeasonLoading}
              data-testid="start-season-btn"
            >
              <RocketLaunch size={18} />
              {startingSeasonLoading ? "Lancement..." : mpActive ? "Prêt à lancer" : "Lancer la saison"}
            </button>
          )}
          {mpActive && totalPlayers > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              {seasonStartReady.length} / {totalPlayers} joueur{totalPlayers > 1 ? "s" : ""} prêt{seasonStartReady.length > 1 ? "s" : ""}
              {seasonStartReady.length > 0 && (
                <span style={{ marginLeft: 6, color: "var(--text-2)" }}>
                  · {seasonStartReady.join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {(pending.incoming.length > 0 || pending.outgoing.length > 0) && (
        <div style={{ marginBottom: 24, padding: 16, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              className={pendingTab === "incoming" ? "btn-primary" : "btn-secondary"}
              onClick={() => setPendingTab("incoming")}
              data-testid="pending-tab-incoming"
            >
              Reçues ({pending.incoming.length})
            </button>
            <button
              className={pendingTab === "outgoing" ? "btn-primary" : "btn-secondary"}
              onClick={() => setPendingTab("outgoing")}
              data-testid="pending-tab-outgoing"
            >
              Envoyées ({pending.outgoing.length})
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingTab === "incoming" && pending.incoming.length === 0 && (
              <div style={{ color: "var(--text-2)", fontSize: 13 }}>Aucune offre reçue.</div>
            )}
            {pendingTab === "outgoing" && pending.outgoing.length === 0 && (
              <div style={{ color: "var(--text-2)", fontSize: 13 }}>Aucune offre envoyée.</div>
            )}
            {(pendingTab === "incoming" ? pending.incoming : pending.outgoing).map(n => (
              <div key={n.id} style={{
                padding: "12px 14px", background: "var(--surface-2)", borderRadius: "var(--radius-xs)",
                border: "1px solid var(--border)",
                display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center"
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                    {n.player_name} <span className={"pos-badge pos-" + n.player_position} style={{ fontSize: 10, marginLeft: 6 }}>{n.player_position}</span>
                    <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-2)" }}>({n.player_rating})</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {pendingTab === "incoming"
                      ? <>De <strong>{n.from_team_name || n.from_team_abbr}</strong></>
                      : <>Vers <strong>{n.to_team_name || n.to_team_abbr}</strong></>}
                    {" · "}{formatMoney(n.offered_amount)} EUR / {n.contract_years} an(s)
                    {n.status === "countered" && <span style={{ color: "var(--amber)", marginLeft: 6 }}>● contre-offre</span>}
                  </div>
                </div>
                {pendingTab === "incoming" ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      placeholder="Contre-offre"
                      value={counterDrafts[n.id] || ""}
                      onChange={e => setCounterDrafts(d => ({ ...d, [n.id]: e.target.value }))}
                      style={{ width: 110, padding: "6px 8px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", color: "var(--text-1)" }}
                      data-testid={"counter-input-" + n.id}
                    />
                    <button className="btn-secondary" onClick={() => handleCounterPending(n.id)} data-testid={"counter-btn-" + n.id}>
                      Contre
                    </button>
                    <button className="btn-primary" onClick={() => handleAcceptPending(n.id)} data-testid={"accept-btn-" + n.id}>
                      <Check size={14} />
                    </button>
                    <button className="btn-secondary" onClick={() => handleRejectPending(n.id)} data-testid={"reject-btn-" + n.id}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button className="btn-secondary" onClick={() => handleWithdrawPending(n.id)} data-testid={"withdraw-btn-" + n.id}>
                    Retirer
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-2)" }}>
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
                    <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
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
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                        {getTeamName(player.team_id)}
                      </div>
                    </div>
                  </div>
                  <span className={"pos-badge pos-" + player.position}>{player.position}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="font-stats" style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>
                    {player.rating}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "var(--text-2)" }}>Valeur estimée</div>
                    <div className="font-stats" style={{ color: "var(--amber)" }}>
                      {formatMoney(player.transfer_value)} EUR
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
                <div style={{ background: "var(--surface-1)", borderRadius: 2, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>Montant de l'offre</span>
                    <span className="font-stats" style={{ fontSize: 20, fontWeight: 700, color: "var(--amber)" }}>
                      {formatMoney(offerAmount)} EUR
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
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
                    <span>Min: {formatMoney(selectedPlayer.transfer_value * 0.5)}</span>
                    <span>Budget: {formatMoney(userTeam.budget)}</span>
                  </div>
                </div>

                {/* Contract duration */}
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>Durée du contrat</div>
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
                  <div style={{
                    padding: 14,
                    background: negotiationResult.accepted ? "rgba(0,230,118,0.1)" : negotiationResult.pending ? "rgba(255,193,7,0.1)" : "rgba(255,51,102,0.1)",
                    border: "1px solid " + (negotiationResult.accepted ? "var(--success)" : negotiationResult.pending ? "var(--amber)" : "var(--danger)"),
                    borderRadius: 2
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {negotiationResult.accepted
                        ? <Check size={18} style={{ color: "var(--success)" }} />
                        : negotiationResult.pending
                          ? <Coins size={18} style={{ color: "var(--amber)" }} />
                          : <X size={18} style={{ color: "var(--danger)" }} />}
                      <strong>{negotiationResult.accepted ? "Offre acceptée !" : negotiationResult.pending ? "Offre envoyée" : "Offre refusée"}</strong>
                    </div>
                    <div style={{ fontSize: 13 }}>{negotiationResult.message}</div>
                    {negotiationResult.counter_offer && (
                      <button className="btn-secondary" style={{ marginTop: 10, width: "100%" }}
                        onClick={async () => {
                          setOfferAmount(negotiationResult.counter_offer.amount);
                          const playerToSwap = userTeam.players.find(p => p.position === selectedPlayer.position && p.is_starter)
                            || userTeam.players.find(p => p.position === selectedPlayer.position);
                          const result = await onMakeOffer(selectedPlayer.id, negotiationResult.counter_offer.amount, contractYears, playerToSwap?.id, true);
                          setNegotiationResult(result);
                          if (result.accepted) setSelectedPlayer(null);
                        }}>
                        Accepter contre-offre : {formatMoney(negotiationResult.counter_offer.amount)} EUR
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
