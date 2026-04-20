import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { X, Shield } from "@phosphor-icons/react";
import axios from "axios";
import { API } from "../shared";
import { _ddVersion, toDDragonKey, setDdVersion } from "./ddHelpers";

// Draft System Component
/**
 * DraftSystem — utilisable en solo ET en multijoueur.
 *
 * Mode solo (défaut) : appelle /draft/start, /draft/suggest, /draft/action.
 * Mode MP : passer onMpAction(champion, actionType) → gère l'action côté MP.
 *           passer mpDraftState → état extérieur (mis à jour par WS).
 *           passer mpMyTurn (bool) → indique si c'est notre tour.
 *           passer mpLabel → label affiché dans le header.
 */
const DraftSystem = ({ champions, matchId, onComplete, onCancel, onMpAction, mpDraftState, mpMyTurn, mpLabel }) => {
  const [draftState, setDraftState] = useState(null);
  const [selectedChampion, setSelectedChampion] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [posFilter, setPosFilter] = useState("ALL");
  const [ddVersion, setDdVersionState] = useState("16.7.1");
  const [prevSplitStats, setPrevSplitStats] = useState({});  // {champName: {pick_rate, ban_rate, win_rate}}
  const [apiSuggestions, setApiSuggestions] = useState([]);
  const completeTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    fetch("https://ddragon.leagueoflegends.com/api/versions.json", { signal: controller.signal })
      .then(r => r.json())
      .then(versions => {
        if (!mountedRef.current) return;
        if (versions[0]) { setDdVersionState(versions[0]); setDdVersion(versions[0]); }
      })
      .catch(() => {});
    // Load last split's champion stats for overlay
    axios.get(API + "/stats/champions", { params: { split: "last" }, signal: controller.signal })
      .then(r => {
        if (!mountedRef.current) return;
        const map = {};
        (r.data.champions || []).forEach(c => { map[c.name] = c; });
        setPrevSplitStats(map);
      }).catch(() => {});
    return () => {
      mountedRef.current = false;
      controller.abort();
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    startDraft();
  }, []);

  const startDraft = async () => {
    // En mode MP, l'état vient de l'extérieur (mpDraftState) — pas besoin de /draft/start
    if (onMpAction) return;
    try {
      const response = await axios.post(API + "/draft/start", matchId ? { match_id: matchId } : {});
      setDraftState(response.data);
      if (response.data.current_turn === "user") fetchSuggestions();
    } catch (e) {
      console.error("Error starting draft:", e);
    }
  };

  const fetchSuggestions = async () => {
    try {
      const res = await axios.get(API + "/draft/suggest");
      if (res.data.action && res.data.action !== "enemy_turn") {
        setApiSuggestions(res.data.suggestions || []);
      } else {
        setApiSuggestions([]);
      }
    } catch {
      setApiSuggestions([]);
    }
  };

  const performAction = async (action, champion, position = null) => {
    // Mode MP : délègue à onMpAction, l'état arrive par WS
    if (onMpAction) {
      setSelectedChampion(null);
      setSelectedPosition(null);
      await onMpAction(champion, action);
      return;
    }
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
        completeTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) onComplete(response.data);
        }, 1000);
      } else if (response.data.current_turn === "user") {
        fetchSuggestions();
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
    if (draftState.banned_champions.includes(champion)) return true;
    if (draftState.user_picked_champions.includes(champion)) return true;
    if (draftState.enemy_picked_champions.includes(champion)) return true;
    return false;
  };

  const isFearless = (champion) => {
    if (!draftState?.fearless_excluded) return false;
    return draftState.fearless_excluded.includes(champion);
  };

  // En mode MP, l'état vient de mpDraftState (WS) ; en solo, de l'état local
  const activeDraftState = onMpAction ? mpDraftState : draftState;

  // Convertir mpDraftState (format MP) vers le format solo attendu par le rendu
  const normalizedDraftState = (() => {
    if (!onMpAction) return activeDraftState;
    if (!mpDraftState) return null;
    // mpDraftState a : bans[1/2], picks[1/2], sequence, step, completed
    // On détermine notre side à partir de mpMyTurn et sequence
    const seq = mpDraftState.sequence || [];
    const step = mpDraftState.step || 0;
    const currentAction = step < seq.length ? seq[step] : null;
    const isBan = currentAction?.[0] === "ban";
    // Reconstituer un état compatible avec le rendu solo
    // user = notre équipe, enemy = adversaire
    const myKey = mpDraftState._mySide || 1;
    const oppKey = myKey === 1 ? 2 : 1;
    const bansMe = mpDraftState.bans?.[myKey] || mpDraftState.bans?.[String(myKey)] || [];
    const bansOpp = mpDraftState.bans?.[oppKey] || mpDraftState.bans?.[String(oppKey)] || [];
    const picksMe = (mpDraftState.picks?.[myKey] || mpDraftState.picks?.[String(myKey)] || []).map(c => ({ champion: c }));
    const picksOpp = (mpDraftState.picks?.[oppKey] || mpDraftState.picks?.[String(oppKey)] || []).map(c => ({ champion: c }));
    return {
      phase: mpDraftState.completed ? "complete" : (isBan ? "ban_phase" : "pick_phase"),
      step,
      current_turn: mpMyTurn ? "user" : "enemy",
      user_bans: bansMe,
      enemy_bans: bansOpp,
      user_picks: picksMe,
      enemy_picks: picksOpp,
      banned_champions: [...bansMe, ...bansOpp],
      user_picked_champions: picksMe.map(p => p.champion),
      enemy_picked_champions: picksOpp.map(p => p.champion),
      fearless_excluded: [],
    };
  })();

  const currentPhase = normalizedDraftState?.phase || "loading";
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

  const suggestions = apiSuggestions;

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

  // Limit DOM nodes in "ALL" mode to avoid rendering 200+ items at once
  const GRID_LIMIT = 120;
  const visibleChampions = posFilter === "ALL" ? filteredChampions.slice(0, GRID_LIMIT) : filteredChampions;
  const hiddenCount = filteredChampions.length - visibleChampions.length;

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ overflow: "auto" }}
    >
      <motion.div
        style={{
          background: "var(--bg)",
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
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              Tour {(draftState?.step ?? 0) + 1}/20 —{" "}
              <span style={{ color: draftState?.current_turn === "user" ? "var(--accent)" : "var(--danger)", fontWeight: 600 }}>
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
            <h3 style={{ color: "var(--accent)", marginBottom: 12, fontSize: 14 }}>VOTRE EQUIPE</h3>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>BANS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const name = draftState?.user_bans[i];
                return (
                  <div key={i} style={{
                    background: name ? "rgba(255,51,102,0.2)" : "var(--surface-1)",
                    border: "1px solid " + (name ? "var(--danger)" : "var(--border)"),
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
              <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>PICKS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const pick = draftState?.user_picks[i];
                const name = pick?.champion;
                return (
                  <div key={i} style={{
                    background: name ? "rgba(10,132,255,0.2)" : "var(--surface-1)",
                    border: "1px solid " + (name ? "var(--accent)" : "var(--border)"),
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
            {/* Suggestions bar — delta-scored by backend */}
            {suggestions.length > 0 && draftState?.current_turn === "user" && (
              <div style={{ marginBottom: 10, padding: "8px 10px", background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.22)", borderRadius: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--amber)", marginBottom: 6 }}>
                  {isBanPhase ? "⚡ À bannir" : "✦ Meilleurs picks"}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {suggestions.map((s, i) => {
                    const name = s.champion;
                    const pos = s.position || null;
                    const ddKey = toDDragonKey(name);
                    const isSelected = selectedChampion === name;
                    const meta = allChampionsDeduped.find(c => c.name === name) || {};
                    const score = s.score ?? 0;
                    const compGain = s.comp_gain;
                    return (
                      <div
                        key={name + i}
                        onClick={() => { setSelectedChampion(name); setSelectedPosition(pos); }}
                        title={s.reason || ""}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "5px 8px 5px 4px",
                          background: isSelected ? "rgba(255,184,0,0.18)" : "var(--surface-1)",
                          border: "1px solid " + (isSelected ? "var(--amber)" : i === 0 ? "rgba(255,184,0,0.5)" : "var(--border)"),
                          borderRadius: 3, cursor: "pointer",
                          transition: "all 0.12s ease",
                          minWidth: 110
                        }}
                      >
                        <img
                          src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${ddKey}.png`}
                          alt={name}
                          onError={e => { e.currentTarget.style.display = "none"; }}
                          style={{ width: 30, height: 30, borderRadius: 2, objectFit: "cover", flexShrink: 0 }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" }}>{name}</div>
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            {pos && <span style={{ fontSize: 9, color: "var(--text-2)" }}>{pos}</span>}
                            <span style={{ fontSize: 9, fontWeight: 800, color: tierColor(meta.tier || "C") }}>{meta.tier || ""}</span>
                          </div>
                          <div style={{ fontSize: 9, color: score >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>
                            Δ{score >= 0 ? "+" : ""}{score}
                            {compGain != null && <span style={{ color: "var(--text-2)", fontWeight: 400 }}> · comp+{compGain.toFixed(1)}</span>}
                          </div>
                          {s.reason && (
                            <div style={{ fontSize: 8, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>
                              {s.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
              gap: 6,
              flex: 1,
              overflow: "auto",
              padding: 8,
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 2
            }}>
              {visibleChampions.map(champ => {
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
                                  unavailable? "rgba(255,51,102,0.1)" : "var(--surface-2)",
                      border: "2px solid " + (selected    ? "var(--amber)" :
                                              fearless    ? "#FF8C00" :
                                              unavailable ? "var(--danger)" : "var(--border)"),
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
                      loading="lazy"
                      onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "block"; }}
                      style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 2, display: "block", margin: "0 auto 2px" }}
                    />
                    <Shield size={18} style={{ marginBottom: 2, color: tierColor(champ.tier), display: "none" }} />
                    <div style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.2 }}>{champ.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-2)" }}>{champ.position}</div>
                    {prev ? (
                      <div style={{ fontSize: 8, marginTop: 2 }}>
                        <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                          <span style={{ color: prev.win_rate >= 55 ? "var(--success)" : prev.win_rate <= 45 ? "var(--danger)" : "var(--text-1)", fontWeight: 700 }}>
                            {prev.win_rate}%WR
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", gap: 4, color: "var(--text-2)" }}>
                          <span>{prev.pick_rate}%P</span>
                          <span>{prev.ban_rate}%B</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 8, marginTop: 2, display: "flex", justifyContent: "center", gap: 6 }}>
                        <span style={{ color: champ.winrate >= 50 ? "var(--success)" : "var(--danger)" }}>
                          {champ.winrate?.toFixed(0) || 0}%
                        </span>
                        <span style={{ color: "var(--text-2)" }}>
                          {champ.picks || 0}P/{champ.bans || 0}B
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <div style={{ textAlign: "center", padding: "6px 0", fontSize: 11, color: "var(--text-2)" }}>
                +{hiddenCount} champions — utilisez un filtre par position pour les afficher
              </div>
            )}
          </div>

          {/* Enemy Team */}
          <div style={{ width: 180, flexShrink: 0 }}>
            <h3 style={{ color: "var(--danger)", marginBottom: 12, fontSize: 14 }}>ADVERSAIRE</h3>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>BANS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const name = draftState?.enemy_bans[i];
                return (
                  <div key={i} style={{
                    background: name ? "rgba(255,51,102,0.2)" : "var(--surface-1)",
                    border: "1px solid " + (name ? "var(--danger)" : "var(--border)"),
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
              <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>PICKS</div>
              {[0, 1, 2, 3, 4].map(i => {
                const pick = draftState?.enemy_picks[i];
                const name = pick?.champion;
                return (
                  <div key={i} style={{
                    background: name ? "rgba(10,132,255,0.2)" : "var(--surface-1)",
                    border: "1px solid " + (name ? "var(--accent)" : "var(--border)"),
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
