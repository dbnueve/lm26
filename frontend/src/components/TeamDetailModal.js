import React, { useState, useEffect,useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { API,PlayerImagesContext } from "../shared";
import TeamLogo from "./TeamLogo";
import PlayerDetailModal from "./PlayerDetailModal";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// Team Detail Modal
const TeamDetailModal = ({ team, onClose }) => {
  const [teamData, setTeamData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const playerImages = useContext(PlayerImagesContext) || {};
  useEffect(() => {
    axios.get(API + "/teams/" + team.id).then(r => setTeamData(r.data)).catch(() => {});
  }, [team.id]);

  const positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
  const posColor = { TOP: "#e74c3c", JUNGLE: "#27ae60", MID: "#3498db", ADC: "#e67e22", SUPPORT: "#9b59b6" };

  // Use fetched data for wins/losses (available from /teams/{id}) or fall back to prop
  const wins = teamData?.wins ?? team.wins ?? 0;
  const losses = teamData?.losses ?? team.losses ?? 0;
  const rating = teamData?.rating ?? team.rating;
  const qualified = teamData?.qualified ?? team.qualified;
  const elo = teamData?.elo ?? team.elo ?? 0;
  const totalGames = wins + losses;
  const winRate = totalGames > 0 ? Math.round(wins / totalGames * 100) : 0;

  if (selectedPlayer) {
    return (
      <AnimatePresence>
        <PlayerDetailModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      </AnimatePresence>
    );
  }

  return (
    <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        style={{ background: "var(--bg-dark)", width: "95%", maxWidth: 680, maxHeight: "90vh", overflow: "auto", borderRadius: 4 }}
      >
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, var(--surface), var(--bg-dark))", padding: "24px 24px 16px", borderBottom: "1px solid var(--border-subtle)", position: "relative" }}>
          
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 20 }}>✕</button>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <TeamLogo teamId={team.id} abbr={team.abbr || (teamData?.abbr)} size={64} noClick />
            <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
    <div>
      <div className="font-heading" style={{ fontSize: 28, lineHeight: 1.2 }}>
        {team.name || teamData?.name || team.abbr}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
        {team.abbr || teamData?.abbr}
      </div>
      {qualified && (
        <span style={{ background: "var(--success)", color: "black", padding: "2px 8px", fontSize: 10, fontWeight: 700, borderRadius: 2, marginTop: 6, display: "inline-block" }}>
          PLAYOFFS
        </span>
      )}
    </div>

    {/* L'Elo aligné à droite du nom */}
    <div style={{ textAlign: "right", marginRight: 40, }}> {/* marginRight pour ne pas coller au bouton X */}
      <div style={{ fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>Elo</div>
      <div className="font-stats" style={{ fontSize: 24, fontWeight: 800, color: "var(--primary)" }}>
        {elo}
      </div>
    </div>
  </div>
          </div>

          {/* Key stats bar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 20 }}>
            {[
              { label: "Victoires", value: wins, color: "var(--success)" },
              { label: "Défaites", value: losses, color: "var(--danger)" },
              { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? "var(--success)" : "var(--danger)" },
              { label: "Rating", value: rating || "—", color: "var(--primary)" },
              
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 2, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
                <div className="font-stats" style={{ fontWeight: 700, fontSize: 20, color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Roster */}
        <div style={{ padding: 24 }}>
  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 12 }}>
    Composition
  </div>
  {!teamData ? (
    <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>Chargement...</div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {positions.map(pos => {
        const player = (teamData?.players || []).find(p => p.position === pos);
        if (!player) return null;
        const imageUrl = playerImages[player.name.toLowerCase()];
        return (
          <div
            key={pos}
            onClick={() => setSelectedPlayer(player)}
            style={{
              // Modification de la grille : Pos(80px), Img(40px), Nom(1fr), Rating(50px), AvgPerf(70px), Potentiel(70px), Contrat(70px)
              display: "grid", 
              gridTemplateColumns: "80px 40px 1fr 50px 70px 70px 70px",
              alignItems: "center", 
              gap: 12, 
              padding: "8px 14px",
              background: "var(--surface)", 
              borderRadius: 3,
              border: "1px solid var(--border-subtle)",
              cursor: "pointer", 
              transition: "border-color 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--primary)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-subtle)"}
          >
            {/* 1. POSITION */}
            <span style={{ background: posColor[pos] || "var(--surface)", color: "white", padding: "2px 8px", borderRadius: 2, fontSize: 10, fontWeight: 700, textAlign: "center" }}>
              {pos}
            </span>

           {/* AVATAR BOX */}
            <div style={{ 
              width: 40, height: 40, borderRadius: "50%", background: "var(--bg-dark)", 
              border: "1px solid var(--border-subtle)", display: "flex", 
              alignItems: "center", justifyContent: "center", overflow: "hidden" 
            }}>
              {imageUrl ? (
                <img 
                  src={imageUrl} 
                  alt={player.name} 
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                  onError={e => { 
                    e.currentTarget.style.display = "none"; 
                    e.currentTarget.parentNode.textContent = player.name.substring(0, 2).toUpperCase(); 
                  }} 
                />
              ) : (
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>
                  {player.name.substring(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            {/* 3. NOM */}
            <span style={{ fontWeight: 600, fontSize: 14 }}>{player.name}</span>

            {/* 4. NOTE (Rating) */}
           <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", textTransform: "uppercase" }}>Rating</div>
              <div className="font-stats" style={{ fontWeight: 700, fontSize: 13 ,color: "var(--primary)"}}>
                {player.rating || "—"}
              </div>
            </div>

            {/* 5. AVG PERF (Remplacement KDA/CS par une valeur de perf moyenne) */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", textTransform: "uppercase" }}>Avg Perf</div>
              <div className="font-stats" style={{ fontWeight: 700, fontSize: 13 }}>
                {player.avg_perf || "—"}
              </div>
            </div>

            {/* 6. POTENTIEL */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", textTransform: "uppercase" }}>Potentiel</div>
              <div className="font-stats" style={{ fontWeight: 700, fontSize: 13, color: player.potential >= 90 ? "var(--secondary)" : "var(--text-primary)" }}>
                {player.potential}
              </div>
            </div>

            {/* 7. CONTRACT YEARS */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", textTransform: "uppercase" }}>Contrat</div>
              <div className="font-stats" style={{ fontWeight: 700, fontSize: 13 }}>
                {player.contract_years || 1}y
              </div>
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
        {/* Champion Stats */}
        {teamData?.champion_stats && (
          (teamData.champion_stats.picks?.length > 0 || teamData.champion_stats.bans?.length > 0) && (
            <div style={{ padding: "0 24px 24px" }}>

              {/* Picks */}
              {teamData.champion_stats.picks?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 10 }}>
                    Picks
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "0 12px", alignItems: "center" }}>
                    {/* Header */}
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)" }} />
                    {["WR", "Games"].map(h => (
                      <div key={h} style={{ fontSize: 10, color: "var(--text-secondary)", textAlign: "right", paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)", fontWeight: 700 }}>{h}</div>
                    ))}
                    <div style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6 }} />
                    {/* Rows */}
                    {teamData.champion_stats.picks.map((c, i) => {
                      const key = toDDragonKey(c.name);
                      const maxPicks = teamData.champion_stats.picks[0]?.picks || 1;
                      const barPct = Math.round((c.picks / maxPicks) * 100);
                      const wrColor = c.wr >= 55 ? "var(--success)" : c.wr <= 45 ? "var(--danger)" : "var(--text-primary)";
                      return (
                        <React.Fragment key={i}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${key}.png`}
                              alt={c.name}
                              style={{ width: 28, height: 28, borderRadius: 4, flexShrink: 0 }}
                              onError={e => { e.currentTarget.style.opacity = "0"; }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                              <div style={{ height: 4, background: "var(--border-subtle)", borderRadius: 2, marginTop: 3 }}>
                                <div style={{ width: `${barPct}%`, height: "100%", background: "var(--primary)", borderRadius: 2 }} />
                              </div>
                            </div>
                          </div>
                          <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13, color: wrColor }}>{c.wr}%</div>
                          <div style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)" }}>{c.picks}</div>
                          <div style={{ display: "none" }} />
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bans */}
              {teamData.champion_stats.bans?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-secondary)", marginBottom: 10 }}>
                    Bans
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "0 12px", alignItems: "center" }}>
                    {/* Header */}
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)" }} />
                    {[{ label: "Blue", color: "#60a5fa" }, { label: "Red", color: "#f87171" }, { label: "Total", color: "var(--text-secondary)" }].map(h => (
                      <div key={h.label} style={{ fontSize: 10, color: h.color, textAlign: "right", paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)", fontWeight: 700 }}>{h.label}</div>
                    ))}
                    {/* Rows */}
                    {teamData.champion_stats.bans.map((c, i) => {
                      const key = toDDragonKey(c.name);
                      return (
                        <React.Fragment key={i}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${key}.png`}
                              alt={c.name}
                              style={{ width: 28, height: 28, borderRadius: 4, flexShrink: 0, filter: "grayscale(60%)" }}
                              onError={e => { e.currentTarget.style.opacity = "0"; }}
                            />
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                          </div>
                          <div style={{ textAlign: "right", fontSize: 13, color: "#60a5fa", fontWeight: 600 }}>{c.blue}</div>
                          <div style={{ textAlign: "right", fontSize: 13, color: "#f87171", fontWeight: 600 }}>{c.red}</div>
                          <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700 }}>{c.total}</div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        )}

      </motion.div>
    </motion.div>
  );
};

export default TeamDetailModal;
