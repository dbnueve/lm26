import React, { useState, useMemo, useCallback } from "react";
import { formatMoney } from "../shared";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sword, ChartBar, Fire, ClockCounterClockwise,
  Check, Lock, Lightning, TrendUp
} from "@phosphor-icons/react";

const TRAINING_OPTIONS = [
  {
    id: "scrims",
    name: "Scrims",
    icon: Sword,
    cost: 50000,
    description: "Matchs d'entraînement contre d'autres équipes",
    fatigue: "+10",
    moral: "-3",
    form: "+2",
    dev: "Mécanique +, Teamwork +",
    intensity: "medium",
  },
  {
    id: "vod_review",
    name: "VOD Review",
    icon: ChartBar,
    cost: 20000,
    description: "Analyse vidéo et débriefing tactique",
    fatigue: "+4",
    moral: "+3",
    form: "+1",
    dev: "Game Sense ++, Consistance +",
    intensity: "light",
  },
  {
    id: "bootcamp",
    name: "Bootcamp",
    icon: Fire,
    cost: 100000,
    description: "Entraînement intensif sur plusieurs jours",
    fatigue: "+18",
    moral: "-8",
    form: "+3",
    dev: "Mécanique ++, Game Sense ++",
    intensity: "hard",
  },
  {
    id: "rest",
    name: "Repos",
    icon: ClockCounterClockwise,
    cost: 0,
    description: "Récupération physique et mentale",
    fatigue: "-25",
    moral: "+12",
    form: "+1",
    dev: "—",
    intensity: "rest",
  },
];

const INTENSITY_COLORS = {
  light:  "var(--success)",
  medium: "var(--secondary)",
  hard:   "var(--danger)",
  rest:   "var(--text-secondary)",
};

const INTENSITY_LABELS = {
  light:  "Léger",
  medium: "Modéré",
  hard:   "Intensif",
  rest:   "Repos",
};

const TrainingPage = ({ userTeam, onApplyTraining }) => {
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [selectedPlayer,   setSelectedPlayer]   = useState(null);
  const [lastResult,       setLastResult]        = useState(null);
  const [applying,         setApplying]          = useState(false);

  const starters = useMemo(
    () => userTeam.players?.filter(p => p.is_starter) || [],
    [userTeam.players]
  );

  const canAfford = selectedTraining
    ? (selectedTraining.cost <= userTeam.budget)
    : true;

  const alreadyTrained = selectedPlayer?.training_done_this_week;

  const canApply = selectedTraining && selectedPlayer && canAfford && !alreadyTrained && !applying;

  const handleApply = useCallback(async () => {
    if (!canApply) return;
    setApplying(true);
    try {
      const result = await onApplyTraining(selectedPlayer.id, selectedTraining.id);
      setLastResult(result);
      setSelectedTraining(null);
      setSelectedPlayer(null);
    } catch (e) {
      setLastResult({ error: e?.response?.data?.detail || "Erreur lors de l'entraînement" });
    } finally {
      setApplying(false);
    }
  }, [canApply, selectedPlayer, selectedTraining, onApplyTraining]);

  return (
    <div className="animate-slide-up">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 4 }}>
            Centre d'Entraînement
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            1 session par joueur entre chaque match · Le bonus de forme se dissipe après le match
          </div>
        </div>
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 2,
          padding: "10px 16px",
          textAlign: "center",
          minWidth: 120
        }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>BUDGET</div>
          <div className="font-stats" style={{ color: "var(--secondary)", fontWeight: 700 }}>
            {formatMoney(userTeam.budget)}
          </div>
        </div>
      </div>

      {/* Last result notification */}
      <AnimatePresence>
        {lastResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              padding: "12px 16px",
              marginBottom: 20,
              borderRadius: 2,
              background: lastResult.error ? "rgba(255,51,102,0.1)" : "rgba(0,230,118,0.08)",
              border: `1px solid ${lastResult.error ? "var(--danger)" : "var(--success)"}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 13 }}>
              {lastResult.error
                ? lastResult.error
                : `Entraînement appliqué — Forme +${lastResult.form_bonus_added}${
                    Object.keys(lastResult.stat_gains || {}).length > 0
                      ? " · Progression permanente : " + Object.entries(lastResult.stat_gains).map(([s, v]) => `${s} +${v}`).join(", ")
                      : ""
                  }`}
            </span>
            <button
              onClick={() => setLastResult(null)}
              style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18 }}
            >×</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid-2" style={{ marginBottom: 32, gap: 24 }}>
        {/* Training options */}
        <div>
          <h3 className="font-heading" style={{ marginBottom: 16, fontSize: 14, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>
            Type d'entraînement
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {TRAINING_OPTIONS.map(opt => {
              const tooExpensive = opt.cost > userTeam.budget;
              const isSelected = selectedTraining?.id === opt.id;
              return (
                <motion.div
                  key={opt.id}
                  className={"card " + (isSelected ? "card-gold" : "")}
                  style={{
                    padding: "14px 16px",
                    cursor: tooExpensive ? "not-allowed" : "pointer",
                    opacity: tooExpensive ? 0.5 : 1,
                    borderLeft: `3px solid ${INTENSITY_COLORS[opt.intensity]}`,
                  }}
                  whileHover={!tooExpensive ? { x: 3 } : {}}
                  onClick={() => !tooExpensive && setSelectedTraining(opt)}
                  data-testid={"training-" + opt.id}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 40, height: 40,
                      background: "var(--surface-hover)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: 3,
                      flexShrink: 0,
                    }}>
                      <opt.icon size={20} style={{ color: INTENSITY_COLORS[opt.intensity] }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600 }}>{opt.name}</span>
                        <span style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 2,
                          background: INTENSITY_COLORS[opt.intensity] + "22",
                          color: INTENSITY_COLORS[opt.intensity],
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}>
                          {INTENSITY_LABELS[opt.intensity]}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{opt.description}</div>
                      {/* Effects grid */}
                      <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                        <span style={{ color: Number(opt.fatigue) > 0 ? "var(--danger)" : "var(--success)" }}>
                          Fatigue {opt.fatigue}
                        </span>
                        <span style={{ color: Number(opt.moral) >= 0 ? "var(--success)" : "var(--danger)" }}>
                          Moral {opt.moral}
                        </span>
                        <span style={{ color: "var(--primary)", fontWeight: 600 }}>
                          <Lightning size={11} style={{ verticalAlign: "middle" }} /> Forme {opt.form}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                        <TrendUp size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />
                        {opt.dev}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div className="font-stats" style={{ color: "var(--secondary)", fontWeight: 700, fontSize: 13 }}>
                        {opt.cost > 0 ? formatMoney(opt.cost) : "Gratuit"}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Player selection */}
        <div>
          <h3 className="font-heading" style={{ marginBottom: 16, fontSize: 14, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>
            Joueur à entraîner
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {starters.map(player => {
              const done = player.training_done_this_week;
              const isSelected = selectedPlayer?.id === player.id;
              const fatiguePct = player.fatigue || 0;
              const fatigueColor = fatiguePct >= 70 ? "var(--danger)" : fatiguePct >= 45 ? "var(--secondary)" : "var(--success)";
              return (
                <motion.div
                  key={player.id}
                  className={"card " + (isSelected ? "card-gold" : "")}
                  style={{
                    padding: "12px 16px",
                    cursor: done ? "not-allowed" : "pointer",
                    opacity: done ? 0.55 : 1,
                    position: "relative",
                  }}
                  whileHover={!done ? { x: 3 } : {}}
                  onClick={() => !done && setSelectedPlayer(player)}
                  data-testid={"train-player-" + player.id}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={"pos-badge pos-" + player.position} style={{ flexShrink: 0 }}>
                      {player.position}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{player.name}</div>
                      <div style={{ display: "flex", gap: 12, fontSize: 11, marginTop: 3 }}>
                        <span style={{ color: fatigueColor }}>Fatigue {fatiguePct}%</span>
                        <span style={{ color: "var(--text-secondary)" }}>Moral {player.moral}%</span>
                        {player.form_bonus > 0 && (
                          <span style={{ color: "var(--primary)" }}>
                            <Lightning size={10} style={{ verticalAlign: "middle" }} /> Forme +{player.form_bonus}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div className="font-stats" style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", lineHeight: 1 }}>
                        {player.rating}
                      </div>
                      {done && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-secondary)" }}>
                          <Lock size={10} />
                          Entraîné
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Fatigue bar */}
                  <div style={{ marginTop: 8, height: 2, background: "var(--border)", borderRadius: 1 }}>
                    <div style={{ width: `${fatiguePct}%`, height: "100%", background: fatigueColor, borderRadius: 1, transition: "width 0.3s" }} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Confirmation panel */}
      <AnimatePresence>
        {selectedTraining && selectedPlayer && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              padding: "20px 24px",
              background: "var(--surface)",
              border: `1px solid ${alreadyTrained ? "var(--danger)" : !canAfford ? "var(--danger)" : "var(--border-active)"}`,
              borderRadius: 2,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {selectedTraining.name} — {selectedPlayer.name}
                </div>
                {alreadyTrained && (
                  <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>
                    Ce joueur a déjà été entraîné cette semaine
                  </div>
                )}
                {!alreadyTrained && !canAfford && (
                  <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>
                    Budget insuffisant ({formatMoney(selectedTraining.cost)} requis)
                  </div>
                )}
                {!alreadyTrained && canAfford && (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                    Fatigue {selectedTraining.fatigue} · Moral {selectedTraining.moral} · Forme {selectedTraining.form} · {formatMoney(selectedTraining.cost)}
                  </div>
                )}
              </div>
              <button
                className="btn-primary"
                onClick={handleApply}
                disabled={!canApply}
                data-testid="apply-training-btn"
                style={{ minWidth: 130 }}
              >
                <Check size={18} style={{ marginRight: 8 }} />
                {applying ? "En cours…" : "Confirmer"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div style={{ marginTop: 28, padding: "12px 16px", background: "var(--surface)", borderRadius: 2, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.8 }}>
        <strong style={{ color: "var(--text-primary)" }}>Comment fonctionne l'entraînement :</strong>
        <br />
        · <Lightning size={12} style={{ verticalAlign: "middle", color: "var(--primary)" }} /> <strong>Forme</strong> = bonus temporaire pour le prochain match, se dissipe après (-1 par match)
        <br />
        · <TrendUp size={12} style={{ verticalAlign: "middle", color: "var(--success)" }} /> <strong>Développement</strong> = progression lente et permanente des stats (accumulation sur plusieurs semaines)
        <br />
        · <Lock size={12} style={{ verticalAlign: "middle" }} /> 1 seule session autorisée par joueur entre deux matchs — choisissez judicieusement
      </div>
    </div>
  );
};

export default TrainingPage;
