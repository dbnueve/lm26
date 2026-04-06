import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { X, Shield } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import { _ddVersion, toDDragonKey, setDdVersion } from "./ddHelpers";

// Draft System Component
const DraftSystem = ({ champions, matchId, onComplete, onCancel }) => {
  const [draftState, setDraftState] = useState(null);
  const [selectedChampion, setSelectedChampion] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [posFilter, setPosFilter] = useState("ALL");
  const [ddVersion, setDdVersionState] = useState("16.7.1");
  const [prevSplitStats, setPrevSplitStats] = useState({});  // {champName: {pick_rate, ban_rate, win_rate}}

  useEffect(() => {
    fetch("https://ddragon.leagueoflegends.com/api/versions.json")
      .then(r => r.json())
      .then(versions => { if (versions[0]) { setDdVersionState(versions[0]); setDdVersion(versions[0]); } })
      .catch(() => {});
    // Load last split's champion stats for overlay
    axios.get(API + "/stats/champions", { params: { split: "last" } })
      .then(r => {
        const map = {};
        (r.data.champions || []).forEach(c => { map[c.name] = c; });
        setPrevSplitStats(map);
      }).catch(() => {});
  }, []);

  useEffect(() => {
    startDraft();
  }, []);

  const startDraft = async () => {
    try {
      const response = await axios.post(API + "/draft/start", matchId ? { match_id: matchId } : {});
      setDraftState(response.data);
    } catch (e) {
      console.error("Error starting draft:", e);
    }
  };

  const performAction = async (action, champion, position = null) => {
    try {
      const url = API + "/draft/action";
      const response = await axios.post(url, {
        action,
        champion,
        position
      });
      setDraftState(response.data);
      setSelectedChampion(null);
      setSelectedPosition(null);

      if (response.data.phase === "complete") {
        setTimeout(() => onComplete(response.data), 1000);
      }
    } catch (e) {
      console.error("Error in draft:", e);
    }
  };

  // Build deduplicated champion list (champions can appear in multiple positions)
  // When "ALL" filter: one card per champion (highest picks wins). When position filter: all for that position.
  const allChampionsDeduped = useMemo(() => {
    const seen = new Map();
    for (const [pos, champs] of Object.entries(champions)) {
      for (const c of (Array.isArray(champs) ? champs : [])) {
        const entry = typeof c === "string"
          ? { name: c, position: pos, picks: 0, bans: 0, winrate: 0, tier: "C" }
          : { ...c, position: pos };
        const existing = seen.get(entry.name);
        if (!existing || entry.picks > existing.picks) seen.set(entry.name, entry);
      }
    }
    return Array.from(seen.values());
  }, [champions]);

  const isUnavailable = (champion) => {
    if (!draftState) return false;
    // Banned by anyone
    if (draftState.banned_champions.includes(champion)) return true;
    // Cannot pick from enemy team (their picks are now owned)
    const myTeamPicks = draftState.current_turn === "user"
      ? draftState.user_picked_champions
      : draftState.enemy_picked_champions;
    // Cannot pick my own team (already picked)
    if (myTeamPicks.includes(champion)) return true;
    return false;
  };

  const isFearless = (champion) => {
    if (!draftState?.fearless_excluded) return false;
    return draftState.fearless_excluded.includes(champion);
  };

  const currentPhase = draftState?.phase || "loading";
  const isBanPhase = currentPhase.includes("ban");

  const tierColor = (tier) => {
    switch(tier) {
      case "S": return "#FF4655";
      case "A": return "#FFB800";
      case "B": return "#4FC3F7";
      case "C": return "#666";
      default: return "#666";
    }
  };

  const tierOrder = { "S": 0, "A": 1, "B": 2, "C": 3 };
  const filteredChampions = useMemo(() => {
    let list;
    if (posFilter === "ALL") {
      list = allChampionsDeduped;
    } else {
      list = (Array.isArray(champions[posFilter]) ? champions[posFilter] : []).map(c =>
        typeof c === "string"
          ? { name: c, position: posFilter, picks: 0, bans: 0, winrate: 0, tier: "C" }
          : { ...c, position: posFilter }
      );
    }
    return [...list].sort((a, b) => (tierOrder[a.tier] ?? 4) - (tierOrder[b.tier] ?? 4));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChampionsDeduped, champions, posFilter]);

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ overflow: "auto" }}
    >
      <motion.div
        style={{
          background: "var(--bg-dark)",
          width: "95%",
          maxWidth: 1400,
          padding: 24,
          borderRadius: 4,
          margin: "20px auto",
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column"
        }}
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h2 className="font-heading" style={{ fontSize: 28, marginBottom: 4 }}>
              Phase de Draft - {isBanPhase ? "BANS" : "PICKS"}
            </h2>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Tour {(draftState?.step ?? 0) + 1}/20 —{" "}
              <span style={{ color: draftState?.current_turn === "user" ? "var(--primary)" : "var(--danger)", fontWeight: 600 }}>
                {draftState?.current_turn === "user" ? "Votre tour" : "Tour adversaire"}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {selectedChampion && draftState?.current_turn === "user" && (
              <button
                className="btn-primary"
                onClick={() => performAction(isBanPhase ? "ban" : "pick", selectedChampion, selectedPosition)}
                data-testid="confirm-draft-action"
                style={{ padding: "12px 24px" }}
              >
                {isBanPhase ? "Bannir" : "Pick"} {selectedChampion}
              </button>
            )}
            <button
              onClick={onCancel}
              className="btn-secondary"
              style={{ padding: "12px 16px" }}
            >
              <X size={20} /> Fermer
            </button>
          </div>
        </div>

        {/* Main Draft Area */}
        <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
          {/* Your Team */}
          <div style={{ width: 180, flexShrink: 0 }}>
            <h3 style={{ color: "var(--primary)", marginBottom: 12, fontSize: 14 }}>VOTRE EQUIPE</h3>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>BANS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const name = draftState?.user_bans[i];
                return (
                  <div key={i} style={{
                    background: name ? "rgba(255,51,102,0.2)" : "var(--surface)",
                    border: "1px solid " + (name ? "var(--danger)" : "var(--border-subtle)"),
                    padding: "4px 8px", marginBottom: 4, borderRadius: 2,
                    fontSize: 12, display: "flex", alignItems: "center", gap: 6
                  }}>
                    {name && <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${toDDragonKey(name)}.png`} alt={name} style={{ width: 24, height: 24, borderRadius: 2 }} onError={e => { e.currentTarget.style.display = "none"; }} />}
                    {name || "-"}
                  </div>
                );
              })}
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>PICKS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const pick = draftState?.user_picks[i];
                const name = pick?.champion;
                return (
                  <div key={i} style={{
                    background: name ? "rgba(10,132,255,0.2)" : "var(--surface)",
                    border: "1px solid " + (name ? "var(--primary)" : "var(--border-subtle)"),
                    padding: "4px 8px", marginBottom: 4, borderRadius: 2,
                    fontSize: 12, display: "flex", alignItems: "center", gap: 6
                  }}>
                    {name && <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${toDDragonKey(name)}.png`} alt={name} style={{ width: 24, height: 24, borderRadius: 2 }} onError={e => { e.currentTarget.style.display = "none"; }} />}
                    {name || "-"}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Champion Grid */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {["ALL"].concat(Object.keys(champions)).map(pos => (
                <button
                  key={pos}
                  className={posFilter === pos ? "btn-primary" : "btn-secondary"}
                  onClick={() => setPosFilter(pos)}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                >
                  {pos}
                </button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, fontSize: 10 }}>
                <span style={{ color: "#FF4655" }}>S-Tier</span>
                <span style={{ color: "#FFB800" }}>A-Tier</span>
                <span style={{ color: "#4FC3F7" }}>B-Tier</span>
                <span style={{ color: "#666" }}>C-Tier</span>
              </div>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
              gap: 6,
              flex: 1,
              overflow: "auto",
              padding: 8,
              background: "var(--surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 2
            }}>
              {filteredChampions.map(champ => {
                const ddKey = toDDragonKey(champ.name);
                const imgUrl = `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${ddKey}.png`;
                const unavailable = isUnavailable(champ.name);
                const fearless  = isFearless(champ.name);
                const blocked   = unavailable || fearless;
                const selected  = selectedChampion === champ.name;
                const prev = prevSplitStats[champ.name];
                return (
                  <div
                    key={champ.name}
                    onClick={() => { if (!blocked) { setSelectedChampion(champ.name); setSelectedPosition(champ.position || null); } }}
                    data-testid={"champion-" + champ.name.replace(/'/g, "")}
                    style={{
                      background: selected   ? "rgba(255,184,0,0.2)"  :
                                  fearless   ? "rgba(255,140,0,0.08)" :
                                  unavailable? "rgba(255,51,102,0.1)" : "var(--surface-hover)",
                      border: "2px solid " + (selected    ? "var(--secondary)" :
                                              fearless    ? "#FF8C00" :
                                              unavailable ? "var(--danger)" : "var(--border-subtle)"),
                      padding: "6px 4px",
                      textAlign: "center",
                      cursor: blocked ? "not-allowed" : "pointer",
                      opacity: blocked ? 0.4 : 1,
                      borderRadius: 2,
                      transition: "all 0.15s ease",
                      borderTop: "3px solid " + tierColor(champ.tier),
                      position: "relative"
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 2, right: 4,
                      fontSize: 8, fontWeight: 800,
                      color: tierColor(champ.tier)
                    }}>
                      {champ.tier}
                    </div>
                    {fearless && (
                      <div style={{
                        position: "absolute", top: 2, left: 3,
                        fontSize: 7, fontWeight: 800, color: "#FF8C00",
                        background: "rgba(0,0,0,0.7)", padding: "1px 3px", borderRadius: 2,
                        letterSpacing: 0.5,
                      }}>
                        FS
                      </div>
                    )}
                    <img
                      src={imgUrl}
                      alt={champ.name}
                      onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "block"; }}
                      style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 2, display: "block", margin: "0 auto 2px" }}
                    />
                    <Shield size={18} style={{ marginBottom: 2, color: tierColor(champ.tier), display: "none" }} />
                    <div style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.2 }}>{champ.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-secondary)" }}>{champ.position}</div>
                    {prev ? (
                      <div style={{ fontSize: 8, marginTop: 2 }}>
                        <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                          <span style={{ color: prev.win_rate >= 55 ? "var(--success)" : prev.win_rate <= 45 ? "var(--danger)" : "var(--text-primary)", fontWeight: 700 }}>
                            {prev.win_rate}%WR
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", gap: 4, color: "var(--text-secondary)" }}>
                          <span>{prev.pick_rate}%P</span>
                          <span>{prev.ban_rate}%B</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 8, marginTop: 2, display: "flex", justifyContent: "center", gap: 6 }}>
                        <span style={{ color: champ.winrate >= 50 ? "var(--success)" : "var(--danger)" }}>
                          {champ.winrate?.toFixed(0) || 0}%
                        </span>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {champ.picks || 0}P/{champ.bans || 0}B
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Enemy Team */}
          <div style={{ width: 180, flexShrink: 0 }}>
            <h3 style={{ color: "var(--danger)", marginBottom: 12, fontSize: 14 }}>ADVERSAIRE</h3>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>BANS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const name = draftState?.enemy_bans[i];
                return (
                  <div key={i} style={{
                    background: name ? "rgba(255,51,102,0.2)" : "var(--surface)",
                    border: "1px solid " + (name ? "var(--danger)" : "var(--border-subtle)"),
                    padding: "4px 8px", marginBottom: 4, borderRadius: 2,
                    fontSize: 12, display: "flex", alignItems: "center", gap: 6
                  }}>
                    {name && <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${toDDragonKey(name)}.png`} alt={name} style={{ width: 24, height: 24, borderRadius: 2 }} onError={e => { e.currentTarget.style.display = "none"; }} />}
                    {name || "-"}
                  </div>
                );
              })}
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>PICKS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const pick = draftState?.enemy_picks[i];
                const name = pick?.champion;
                return (
                  <div key={i} style={{
                    background: name ? "rgba(10,132,255,0.2)" : "var(--surface)",
                    border: "1px solid " + (name ? "var(--primary)" : "var(--border-subtle)"),
                    padding: "4px 8px", marginBottom: 4, borderRadius: 2,
                    fontSize: 12, display: "flex", alignItems: "center", gap: 6
                  }}>
                    {name && <img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${toDDragonKey(name)}.png`} alt={name} style={{ width: 24, height: 24, borderRadius: 2 }} onError={e => { e.currentTarget.style.display = "none"; }} />}
                    {name || "-"}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default DraftSystem;
