import React, { useState } from "react";
import { formatMoney } from "../shared";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy, Users, ShoppingCart, Target, Calendar,
  ChartBar, ChartLine, Sword, MagnifyingGlass,
  Coins, ArrowsClockwise, X, List, ClockCounterClockwise,
  Strategy, Envelope
} from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";

/* ─────────────────────────────────────────────────────────────
   Navigation — Direction B "Dark Premium"
   Sidebar verticale 56px (icônes) avec tooltip label au hover.
   Mobile : drawer plein-largeur depuis le haut.
───────────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { id: "dashboard",    label: "Dashboard",     icon: ChartBar },
  { id: "roster",       label: "Effectif",      icon: Users },
  { id: "negotiations", label: "Négociations",  icon: ShoppingCart },
  { id: "training",     label: "Entraînement",  icon: Target },
  { id: "schedule",     label: "Calendrier",    icon: Calendar },
  { id: "standings",    label: "Classement",    icon: Trophy },
  { id: "playoffs",     label: "Playoffs",      icon: Sword },
  { id: "tactics",      label: "Tactiques",     icon: Strategy },
  { id: "stats",        label: "Stats",         icon: ChartLine },
  { id: "history",      label: "Historique",    icon: ClockCounterClockwise },
  { id: "scouting",     label: "Scouting",      icon: MagnifyingGlass },
  { id: "inbox",        label: "Boîte mail",    icon: Envelope },
];

/* Tooltip simple en CSS-in-JS pour rester autonome */
const tooltipStyle = {
  position: "absolute",
  left: "calc(100% + 10px)",
  top: "50%",
  transform: "translateY(-50%)",
  background: "var(--surface-3)",
  color: "var(--text-1)",
  fontSize: 12,
  fontWeight: 500,
  padding: "5px 10px",
  borderRadius: "var(--radius-xs)",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  border: "1px solid var(--border-strong)",
  zIndex: 200,
  boxShadow: "var(--shadow)",
};

const NavItem = ({ item, isActive, onClick, unread }) => {
  const [hovered, setHovered] = useState(false);
  const Icon = item.icon;

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => onClick(item.id)}
        data-testid={"nav-" + item.id}
        style={{
          width: 40,
          height: 40,
          borderRadius: "var(--radius-sm)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isActive ? "var(--accent-dim)" : hovered ? "var(--surface-2)" : "transparent",
          color: isActive ? "var(--accent)" : hovered ? "var(--text-3)" : "var(--text-2)",
          border: "none",
          cursor: "pointer",
          transition: "background var(--t-base), color var(--t-base)",
          position: "relative",
          flexShrink: 0,
        }}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon size={18} weight={isActive ? "fill" : "regular"} />

        {/* Badge inbox */}
        {item.id === "inbox" && unread > 0 && (
          <span style={{
            position: "absolute",
            top: 6,
            right: 6,
            background: "var(--danger)",
            color: "#fff",
            borderRadius: 99,
            fontSize: 9,
            fontWeight: 700,
            padding: "1px 4px",
            lineHeight: 1.4,
            minWidth: 14,
            textAlign: "center",
            border: "1.5px solid var(--surface-1)",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Tooltip */}
      {hovered && (
        <div style={tooltipStyle}>{item.label}</div>
      )}
    </div>
  );
};

const Navigation = ({ currentPage, setCurrentPage, userTeam, onChangeSave, unreadInbox = 0 }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (id) => {
    setCurrentPage(id);
    setMobileOpen(false);
  };

  return (
    <>
      {/* ── Sidebar desktop ────────────────────────────────── */}
      <aside
        className="nav-desktop"
        style={{
          width: 56,
          minHeight: "100vh",
          background: "var(--surface-1)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 0",
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 100,
          gap: 2,
        }}
      >
        {/* Logo */}
        <div
          style={{
            width: 32,
            height: 32,
            background: "linear-gradient(135deg, var(--accent), #3B6FD4)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            color: "white",
            boxShadow: "var(--shadow-accent)",
            marginBottom: 14,
            cursor: "default",
            flexShrink: 0,
          }}
          title="League Manager"
        >
          LM
        </div>

        {/* Nav items */}
        {NAV_ITEMS.map(item => (
          <NavItem
            key={item.id}
            item={item}
            isActive={currentPage === item.id}
            onClick={handleNav}
            unread={unreadInbox}
          />
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Budget */}
        {userTeam && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
            width: "100%",
            padding: "8px 6px",
            borderTop: "1px solid var(--border)",
          }}>
            <TeamLogo
              teamId={userTeam.id}
              abbr={userTeam.abbr}
              size={24}
              style={{ filter: "brightness(0) invert(1)", opacity: 0.7 }}
            />
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              fontWeight: 500,
              color: "var(--success)",
              textAlign: "center",
              lineHeight: 1.2,
            }}>
              {formatMoney(userTeam.budget)}
            </span>
          </div>
        )}

        {/* Changer de save */}
        {onChangeSave && (
          <div style={{ position: "relative" }} className="save-btn-wrap">
            <button
              onClick={onChangeSave}
              title="Changer de sauvegarde"
              style={{
                width: 40,
                height: 40,
                borderRadius: "var(--radius-sm)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                color: "var(--text-2)",
                border: "none",
                cursor: "pointer",
                transition: "background var(--t-base), color var(--t-base)",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "var(--surface-2)";
                e.currentTarget.style.color = "var(--text-3)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-2)";
              }}
              aria-label="Changer de sauvegarde"
            >
              <ArrowsClockwise size={16} />
            </button>
          </div>
        )}
      </aside>

      {/* ── Header mobile ───────────────────────────────────── */}
      <header
        className="nav-mobile-header"
        style={{
          display: "none",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          height: 52,
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border)",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
        }}
      >
        <span style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: "-0.02em",
        }}>
          League <span style={{ color: "var(--amber)" }}>Manager</span>
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {userTeam && (
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 12,
              color: "var(--success)",
              background: "var(--success-dim)",
              padding: "4px 10px",
              borderRadius: "var(--radius-xs)",
              border: "1px solid var(--success-border)",
            }}>
              {formatMoney(userTeam.budget)}
            </span>
          )}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            data-testid="mobile-menu-btn"
            style={{
              width: 36,
              height: 36,
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
          >
            {mobileOpen ? <X size={18} /> : <List size={18} />}
          </button>
        </div>
      </header>

      {/* ── Drawer mobile ───────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.nav
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "fixed",
              top: 52,
              left: 0,
              right: 0,
              zIndex: 99,
              background: "var(--surface-1)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <div
                  key={item.id}
                  className={"nav-mobile-link" + (isActive ? " active" : "")}
                  onClick={() => handleNav(item.id)}
                  data-testid={"nav-mobile-" + item.id}
                >
                  <Icon size={18} weight={isActive ? "fill" : "regular"} />
                  {item.label}
                  {item.id === "inbox" && unreadInbox > 0 && (
                    <span style={{
                      marginLeft: "auto",
                      background: "var(--danger)",
                      color: "#fff",
                      borderRadius: 99,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                    }}>
                      {unreadInbox}
                    </span>
                  )}
                </div>
              );
            })}
          </motion.nav>
        )}
      </AnimatePresence>

      {/* ── Overlay mobile ──────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 98,
              background: "rgba(10,12,18,0.6)",
              backdropFilter: "blur(2px)",
            }}
          />
        )}
      </AnimatePresence>

      {/* ── CSS responsive (injecté une fois) ──────────────── */}
      <style>{`
        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-header { display: flex !important; }
          .app-with-sidebar { margin-left: 0 !important; padding-top: 52px; }
        }
        @media (min-width: 769px) {
          .nav-mobile-header { display: none !important; }
          .app-with-sidebar { margin-left: 56px; }
        }
      `}</style>
    </>
  );
};

export default Navigation;
