import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme.js";

export default function Navbar({ onHelpClick }) {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();

  const navLink = (to, label) => (
    <Link to={to} className={`nav-link ${pathname.startsWith(to) ? "active" : ""}`}>
      {label}
    </Link>
  );

  return (
    <nav className="navbar">
      <Link to="/jobs" className="navbar-brand">
        Design &amp; Product Job Scout
      </Link>
      <div className="nav-links">
        {navLink("/jobs", "Jobs")}
        {navLink("/analyze", "Analyze")}
        {navLink("/chat", "Ask")}
        {navLink("/applications", "Tracker")}
        {navLink("/skills", "Skills")}
      </div>
      <div className="navbar-actions">
        {onHelpClick && (
          <button className="help-btn" onClick={onHelpClick} title="Show tour">
            ? Tour
          </button>
        )}
        <button
          className="theme-btn"
          onClick={toggle}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </nav>
  );
}
