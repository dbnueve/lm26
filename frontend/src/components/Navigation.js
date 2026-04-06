import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy, Users, ShoppingCart, Target, Calendar,
  ChartBar, ChartLine, Sword, MagnifyingGlass,
  Coins, ArrowsClockwise, X, GameController, ClockCounterClockwise
} from "@phosphor-icons/react";
import TeamLogo from "./TeamLogo";

// Navigation Component
const Navigation = ({ currentPage, setCurrentPage, userTeam, onChangeSave }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: ChartBar },
    { id: "roster", label: "Effectif", icon: Users },
    { id: "negotiations", label: "Négociations", icon: ShoppingCart },
    { id: "training", label: "Entraînement", icon: Target },
    { id: "schedule", label: "Calendrier", icon: Calendar },
    { id: "standings", label: "Classement", icon: Trophy },
    { id: "playoffs", label: "Playoffs", icon: Sword },
    { id: "stats", label: "Stats", icon: ChartLine },
    { id: "history", label: "Historique", icon: ClockCounterClockwise },
    { id: "scouting", label: "Scouting", icon: MagnifyingGlass },
  ];

  const handleNavClick = (id) => {
    setCurrentPage(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="logo">
          <div className="logo-text">
            League <span>Manager</span>
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="nav-menu nav-desktop">
          {navItems.map(item => (
            <div
              key={item.id}
              className={"nav-link " + (currentPage === item.id ? "active" : "")}
              onClick={() => setCurrentPage(item.id)}
              data-testid={"nav-" + item.id}
            >
              <item.icon size={16} style={{ marginRight: 6 }} />
              {item.label}
            </div>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {userTeam && (
            <div className="team-info">
              <div className="budget-display">
                <Coins size={20} weight="fill" />
                <span className="amount">{(userTeam.budget / 1000000).toFixed(1)}M EUR</span>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <TeamLogo teamId={userTeam.id} abbr={userTeam.abbr} size={28} style={{ filter: "brightness(0) invert(1)" }} />
              </div>
            </div>
          )}

          {onChangeSave && (
            <button
              onClick={onChangeSave}
              title="Changer de sauvegarde"
              style={{ background: "none", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 4, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}
            >
              <ArrowsClockwise size={14} style={{ marginRight: 4 }} />
              Saves
            </button>
          )}
          {/* Mobile Menu Button */}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="mobile-menu-btn"
          >
            {mobileMenuOpen ? <X size={24} /> : <GameController size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Dropdown */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.nav
            className="nav-mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {navItems.map(item => (
              <div
                key={item.id}
                className={"nav-mobile-link " + (currentPage === item.id ? "active" : "")}
                onClick={() => handleNavClick(item.id)}
                data-testid={"nav-mobile-" + item.id}
              >
                <item.icon size={20} style={{ marginRight: 12 }} />
                {item.label}
              </div>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Navigation;
