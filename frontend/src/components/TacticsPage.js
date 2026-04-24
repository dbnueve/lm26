import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Sword, Lightning, TreeStructure, ArrowsLeftRight,
  Shield, Target, ArrowUp, ArrowDown, ArrowRight,
  Crosshair, CurrencyDollar, Flag, Eye, MapTrifold,
  Users, Robot, CheckCircle, XCircle, Spinner
} from "@phosphor-icons/react";
import { API_CLIENT, PlayerImagesContext } from "../shared";
import TeamLogo from "./TeamLogo";
import { _ddVersion, toDDragonKey } from "./ddHelpers";

// ── Player avatar (même logique que PlayerCard) ───────────────────────────────
const PlayerAvatar = ({ name, size = 40 }) => {
  const playerImages = React.useContext(PlayerImagesContext);
  const imageUrl = playerImages[(name || "").toLowerCase()];
  const initials = (name || "?").substring(0, 2).toUpperCase();
  return (
    <div className="player-avatar hex-avatar" style={{ width: size, height: size, flexShrink: 0, overflow: "hidden", padding: 0 }}>
      {imageUrl
        ? <img loading="lazy" src={imageUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.parentNode.textContent = initials; }} />
        : initials}
    </div>
  );
};

// ── Option card ──────────────────────────────────────────────────────────────
const OptionCard = ({ label, icon: Icon, selected, onClick, disabled }) => (
  <div
    onClick={() => !disabled && onClick()}
    style={{
      background: selected ? "var(--accent-dim)" : "var(--surface-1)",
      border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
      borderRadius: "var(--radius-sm)",
      padding: "14px 10px",
      textAlign: "center",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "all 0.15s ease",
      flex: 1,
      minWidth: 90,
    }}
  >
    {Icon && <Icon size={22} weight={selected ? "fill" : "regular"} style={{ color: selected ? "var(--accent)" : "var(--text-2)", marginBottom: 6 }} />}
    <div style={{ fontSize: 12, fontWeight: selected ? 700 : 500, color: selected ? "var(--accent)" : "var(--text-1)" }}>
      {label}
    </div>
  </div>
);

// ── Section card ─────────────────────────────────────────────────────────────
const Section = ({ icon: Icon, title, tag, children }) => (
  <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20, marginBottom: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      {Icon && <Icon size={18} style={{ color: "var(--text-2)" }} />}
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)" }}>{title}</span>
      {tag && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-xs)", background: tag === "STRONG" ? "var(--success-dim)" : "var(--danger-dim)", color: tag === "STRONG" ? "var(--success)" : "var(--danger)", letterSpacing: 1 }}>
          {tag}
        </span>
      )}
    </div>
    {children}
  </div>
);

// ── Coherence panel ──────────────────────────────────────────────────────────
const CoherencePanel = ({ coherence, players }) => {
  if (!coherence) return null;
  const net = coherence.net ?? 0;
  const netColor = net > 0 ? "var(--success)" : net < 0 ? "var(--danger)" : "var(--text-2)";
  const checks = (coherence.checks || []).filter(c => c.passed);

  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
      {/* Players impact */}
      {players && players.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12 }}>Impact Preview</div>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
               <PlayerAvatar name={p.name} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-2)" }}>{p.rating} OVR</div>
              </div>
            </div>
          ))}
          <div style={{ height: 1, background: "var(--border)", margin: "14px 0" }} />
        </>
      )}

      {/* Coherence */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)" }}>Cohérence</span>
        <span style={{ fontSize: 18, fontWeight: 900, color: netColor }}>{net > 0 ? "+" : ""}{net.toFixed(1)}</span>
      </div>
      {checks.map((c, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 6, fontSize: 11 }}>
          {c.delta > 0
            ? <CheckCircle size={13} weight="fill" style={{ color: "var(--success)", flexShrink: 0, marginTop: 1 }} />
            : <XCircle size={13} weight="fill" style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
          }
          <span style={{ color: "var(--text-2)", lineHeight: 1.4 }}>{c.description}</span>
          <span style={{ marginLeft: "auto", fontWeight: 700, color: c.delta > 0 ? "var(--success)" : "var(--danger)", flexShrink: 0 }}>
            {c.delta > 0 ? "+" : ""}{c.delta.toFixed(1)}
          </span>
        </div>
      ))}
      {checks.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-2)", fontStyle: "italic" }}>Aucune synergie active</div>
      )}

      <div style={{ height: 1, background: "var(--border)", margin: "14px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)" }}>Net Modifier</span>
        <span style={{ fontSize: 22, fontWeight: 900, color: netColor }}>{net > 0 ? "+" : ""}{(net * 1.5).toFixed(1)}</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 4 }}>Points de puissance ajoutés lors des simulations de matchs.</div>
    </div>
  );
};

// ── Lane sub-section ──────────────────────────────────────────────────────────
const LaneSection = ({ pos, label, icon: Icon, tactics, onUpdate, tag }) => {
  const lane = tactics?.lanes?.[pos] || {};
  const laneStyleOptions = pos !== "SUPPORT"
    ? [
        { id: "economy",       label: "Economy",       icon: CurrencyDollar },
        { id: "kill_pressure", label: "Kill Pressure", icon: Crosshair },
        { id: "lane_priority", label: "Lane Priority", icon: Flag },
      ]
    : null;
  const tpOptions = pos === "TOP" || pos === "MID"
    ? [
        { id: "safety",     label: "Safety",      icon: Shield },
        { id: "objectives", label: "Objectives",  icon: Target },
        { id: "split_push", label: "Split Push",  icon: ArrowsLeftRight },
      ]
    : null;
  const roamOptions = pos === "SUPPORT"
    ? [
        { id: "play_lane",     label: "Play Lane",     icon: Shield },
        { id: "roam_mid",      label: "Roam Mid",      icon: ArrowRight },
        { id: "roam_top",      label: "Roam Top",      icon: ArrowUp },
        { id: "jungle_invade", label: "Jungle Invade", icon: Sword },
        { id: "objectives",    label: "Objectives",    icon: Target },
      ]
    : null;

  return (
    <Section icon={Icon} title={label} tag={tag}>
      {laneStyleOptions && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 8 }}>Lane Style</div>
          <div style={{ display: "flex", gap: 8, marginBottom: tpOptions ? 16 : 0 }}>
            {laneStyleOptions.map(o => (
              <OptionCard key={o.id} label={o.label} icon={o.icon} selected={lane.lane_style === o.id}
                onClick={() => onUpdate(pos, { lane_style: o.id })} />
            ))}
          </div>
        </>
      )}
      {tpOptions && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 8 }}>TP Usage</div>
          <div style={{ display: "flex", gap: 8 }}>
            {tpOptions.map(o => (
              <OptionCard key={o.id} label={o.label} icon={o.icon} selected={lane.tp_usage === o.id}
                onClick={() => onUpdate(pos, { tp_usage: o.id })} />
            ))}
          </div>
        </>
      )}
      {roamOptions && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 8 }}>Roaming</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {roamOptions.map(o => (
              <OptionCard key={o.id} label={o.label} icon={o.icon} selected={lane.roaming === o.id}
                onClick={() => onUpdate(pos, { roaming: o.id })} />
            ))}
          </div>
        </>
      )}
    </Section>
  );
};

// ── Main component ─────────────────────────────────────────────────────────
const TacticsPage = ({ userTeam, players: allPlayers, teams, nextMatch }) => {
  const [tactics, setTactics] = useState(null);
  const [coherence, setCoherence] = useState(null);
  const [activeTab, setActiveTab] = useState("strategy");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchedPlayers, setFetchedPlayers] = useState({});

  // Gather starters for Impact Preview
  const resolvePlayer = (id) => allPlayers?.[id] || fetchedPlayers[id];
  const starters = userTeam
    ? (userTeam.roster || [])
        .map(id => resolvePlayer(id))
        .filter(p => p?.is_starter)
    : [];

  const fetchTactics = useCallback(async () => {
    try {
      const res = await API_CLIENT.get("/tactics");
      setTactics(res.data.tactics);
      setCoherence(res.data.coherence);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTactics(); }, [fetchTactics]);

  const update = useCallback(async (patch) => {
    if (saving) return;
    setSaving(true);
    // Optimistic update
    setTactics(prev => ({ ...prev, ...patch }));
    try {
      const res = await API_CLIENT.post("/tactics", patch);
      setTactics(res.data.tactics);
      setCoherence(res.data.coherence);
    } catch { await fetchTactics(); }
    setSaving(false);
  }, [saving, fetchTactics]);

  const updateLane = useCallback(async (pos, lanePatch) => {
    if (saving) return;
    setSaving(true);
    setTactics(prev => ({
      ...prev,
      lanes: { ...prev?.lanes, [pos]: { ...prev?.lanes?.[pos], ...lanePatch } },
    }));
    try {
      const res = await API_CLIENT.post("/tactics", { lanes: { [pos]: lanePatch } });
      setTactics(res.data.tactics);
      setCoherence(res.data.coherence);
    } catch { await fetchTactics(); }
    setSaving(false);
  }, [saving, fetchTactics]);

  // Next opponent info
  const oppId = nextMatch ? (nextMatch.team1 === userTeam?.id ? nextMatch.team2 : nextMatch.team1) : null;
  const oppTeam = oppId ? teams?.find(t => t.id === oppId) : null;

  // Fetch missing players (opponent roster + user starters)
  useEffect(() => {
    const ids = [
      ...(oppTeam?.roster || []),
      ...(userTeam?.roster || []),
    ].filter(id => id && !allPlayers?.[id] && !fetchedPlayers[id]);
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    Promise.all(unique.map(id => API_CLIENT.get("/players/" + id).then(r => r.data).catch(() => null)))
      .then(results => {
        const map = {};
        results.forEach(p => { if (p) map[p.id] = p; });
        setFetchedPlayers(prev => ({ ...prev, ...map }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppTeam?.id, userTeam?.id]);

  const tabs = [
    { id: "strategy", label: "Stratégie" },
    { id: "lanes",    label: "Lanes" },
    { id: "matchprep", label: "Match Prep" },
  ];

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--text-2)", gap: 10 }}>
      <Spinner size={20} style={{ animation: "spin 1s linear infinite" }} /> Chargement des tactiques...
    </div>
  );

  const renderStrategy = () => (
    <div>
      <Section icon={Sword} title="Strong Side">
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "top", label: "Top Side" }, { id: "mid", label: "Mid Focus" }, { id: "bot", label: "Bot Side" }].map(o => (
            <OptionCard key={o.id} label={o.label} selected={tactics?.strong_side === o.id}
              onClick={() => update({ strong_side: o.id })} />
          ))}
        </div>
      </Section>

      <Section icon={Lightning} title="Game Timing">
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "early", label: "Early Game" }, { id: "mid", label: "Mid Game" }, { id: "late", label: "Late Game" }].map(o => (
            <OptionCard key={o.id} label={o.label} selected={tactics?.game_timing === o.id}
              onClick={() => update({ game_timing: o.id })} />
          ))}
        </div>
      </Section>

      <Section icon={TreeStructure} title="Jungle Style">
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "ganker", label: "Ganker" }, { id: "invader", label: "Invader" }, { id: "farmer", label: "Farmer" }, { id: "enabler", label: "Enabler" }].map(o => (
            <OptionCard key={o.id} label={o.label} selected={tactics?.jungle_style === o.id}
              onClick={() => update({ jungle_style: o.id })} />
          ))}
        </div>
      </Section>

      <Section icon={MapTrifold} title="Jungle Pathing">
        <div style={{ display: "flex", gap: 8 }}>
          {[{ id: "top_to_bot", label: "Top → Bot", icon: ArrowDown }, { id: "bot_to_top", label: "Bot → Top", icon: ArrowUp }].map(o => (
            <OptionCard key={o.id} label={o.label} icon={o.icon} selected={tactics?.jungle_pathing === o.id}
              onClick={() => update({ jungle_pathing: o.id })} />
          ))}
        </div>
      </Section>
    </div>
  );

  const renderLanes = () => {
    const topTag = tactics?.strong_side === "top" ? "STRONG" : tactics?.strong_side === "bot" ? "WEAK" : null;
    const botTag = tactics?.strong_side === "bot" ? "STRONG" : tactics?.strong_side === "top" ? "WEAK" : null;

    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <LaneSection pos="TOP"     label="Top Lane"  icon={ArrowUp}   tactics={tactics} onUpdate={updateLane} tag={topTag} />
        <LaneSection pos="MID"     label="Mid Lane"  icon={Crosshair} tactics={tactics} onUpdate={updateLane} />
        <LaneSection pos="ADC"     label="Bot Lane"  icon={ArrowDown} tactics={tactics} onUpdate={updateLane} tag={botTag} />
        <LaneSection pos="SUPPORT" label="Support"   icon={Shield}    tactics={tactics} onUpdate={updateLane} />
      </div>
    );
  };

  const renderMatchPrep = () => {
    if (!oppTeam) return (
      <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-2)" }}>
        <Eye size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
        <div>Aucun match programmé</div>
      </div>
    );

    const oppPlayers = (oppTeam.roster || []).map(id => resolvePlayer(id)).filter(Boolean);

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, padding: 16, background: "var(--surface-1)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)" }}>
          <TeamLogo teamId={oppTeam.id} abbr={oppTeam.abbr} size={48} noClick />
          <div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{oppTeam.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
              {nextMatch?.week ? `Semaine ${nextMatch.week}` : "Prochain match"} · {oppTeam.wins ?? 0}V – {oppTeam.losses ?? 0}D
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12 }}>
          Roster Adverse &amp; Signature Picks
        </div>

        {oppPlayers.map((p, i) => {
          // Compute played champs from match_history, fallback to champion_pool
          const champMap = {};
          (p.match_history || []).forEach(m => {
            if (!m.champion) return;
            if (!champMap[m.champion]) champMap[m.champion] = { games: 0, wins: 0 };
            champMap[m.champion].games++;
            if (m.won) champMap[m.champion].wins++;
          });
          const playedChamps = Object.entries(champMap).sort((a, b) => b[1].games - a[1].games).slice(0, 3);
          const hasHistory = playedChamps.length > 0;
          const displayChamps = hasHistory
            ? playedChamps.map(([champ, stats]) => ({ champ, games: stats.games, wr: Math.round((stats.wins / stats.games) * 100) }))
            : (p.champion_pool || []).slice(0, 3).map(champ => ({ champ, games: null, wr: null }));

          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 6 }}>
              <PlayerAvatar name={p.name} size={40} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-2)" }}>{p.rating} OVR</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {displayChamps.map(({ champ, games, wr }, ci) => {
                  const wrColor = wr !== null ? (wr >= 60 ? "var(--success)" : wr >= 45 ? "var(--amber)" : "var(--danger)") : "var(--text-2)";
                  return (
                    <div key={ci} style={{ textAlign: "center" }}>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${_ddVersion}/img/champion/${toDDragonKey(champ)}.png`}
                        alt={champ}
                        style={{ width: 32, height: 32, borderRadius: 4 }}
                        onError={e => { e.currentTarget.style.display = "none"; }}
                      />
                      <div style={{ fontSize: 9, color: wrColor, marginTop: 2, fontWeight: wr !== null ? 700 : 400 }}>
                        {wr !== null ? `${wr}% (${games})` : (ci === 0 ? "SIG" : "—")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20, height: "100%" }}>
      {/* Left panel */}
      <div style={{ minWidth: 0 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                padding: "8px 18px", fontSize: 13, fontWeight: 600,
                background: "transparent", border: "none", cursor: "pointer", outline: "none",
                borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: activeTab === t.id ? "var(--accent)" : "var(--text-2)",
                marginBottom: -1, transition: "color .15s",
              }}>
              {t.label}
            </button>
          ))}
          {saving && <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 4, paddingBottom: 8 }}>
            <Spinner size={12} /> Sauvegarde...
          </div>}
        </div>

        <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          {activeTab === "strategy"  && renderStrategy()}
          {activeTab === "lanes"     && renderLanes()}
          {activeTab === "matchprep" && renderMatchPrep()}
        </motion.div>
      </div>

      {/* Right panel — coherence */}
      <div style={{ position: "sticky", top: 0, alignSelf: "start" }}>
        <CoherencePanel coherence={coherence} players={starters} />
      </div>
    </div>
  );
};

export default TacticsPage;
