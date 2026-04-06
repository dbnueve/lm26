import React from "react";
import { TeamLogosContext, TeamModalContext } from "../shared";

// TeamLogo component — shows club logo or falls back to abbr text
// Clicking opens TeamDetailModal (pass noClick to suppress)
const TeamLogo = ({ teamId, abbr, size = 32, style = {}, noClick = false }) => {
  const logos = React.useContext(TeamLogosContext);
  const { openTeam } = React.useContext(TeamModalContext);
  const url = logos[teamId];
  const handleClick = (!noClick && teamId)
    ? (e) => { e.stopPropagation(); openTeam(teamId, abbr); }
    : undefined;
  const clickStyle = (!noClick && teamId) ? { cursor: "pointer" } : {};
  if (!url) return <span style={{ ...clickStyle, ...style }} onClick={handleClick}>{abbr}</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", ...clickStyle }}>
      <img
        src={url}
        alt={abbr}
        title={abbr}
        onClick={handleClick}
        style={{ width: size, height: size, objectFit: "contain", marginBottom: 4, ...clickStyle, ...style }}
        onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.insertAdjacentText("afterend", abbr); }}
      />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>{abbr}</span>
    </div>
  );
};

export default TeamLogo;
