import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightning, Check, Star, Globe } from "@phosphor-icons/react";
import { API_CLIENT, PlayerImagesContext, toFlag, formatMoney } from "../shared";
import PlayerDetailModal from "./PlayerDetailModal";

const MAJOR_LEAGUES = ["LEC", "LCK", "LPL", "LCS", "CBLOL"];
const LEAGUE_COLORS = {
  LEC:   "#0ac8b9",
  LCK:   "#c89b3c",
  LPL:   "#e84057",
  LCS:   "#1e90ff",
  CBLOL: "#00c853",
};
const LEAGUE_FLAGS = { LEC: "🇪🇺", LCK: "🇰🇷", LPL: "🇨🇳", LCS: "🇺🇸", CBLOL: "🇧🇷" };

const ScoutingPage = ({ userTeam, onSignPlayer }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const [allPlayers, setAllPlayers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [majorLeague, setMajorLeague] = useState("ALL");
  const [subLeagueFilter, setSubLeagueFilter] = useState("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("rating");
  const [sortDir, setSortDir] = useState("desc");
  const [activeLeague, setActiveLeague] = useState("LEC");

  useEffect(() => {
    API_CLIENT.get("/game/state")
      .then(r => setActiveLeague(r.data.league || "LEC"))
      .catch(() => {});
    loadPlayers();
  }, []);

  const loadPlayers = async () => {
    try {
      const response = await API_CLIENT.get("/scouting/all");
      setAllPlayers(response.data);
    } catch (e) {
      console.error("Error loading scouting players:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async (player) => {
    try {
      const response = await API_CLIENT.post("/scouting/sign", {
        player_id: player.id,
        offered_salary: Math.round(player.transfer_value * 0.1)
      });
      if (response.data.success) {
        setAllPlayers(prev => prev.filter(p => p.id !== player.id));
        setSelectedPlayer(null);
        onSignPlayer && onSignPlayer(response.data.player);
      }
    } catch (e) {
      console.error("Error signing player:", e);
    }
  };

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  // Sub-leagues available for the selected major league
  const subLeagues = useMemo(() => {
    const base = majorLeague === "ALL"
      ? allPlayers
      : allPlayers.filter(p => p.scouting_for === majorLeague);
    const leagues = [...new Set(base.map(p => p.league).filter(Boolean))].sort();
    return ["ALL", ...leagues];
  }, [allPlayers, majorLeague]);

  // Reset sub-league when major changes
  const handleMajorLeague = (ml) => {
    setMajorLeague(ml);
    setSubLeagueFilter("ALL");
  };

  const filteredPlayers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    let list = allPlayers.filter(p => {
      if (positionFilter !== "ALL" && p.position !== positionFilter) return false;
      if (majorLeague !== "ALL" && p.scouting_for !== majorLeague) return false;
      if (subLeagueFilter !== "ALL" && p.league !== subLeagueFilter) return false;
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      const va = a[sortBy] ?? 0, vb = b[sortBy] ?? 0;
      return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [allPlayers, searchTerm, positionFilter, majorLeague, subLeagueFilter, sortBy, sortDir]);

  const getPotentialColor = (potential) => {
    if (potential >= 90) return "var(--success)";
    if (potential >= 80) return "var(--amber)";
    return "var(--text-2)";
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Lightning size={48} style={{ color: "var(--amber)" }} />
        <p>Chargement des talents...</p>
      </div>
    );
  }

  const cols = [
    { key: null,             label: "Joueur",     sortable: false },
    { key: "position",       label: "Pos",        sortable: false },
    { key: "age",            label: "Âge",        sortable: true  },
    { key: "rating",         label: "Rating",     sortable: true  },
    { key: "potential",      label: "Potentiel",  sortable: true  },
    { key: "league",         label: "Ligue",      sortable: false },
    { key: "transfer_value", label: "Coût",       sortable: true  },
  ];

  const SortIcon = ({ col }) => {
    if (!col.sortable) return null;
    if (sortBy !== col.key) return <span style={{ marginLeft: 4, opacity: 0.3 }}>↕</span>;
    return <span style={{ marginLeft: 4, color: "var(--accent)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="animate-slide-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 4 }}>
            Scouting — Toutes ligues
          </h2>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>
            {allPlayers.length} joueurs disponibles · Les joueurs internationaux coûtent 2× plus cher
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", fontSize: 12 }}>
          <Globe size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ color: "var(--text-2)" }}>Ligue active :</span>
          <span style={{ fontWeight: 700, color: LEAGUE_COLORS[activeLeague] || "var(--accent)" }}>{activeLeague}</span>
        </div>
      </div>

      {/* Major league tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
        <button
          className={majorLeague === "ALL" ? "btn-primary" : "btn-secondary"}
          onClick={() => handleMajorLeague("ALL")}
          style={{ padding: "6px 14px", fontSize: 12 }}
        >
          Toutes
        </button>
        {MAJOR_LEAGUES.map(ml => {
          const isActive = ml === activeLeague;
          const color = LEAGUE_COLORS[ml];
          const isSelected = majorLeague === ml;
          return (
            <button
              key={ml}
              onClick={() => handleMajorLeague(ml)}
              style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 700,
                border: `1px solid ${isSelected ? color : "var(--border)"}`,
                background: isSelected ? `${color}22` : "var(--surface-1)",
                color: isSelected ? color : "var(--text-2)",
                borderRadius: "var(--radius-xs)", cursor: "pointer",
                transition: "all 0.15s ease"
              }}
            >
              {LEAGUE_FLAGS[ml]} {ml}
              {isActive && <span style={{ marginLeft: 6, fontSize: 9, background: color, color: "#000", borderRadius: 2, padding: "1px 4px" }}>HOME</span>}
            </button>
          );
        })}
      </div>

      {/* Filters row */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Rechercher un joueur..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            background: "var(--surface-1)", border: "1px solid var(--border)",
            padding: "10px 14px", color: "var(--text-1)", borderRadius: "var(--radius-xs)", width: 220
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          {["ALL", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"].map(pos => (
            <button key={pos}
              className={positionFilter === pos ? "btn-primary" : "btn-secondary"}
              onClick={() => setPositionFilter(pos)}
              style={{ padding: "6px 10px", fontSize: 11 }}
            >
              {pos === "ALL" ? "Tous" : pos}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-league filter (only when major league is selected) */}
      {majorLeague !== "ALL" && subLeagues.length > 2 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {subLeagues.map(sl => (
            <button key={sl}
              onClick={() => setSubLeagueFilter(sl)}
              style={{
                padding: "4px 10px", fontSize: 11, borderRadius: 2, cursor: "pointer",
                border: `1px solid ${subLeagueFilter === sl ? LEAGUE_COLORS[majorLeague] : "var(--border)"}`,
                background: subLeagueFilter === sl ? `${LEAGUE_COLORS[majorLeague]}22` : "var(--surface-1)",
                color: subLeagueFilter === sl ? LEAGUE_COLORS[majorLeague] : "var(--text-2)",
                borderRadius: "var(--radius-xs)",
              }}
            >
              {sl === "ALL" ? "Toutes sous-ligues" : sl}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 50px 70px 90px 100px 100px", padding: "10px 16px", background: "var(--bg)", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, textTransform: "uppercase", color: "var(--text-2)", fontSize: 12 }}>
          {cols.map(col => (
            <span key={col.label}
              onClick={col.sortable ? () => handleSort(col.key) : undefined}
              style={{ cursor: col.sortable ? "pointer" : "default", userSelect: "none", display: "flex", alignItems: "center" }}
            >
              {col.label}<SortIcon col={col} />
            </span>
          ))}
        </div>

        {filteredPlayers.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-2)" }}>
            Aucun joueur trouvé
          </div>
        ) : filteredPlayers.map(player => {
          const imgUrl = playerImages[player.name.toLowerCase()];
          const isIntl = player.international;
          const leagueColor = LEAGUE_COLORS[player.scouting_for] || "var(--text-2)";
          const displayCost = isIntl ? player.transfer_value * 2 : player.transfer_value;

          return (
            <motion.div key={player.id}
              style={{
                display: "grid", gridTemplateColumns: "1fr 60px 50px 70px 90px 100px 100px",
                padding: "10px 16px", borderBottom: "1px solid var(--border)",
                alignItems: "center", cursor: "pointer",
                borderLeft: isIntl ? `2px solid ${leagueColor}` : "2px solid transparent"
              }}
              whileHover={{ background: "var(--surface-2)" }}
              onClick={() => setSelectedPlayer(player)}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
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
              <span className="font-stats" style={{ fontWeight: 700, color: "var(--accent)" }}>{player.rating}</span>
              <span className="font-stats" style={{ fontWeight: 700, color: getPotentialColor(player.potential) }}>
                {player.potential}{player.potential >= 90 && <Star size={12} weight="fill" style={{ marginLeft: 4 }} />}
              </span>
              <span style={{ fontSize: 11 }}>
                <span style={{ color: leagueColor, fontWeight: 700, fontSize: 10 }}>{player.scouting_for}</span>
                <span style={{ color: "var(--text-2)", marginLeft: 4 }}>{player.league}</span>
              </span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="font-stats" style={{ color: isIntl ? "var(--amber)" : "var(--text-2)", fontWeight: isIntl ? 700 : 400 }}>
                  {formatMoney(displayCost)}
                </span>
                {isIntl && <span style={{ fontSize: 9, color: leagueColor }}>intl ×2</span>}
              </span>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedPlayer && (() => {
          const sp = selectedPlayer;
          const displayCost = sp.international ? sp.transfer_value * 2 : sp.transfer_value;
          const canAfford = displayCost <= userTeam.budget;
          const leagueColor = LEAGUE_COLORS[sp.scouting_for] || "var(--accent)";
          return (
            <PlayerDetailModal
              player={sp}
              onClose={() => setSelectedPlayer(null)}
              actions={
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sp.international && (
                    <div style={{ padding: "8px 12px", background: `${leagueColor}18`, border: `1px solid ${leagueColor}55`, borderRadius: 3, fontSize: 12, color: leagueColor }}>
                      <strong>Joueur international</strong> ({sp.scouting_for}) — coût ×2 : {formatMoney(displayCost)} EUR
                    </div>
                  )}
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
                </div>
              }
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default ScoutingPage;
