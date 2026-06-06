import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";
import LanguageBadge from "../components/LanguageBadge.jsx";
import { SkeletonFeed, ErrorState } from "../components/States.jsx";
import { COUNTRY_FLAGS } from "../lib/countries.js";
import { relativeTime } from "../lib/format.js";

const STATUSES = ["saved", "need_cv", "applied", "interview", "offer", "rejected", "archived"];

const STATUS_CONFIG = {
  saved:     { label: "Saved",      cls: "status-saved" },
  need_cv:   { label: "Need CV",    cls: "status-need-cv" },
  applied:   { label: "Applied",    cls: "status-applied" },
  interview: { label: "Interview",  cls: "status-interview" },
  offer:     { label: "Offer 🎉",   cls: "status-offer" },
  rejected:  { label: "Rejected",   cls: "status-rejected" },
  archived:  { label: "Archived",   cls: "status-archived" },
};

function ApplicationRow({ app, onStatusChange, onDelete }) {
  const job = app.Job;
  const cfg = STATUS_CONFIG[app.status] || STATUS_CONFIG.saved;

  return (
    <div className="app-row">
      <div className="app-row-main">
        <Link to={`/jobs/${job.id}`} className="app-job-title">
          {job.title}
        </Link>
        <span className="app-job-meta">
          {job.company}
          {job.location_raw && (
            <> · {COUNTRY_FLAGS[job.country] || ""} {job.location_raw}</>
          )}
        </span>
        {job.JobClassification && (
          <div className="app-chips">
            {job.JobClassification.role_family &&
              job.JobClassification.role_family !== "Other / Unclear" && (
                <span className="chip">{job.JobClassification.role_family}</span>
              )}
            <LanguageBadge match={job.JobClassification.language_match} />
          </div>
        )}
      </div>

      <div className="app-row-actions">
        <select
          className={`status-select ${cfg.cls}`}
          value={app.status}
          onChange={(e) => onStatusChange(app.id, e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
        <span className="app-date">{relativeTime(app.updated_at)}</span>
        <button
          className="app-delete-btn"
          onClick={() => onDelete(app.id)}
          title="Remove"
          aria-label="Remove application"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function Applications() {
  const [apps, setApps]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState("all");
  const [actionError, setActionError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/applications")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setApps)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  async function handleStatusChange(id, status) {
    setActionError(null);
    const prev = apps; // snapshot for revert
    setApps((cur) => cur.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const r = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      setApps(prev); // revert — keep UI in sync with the server
      setActionError("Couldn't update status. Please try again.");
    }
  }

  async function handleDelete(id) {
    setActionError(null);
    const prev = apps; // snapshot for revert
    setApps((cur) => cur.filter((a) => a.id !== id));
    try {
      const r = await fetch(`/api/applications/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      setApps(prev); // revert — keep UI in sync with the server
      setActionError("Couldn't remove the application. Please try again.");
    }
  }

  const filtered = filter === "all" ? apps : apps.filter((a) => a.status === filter);
  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = apps.filter((a) => a.status === s).length;
    return acc;
  }, {});

  // Funnel (from current statuses; a rejected app still counts as "submitted").
  const submitted    = counts.applied + counts.interview + counts.offer + counts.rejected;
  const interviewing = counts.interview + counts.offer;
  const offers       = counts.offer;
  const interviewRate = submitted ? Math.round((interviewing / submitted) * 100) : 0;
  const offerRate     = submitted ? Math.round((offers / submitted) * 100) : 0;

  return (
    <div>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Application Tracker</h1>
          <span className="feed-stats">
            <strong>{apps.length}</strong> saved
          </span>
        </div>

        {/* Funnel */}
        {submitted > 0 && (
          <div className="funnel">
            <div className="funnel-row">
              <div className="funnel-stage">
                <div className="funnel-count">{submitted}</div>
                <div className="funnel-label">Applied</div>
              </div>
              <span className="funnel-arrow" aria-hidden="true">→</span>
              <div className="funnel-stage">
                <div className="funnel-count">{interviewing}</div>
                <div className="funnel-label">Interview</div>
                <div className="funnel-rate">{interviewRate}%</div>
              </div>
              <span className="funnel-arrow" aria-hidden="true">→</span>
              <div className="funnel-stage">
                <div className="funnel-count">{offers}</div>
                <div className="funnel-label">Offer</div>
                <div className="funnel-rate">{offerRate}%</div>
              </div>
            </div>
          </div>
        )}

        {/* Status filter tabs */}
        <div className="status-tabs">
          <button
            className={`status-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All <span className="tab-count">{apps.length}</span>
          </button>
          {STATUSES.filter((s) => counts[s] > 0 || filter === s).map((s) => (
            <button
              key={s}
              className={`status-tab ${filter === s ? "active" : ""}`}
              onClick={() => setFilter(s)}
            >
              {STATUS_CONFIG[s].label}
              {counts[s] > 0 && <span className="tab-count">{counts[s]}</span>}
            </button>
          ))}
        </div>

        {actionError && <div className="inline-error">{actionError}</div>}

        {loading && <SkeletonFeed rows={4} />}

        {!loading && error && (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <div className="empty-title">
              {apps.length === 0
                ? "No saved applications yet"
                : "No applications with this status"}
            </div>
            {apps.length === 0 && (
              <Link to="/jobs" className="empty-clear">Browse jobs →</Link>
            )}
          </div>
        )}

        <div className="app-list">
          {filtered.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
