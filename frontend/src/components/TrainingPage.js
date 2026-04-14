import React, { useState, useMemo } from "react";
import { formatMoney } from "../shared";
import { motion } from "framer-motion";
import {
  Sword, ChartBar, Fire, ClockCounterClockwise,
  Check, Lightning, TrendUp, X
} from "@phosphor-icons/react";

const TRAINING_OPTIONS = [
  {
    id: "scrims",
    name: "Scrims",
    icon: Sword,
    cost: 50000,
    fatigue: "+10", moral: "-3", form: "+2",
    dev: "Méca ++, Teamwork +",
    color: "var(--secondary)",
    label: "MODÉRÉ",
  },
  {
    id: "vod_review",
    name: "VOD Review",
    icon: ChartBar,
    cost: 20000,
    fatigue: "+4", moral: "+3", form: "+1",
    dev: "Game Sense ++, Consis. +",
    color: "var(--success)",
    label: "LÉGER",
  },
  {
    id: "bootcamp",
    name: "Bootcamp",
    icon: Fire,
    cost: 100000,
    fatigue: "+18", moral: "-8", form: "+3",
    dev: "Méca +++, Game Sense ++",
    color: "var(--danger)",
    label: "INTENSIF",
  },
  {
    id: "rest",
    name: "Repos",
    icon: ClockCounterClockwise,
    cost: 0,
    fatigue: "-25", moral: "+12", form: "+1",
    dev: "—",
    color: "var(--text-secondary)",
    label: "REPOS",
  },
];

const PlanBadge = ({ plan }) => {
  const opt = TRAINING_OPTIONS.find(o => o.id === plan);
  if (!opt) return <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Aucun plan</span>;
  const Icon = opt.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 700,
      padding: "3px 8px", borderRadius: 2,
      background: opt.color + "22", color: opt.color,
      border: `1px solid ${opt.color}55`,
    }}>
      <Icon size={12} /> {opt.name}
    </span>
  );
};

const TrainingPage = ({ userTeam, onSetTrainingPlan }) => {
  const [notification, setNotification] = useState(null);
  const [editing, setEditing]           = useState(null); // playerId being edited
  const [saving, setSaving]             = useState(null);  // playerId being saved

  const starters = useMemo(
    () => userTeam.players?.filter(p => p.is_starter) || [],
    [userTeam.players]
  );

  const notify = (msg, ok = true) => {
    setNotification({ msg, ok });
    setTimeout(() => setNotification(null), 3500);
  };

  const handleSetPlan = async (player, trainingType) => {
    setSaving(player.id);
    try {
      const result = await onSetTrainingPlan(player.id, trainingType);
      const planName = TRAINING_OPTIONS.find(o => o.id === trainingType)?.name || "Aucun";
      if (result.applied_now) {
        notify(`Plan "${planName}" défini et appliqué immédiatement pour ${player.name}`);
      } else {
        notify(`Plan "${planName}" planifié pour ${player.name} — s'applique après chaque match`);
      }
      setEditing(null);
    } catch (e) {
      notify(e?.response?.data?.detail || "Erreur", false);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="animate-slide-up">
      <div style={{ marginBottom: 24 }}>
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 4 }}>
          Planning d'Entraînement
        </h2>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Définissez un programme pour chaque joueur — il s'applique automatiquement après chaque match
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          style={{
            padding: "11px 16px", marginBottom: 18, borderRadius: 2,
            background: notification.ok ? "rgba(0,230,118,0.08)" : "rgba(255,51,102,0.1)",
            border: `1px solid ${notification.ok ? "var(--success)" : "var(--danger)"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
          }}
        >
          <span>{notification.msg}</span>
          <button onClick={() => setNotification(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 16 }}>×</button>
        </motion.div>
      )}

      {/* Player rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {starters.map(player => {
          const fatiguePct  = player.fatigue || 0;
          const fatigueColor = fatiguePct >= 70 ? "var(--danger)" : fatiguePct >= 45 ? "var(--secondary)" : "var(--success)";
          const isEditing   = editing === player.id;
          const isSaving    = saving  === player.id;
          const planDone    = player.training_done_this_week;

          return (
            <motion.div
              key={player.id}
              className="card"
              style={{ padding: "16px 20px", overflow: "hidden" }}
              layout
            >
              {/* Main row */}
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className={"pos-badge pos-" + player.position} style={{ flexShrink: 0 }}>
                  {player.position}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{player.name}</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                    <span style={{ color: fatigueColor }}>Fatigue {fatiguePct}%</span>
                    <span style={{ color: "var(--text-secondary)" }}>Moral {player.moral}%</span>
                    {player.form_bonus > 0 && (
                      <span style={{ color: "var(--primary)" }}>
                        <Lightning size={10} style={{ verticalAlign: "middle" }} /> Forme +{player.form_bonus}
                      </span>
                    )}
                  </div>
                  {/* Fatigue bar */}
                  <div style={{ marginTop: 6, height: 2, background: "var(--border)", borderRadius: 1 }}>
                    <div style={{ width: `${fatiguePct}%`, height: "100%", background: fatigueColor, borderRadius: 1, transition: "width .3s" }} />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <div className="font-stats" style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", lineHeight: 1 }}>
                    {player.rating}
                  </div>
                  {/* Status */}
                  {planDone ? (
                    <span style={{ fontSize: 10, color: "var(--success)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Check size={10} /> Appliqué
                    </span>
                  ) : player.training_plan ? (
                    <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>En attente</span>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <PlanBadge plan={player.training_plan} />
                  <button
                    className={isEditing ? "btn-secondary" : "btn-primary"}
                    style={{ fontSize: 12, padding: "5px 12px", minWidth: 80 }}
                    onClick={() => setEditing(isEditing ? null : player.id)}
                    disabled={isSaving}
                  >
                    {isSaving ? "…" : isEditing ? "Annuler" : "Modifier"}
                  </button>
                  {player.training_plan && !isEditing && (
                    <button
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4 }}
                      title="Supprimer le plan"
                      onClick={() => handleSetPlan(player, "")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Training selector (expanded) */}
              {isEditing && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}
                >
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
                    Choisir le programme hebdomadaire :
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {TRAINING_OPTIONS.map(opt => {
                      const tooExpensive = opt.cost > userTeam.budget;
                      const isCurrentPlan = player.training_plan === opt.id;
                      const Icon = opt.icon;
                      return (
                        <motion.button
                          key={opt.id}
                          whileHover={!tooExpensive ? { y: -2 } : {}}
                          onClick={() => !tooExpensive && handleSetPlan(player, opt.id)}
                          disabled={tooExpensive || isSaving}
                          style={{
                            padding: "12px 8px",
                            background: isCurrentPlan ? opt.color + "22" : "var(--surface-hover)",
                            border: `1px solid ${isCurrentPlan ? opt.color : "var(--border)"}`,
                            borderRadius: 4, cursor: tooExpensive ? "not-allowed" : "pointer",
                            opacity: tooExpensive ? 0.45 : 1,
                            textAlign: "center",
                          }}
                        >
                          <Icon size={18} style={{ color: opt.color, marginBottom: 6, display: "block", margin: "0 auto 6px" }} />
                          <div style={{ fontSize: 12, fontWeight: 700, color: isCurrentPlan ? opt.color : "var(--text-primary)", marginBottom: 2 }}>
                            {opt.name}
                          </div>
                          <div style={{ fontSize: 10, color: opt.color, marginBottom: 4, fontWeight: 600 }}>{opt.label}</div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                            Fat. {opt.fatigue} · Moral {opt.moral}
                            <br />
                            <span style={{ color: "var(--primary)" }}>Forme {opt.form}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--secondary)", marginTop: 4 }}>
                            {opt.cost > 0 ? formatMoney(opt.cost) + "/sem." : "Gratuit"}
                          </div>
                          {tooExpensive && (
                            <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 2 }}>Budget insuf.</div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--surface)", borderRadius: 2, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.9 }}>
        <strong style={{ color: "var(--text-primary)" }}>Fonctionnement :</strong>
        <br />
        · Le plan s'applique automatiquement dès sa définition, puis après chaque match joué
        <br />
        · <Lightning size={12} style={{ verticalAlign: "middle", color: "var(--primary)" }} /> <strong>Forme</strong> = bonus temporaire pour le match suivant, décroît de 1 après chaque match
        <br />
        · <TrendUp size={12} style={{ verticalAlign: "middle", color: "var(--success)" }} /> <strong>Développement</strong> = progression lente et permanente (accumulation sur plusieurs semaines)
        <br />
        · Le coût est prélevé automatiquement chaque semaine — si budget insuffisant, "Repos" est appliqué à la place
      </div>
    </div>
  );
};

export default TrainingPage;
