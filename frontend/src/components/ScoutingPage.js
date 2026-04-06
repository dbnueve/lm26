import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightning, Check, Star } from "@phosphor-icons/react";
import axios from "axios";
import { API, PlayerImagesContext, toFlag } from "../shared";
import PlayerDetailModal from "./PlayerDetailModal";

// Scouting Page - ERL and Newgens
const ScoutingPage = ({ userTeam, onSignPlayer }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const [erlPlayers, setErlPlayers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [leagueFilter, setLeagueFilter] = useState("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("rating");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    loadERLPlayers();
  }, []);

  const loadERLPlayers = async () => {
    try {
      const response = await axios.get(API + "/scouting/erl");
      setErlPlayers(response.data);
      setLoading(false);
    } catch (e) {
      console.error("Error loading ERL players:", e);
      setLoading(false);
    }
  };

  const handleSign = async (player) => {
    try {
      const response = await axios.post(API + "/scouting/sign", {
        player_id: player.id,
        offered_salary: Math.round(player.transfer_value * 0.1)
      });
      if (response.data.success) {
        setErlPlayers(prev => prev.filter(p => p.id !== player.id));
        setSelectedPlayer(null);
        onSignPlayer && onSignPlayer(response.data.player);
      }
    } catch (e) {
      console.error("Error signing player:", e);
    }
  };

  const leagues = useMemo(() =>
    ["ALL", ...new Set(erlPlayers.map(p => p.league))],
    [erlPlayers]
  );

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const filteredPlayers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const list = erlPlayers.filter(p => {
      if (positionFilter !== "ALL" && p.position !== positionFilter) return false;
      if (leagueFilter !== "ALL" && p.league !== leagueFilter) return false;
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const va = a[sortBy] ?? 0, vb = b[sortBy] ?? 0;
      return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [erlPlayers, searchTerm, positionFilter, leagueFilter, sortBy, sortDir]);

  const getPotentialColor = (potential) => {
    if (potential >= 90) return "var(--success)";
    if (potential >= 80) return "var(--secondary)";
    return "var(--text-secondary)";
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Lightning size={48} style={{ color: "var(--secondary)" }} />
        <p>Chargement des talents...</p>
      </div>
    );
  }

  return (
    <div className="animate-slide-up">
      <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 8 }}>
        Scouting - ERL et Talents
      </h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
        Découvrez les futurs stars des ligues régionales européennes
      </p>

      {/* Filters */}
      <div style={{ marginBottom: 24, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Rechercher un joueur..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            padding: "12px 16px",
            color: "white",
            borderRadius: 2,
            width: 250
          }}
          data-testid="scout-search"
        />
        <div style={{ display: "flex", gap: 8 }}>
          {["ALL", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"].map(pos => (
            <button
              key={pos}
              className={positionFilter === pos ? "btn-primary" : "btn-secondary"}
              onClick={() => setPositionFilter(pos)}
              style={{ padding: "8px 12px" }}
            >
              {pos === "ALL" ? "Tous" : pos}
            </button>
          ))}
        </div>
      </div>

      {/* League Filter */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {leagues.map(league => (
          <button
            key={league}
            className={leagueFilter === league ? "btn-primary" : "btn-secondary"}
            onClick={() => setLeagueFilter(league)}
            style={{ padding: "6px 12px", fontSize: 12 }}
          >
            {league === "ALL" ? "Toutes ligues" : league}
          </button>
        ))}
      </div>

      {/* Players Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        {(() => {
          const cols = [
            { key: null,            label: "Joueur",    sortable: false },
            { key: "position",      label: "Pos",       sortable: false },
            { key: "age",           label: "Age",       sortable: true  },
            { key: "rating",        label: "Rating",    sortable: true  },
            { key: "potential",     label: "Potentiel", sortable: true  },
            { key: "league",        label: "Ligue",     sortable: false },
            { key: "transfer_value",label: "Valeur",    sortable: true  },
          ];
          const SortIcon = ({ col }) => {
            if (!col.sortable) return null;
            if (sortBy !== col.key) return <span style={{ marginLeft: 4, opacity: 0.3 }}>↕</span>;
            return <span style={{ marginLeft: 4, color: "var(--primary)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
          };
          return (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px 70px 90px 90px 90px", padding: "12px 16px", background: "var(--bg-dark)", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)", fontSize: 13 }}>
                {cols.map(col => (
                  <span key={col.label}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    style={{ cursor: col.sortable ? "pointer" : "default", userSelect: "none", display: "flex", alignItems: "center" }}
                  >
                    {col.label}<SortIcon col={col} />
                  </span>
                ))}
              </div>
              {filteredPlayers.map(player => {
                const imgUrl = playerImages[player.name.toLowerCase()];
                return (
                  <motion.div key={player.id}
                    style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px 70px 90px 90px 90px", padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", alignItems: "center", cursor: "pointer" }}
                    whileHover={{ background: "var(--surface-hover)" }}
                    onClick={() => setSelectedPlayer(player)}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                        {imgUrl
                          ? <img loading="lazy" src={imgUrl} alt={player.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display="none"; }} />
                          : player.name.substring(0, 2).toUpperCase()
                        }
                      </span>
                      <span>
                        <span style={{ fontWeight: 600 }}>{player.name}</span>
                        <span style={{ fontSize: 14, marginLeft: 6 }}>{toFlag(player.nationality)}</span>
                      </span>
                    </span>
                    <span className={"pos-badge pos-" + player.position} style={{ fontSize: 10 }}>{player.position}</span>
                    <span className="font-stats">{player.age}</span>
                    <span className="font-stats" style={{ fontWeight: 700, color: "var(--primary)" }}>{player.rating}</span>
                    <span className="font-stats" style={{ fontWeight: 700, color: getPotentialColor(player.potential) }}>
                      {player.potential}{player.potential >= 90 && <Star size={12} weight="fill" style={{ marginLeft: 4 }} />}
                    </span>
                    <span style={{ fontSize: 12 }}>{player.league}</span>
                    <span className="font-stats" style={{ color: "var(--secondary)" }}>{(player.transfer_value / 1000).toFixed(0)}K</span>
                  </motion.div>
                );
              })}
            </>
          );
        })()}
      </div>

      {/* Player Detail Modal */}
      <AnimatePresence>
        {selectedPlayer && (() => {
          const sp = selectedPlayer;
          const canAfford = sp.transfer_value <= userTeam.budget;
          return (
            <PlayerDetailModal
              player={sp}
              onClose={() => setSelectedPlayer(null)}
              actions={
                <button
                  className="btn-primary"
                  style={{ width: "100%", opacity: canAfford ? 1 : 0.5 }}
                  onClick={() => handleSign(sp)}
                  disabled={!canAfford}
                  data-testid="sign-player-btn"
                >
                  <Check size={18} style={{ marginRight: 8 }} />
                  {canAfford ? "Recruter ce joueur" : "Budget insuffisant"}
                </button>
              }
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default ScoutingPage;
