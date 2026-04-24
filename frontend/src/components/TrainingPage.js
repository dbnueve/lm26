import React, { useState, useMemo, useRef, useEffect } from "react";
import { formatMoney } from "../shared";
import { motion } from "framer-motion";
import {
  Sword, ChartBar, Fire, ClockCounterClockwise,
  Check, Lightning, TrendUp, X, Users
} from "@phosphor-icons/react";

const TRAINING_OPTIONS = [
  {
    id: "scrims",
    name: "Scrims",
    icon: Sword,
    cost: 50000,
    fatigue: "+10", moral: "-3", form: "+2",
    dev: "Méca ++, Teamwork +",
    color: "var(--amber)",
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
    color: "var(--text-2)",
    label: "REPOS",
  },
];

const PlanBadge = ({ plan }) => {
  const opt = TRAINING_OPTIONS.find(o => o.id === plan);
  if (!opt) return <span style={{ fontSize: 11, color: "var(--text-2)" }}>—</span>;
  const Icon = opt.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700,
      padding: "2px 6px", borderRadius: 2,
      background: opt.color + "22", color: opt.color,
      border: `1px solid ${opt.color}55`,
    }}>
      <Icon size={10} /> {opt.name}
    </span>
  );
};

const TrainingPage = ({ userTeam, onSetTeamTrainingPlan }) => {
  const [notification, setNotification] = useState(null);
  const [saving, setSaving]             = useState(false);

  const starters = useMemo(
    () => userTeam.players?.filter(p => p.is_starter) || [],
    [userTeam.players]
  );

  // Team plan = plan commun si tous les titulaires l'ont, sinon null
  const teamPlan = useMemo(() => {
    if (!starters.length) return null;
    const first = starters[0].training_plan;
    return starters.every(p => p.training_plan === first) ? first : null;
  }, [starters]);

  const allDone  = starters.length > 0 && starters.every(p => p.training_done_this_week);
  const totalCost = useMemo(() => {
    const opt = TRAINING_OPTIONS.find(o => o.id === teamPlan);
    return (opt?.cost || 0) * starters.length;
  }, [teamPlan, starters.length]);

  const notifyTimeoutRef = useRef(null);
  useEffect(() => () => {
    if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
  }, []);

  const notify = (msg, ok = true) => {
    setNotification({ msg, ok });
    if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    notifyTimeoutRef.current = setTimeout(() => setNotification(null), 3500);
  };

  const handleSetPlan = async (trainingType) => {
    setSaving(true);
    try {
      const result = await onSetTeamTrainingPlan(trainingType);
      const planName = TRAINING_OPTIONS.find(o => o.id === trainingType)?.name || "Aucun";
      if (!trainingType) {
        notify("Plan collectif supprimé");
      } else if (result.downgraded_to_rest > 0) {
        notify(`Plan "${planName}" défini — ${result.downgraded_to_rest} joueur(s) rabattus sur Repos (budget insuffisant)`, false);
      } else {
        notify(`Plan "${planName}" défini pour les 5 titulaires`);
      }
    } catch (e) {
      notify(e?.response?.data?.detail || "Erreur", false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <div style={{ marginBottom: 24 }}>
        <h2 className="font-heading" style={{ fontSize: 32, marginBottom: 4 }}>
          Entraînement Collectif
        </h2>
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
          Choisissez un programme hebdomadaire pour toute l'équipe — appliqué aux 5 titulaires après chaque match
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          style={{
            padding: "11px 16px", marginBottom: 18, borderRadius: "var(--radius-sm)",
            background: notification.ok ? "var(--success-dim)" : "var(--danger-dim)",
            border: `1px solid ${notification.ok ? "var(--success-border)" : "var(--danger-border)"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13,
          }}
        >
          <span>{notification.msg}</span>
          <button onClick={() => setNotification(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", fontSize: 16 }}>×</button>
        </motion.div>
      )}

      {/* Sélecteur collectif */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={20} style={{ color: "var(--accent)" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Programme de l'équipe</div>
              <div style={{ fontSize: 11, color: "var(--text-2)" }}>
                {teamPlan
                  ? `Plan actuel appliqué aux 5 titulaires · Coût total ${formatMoney(totalCost)}/sem.`
                  : "Aucun plan commun défini"}
              </div>
            </div>
          </div>
          {teamPlan && (
            <button
              style={{ background: "none", border: "1px solid var(--border-strong)", cursor: "pointer", color: "var(--text-2)", padding: "5px 12px", fontSize: 12, borderRadius: "var(--radius-sm)", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}
              onClick={() => handleSetPlan("")}
              disabled={saving}
            >
              <X size={12} /> Supprimer
            </button>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {TRAINING_OPTIONS.map(opt => {
            const weeklyCost = opt.cost * starters.length;
            const tooExpensive = weeklyCost > userTeam.budget;
            const isCurrentPlan = teamPlan === opt.id;
            const Icon = opt.icon;
            return (
              <motion.button
                key={opt.id}
                whileHover={!tooExpensive && !saving ? { y: -2 } : {}}
                onClick={() => !tooExpensive && !saving && handleSetPlan(opt.id)}
                disabled={tooExpensive || saving}
                style={{
                  padding: "16px 10px",
                  background: isCurrentPlan ? opt.color + "22" : "var(--surface-2)",
                  border: `1px solid ${isCurrentPlan ? opt.color : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)", cursor: tooExpensive || saving ? "not-allowed" : "pointer",
                  opacity: tooExpensive ? 0.45 : 1,
                  textAlign: "center",
                }}
              >
                <Icon size={22} style={{ color: opt.color, marginBottom: 8, display: "block", margin: "0 auto 8px" }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: isCurrentPlan ? opt.color : "var(--text-1)", marginBottom: 2 }}>
                  {opt.name}
                </div>
                <div style={{ fontSize: 10, color: opt.color, marginBottom: 6, fontWeight: 600 }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-2)", lineHeight: 1.5 }}>
                  Fat. {opt.fatigue} · Moral {opt.moral}
                  <br />
                  <span style={{ color: "var(--accent)" }}>Forme {opt.form}</span>
                  <br />
                  <span style={{ color: "var(--text-2)" }}>{opt.dev}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 6, fontWeight: 600 }}>
                  {opt.cost > 0
                    ? `${formatMoney(weeklyCost)}/sem.`
                    : "Gratuit"}
                </div>
                {tooExpensive && (
                  <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 3 }}>Budget insuf.</div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* État des titulaires */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
          <span>État des titulaires</span>
          {allDone && (
            <span style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Check size={12} /> Entraînement appliqué cette semaine
            </span>
          )}
        </div>
        {starters.map(player => {
          const fatiguePct   = player.fatigue || 0;
          const fatigueColor = fatiguePct >= 70 ? "var(--danger)" : fatiguePct >= 45 ? "var(--amber)" : "var(--success)";
          const planDone     = player.training_done_this_week;

          return (
            <div
              key={player.id}
              className="card"
              style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}
            >
              <span className={"pos-badge pos-" + player.position} style={{ flexShrink: 0 }}>
                {player.position}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{player.name}</div>
                <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                  <span style={{ color: fatigueColor }}>Fatigue {fatiguePct}%</span>
                  <span style={{ color: "var(--text-2)" }}>Moral {player.moral}%</span>
                  {player.form_bonus > 0 && (
                    <span style={{ color: "var(--accent)" }}>
                      <Lightning size={10} style={{ verticalAlign: "middle" }} /> Forme +{player.form_bonus}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 5, height: 2, background: "var(--border)", borderRadius: 1 }}>
                  <div style={{ width: `${fatiguePct}%`, height: "100%", background: fatigueColor, borderRadius: 1, transition: "width .3s" }} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, minWidth: 90 }}>
                <PlanBadge plan={player.training_plan} />
                {planDone ? (
                  <span style={{ fontSize: 10, color: "var(--success)", display: "flex", alignItems: "center", gap: 3 }}>
                    <Check size={10} /> Appliqué
                  </span>
                ) : player.training_plan ? (
                  <span style={{ fontSize: 10, color: "var(--text-2)" }}>En attente</span>
                ) : null}
              </div>

              <div className="font-stats" style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)", lineHeight: 1, flexShrink: 0, minWidth: 36, textAlign: "right" }}>
                {player.rating}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 24, padding: "14px 16px", background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.9 }}>
        <strong style={{ color: "var(--text-1)" }}>Fonctionnement :</strong>
        <br />
        · Le plan collectif s'applique immédiatement aux 5 titulaires, puis se relance automatiquement après chaque match
        <br />
        · <Lightning size={12} style={{ verticalAlign: "middle", color: "var(--accent)" }} /> <strong>Forme</strong> = bonus temporaire pour le match suivant, décroît de 1 après chaque match
        <br />
        · <TrendUp size={12} style={{ verticalAlign: "middle", color: "var(--success)" }} /> <strong>Développement</strong> = progression lente et permanente (accumulation sur plusieurs semaines)
        <br />
        · Coût prélevé chaque semaine pour chaque titulaire — si budget insuffisant, "Repos" est appliqué à la place
      </div>
    </div>
  );
};

export default TrainingPage;
