import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";
import LanguageBadge from "../components/LanguageBadge.jsx";
import SourceCredit from "../components/SourceCredit.jsx";
import { SkeletonFeed, ErrorState } from "../components/States.jsx";
import { COUNTRY_FLAGS } from "../lib/countries.js";
import { relativeTime, formatSalary } from "../lib/format.js";

function ApplyButton({ url }) {
  if (!url) return null;
  // Defense in depth: only link out to real http(s) URLs; anything else
  // (e.g. javascript:, relative junk) renders as plain, non-clickable text.
  if (!/^https?:\/\//i.test(url)) return <span className="apply-btn">Apply →</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="apply-btn">
      Apply →
    </a>
  );
}

const ACTION_LABELS = {
  "apply-kit":     "📦 Apply kit",
  "tailor-cv":     "✨ Tailor CV",
  "cover-letter":  "✉ Cover Letter",
  "interview-prep":"🎯 Interview Prep",
};

function RagPanel({ jobId }) {
  const [cv, setCv]               = useState(undefined); // undefined = loading, null = none
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [action, setAction]       = useState(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragResult, setRagResult] = useState(null);
  const [ragError, setRagError]   = useState(null);
  const [copied, setCopied]       = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then(setCv)
      .catch(() => setCv(null));
  }, []);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("cv", file);
    try {
      const r = await fetch("/api/cv/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      setCv(data);
      setRagResult(null);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!cv?.id) return;
    await fetch(`/api/cv/${cv.id}`, { method: "DELETE" });
    setCv(null);
    setRagResult(null);
  }

  async function runAction(act) {
    setAction(act);
    setRagLoading(true);
    setRagResult(null);
    setRagError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/${act}`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Request failed");
      setRagResult(data.result);
    } catch (err) {
      setRagError(err.message);
    } finally {
      setRagLoading(false);
    }
  }

  function copyResult() {
    if (!ragResult) return;
    navigator.clipboard.writeText(ragResult).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadResult() {
    if (!ragResult) return;
    const blob = new Blob([ragResult], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${action || "result"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (cv === undefined) return null; // still loading CV status

  return (
    <div className="detail-section">
      <div className="detail-section-title">AI Assistant</div>

      {!cv ? (
        <div className="rag-upload-prompt">
          <p className="rag-upload-hint">
            Upload your CV to enable AI-powered tailoring, cover letters and interview prep.
          </p>
          <label className="rag-upload-btn">
            {uploading ? "Analysing CV…" : "Upload CV (PDF or DOCX)"}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx"
              onChange={handleUpload}
              disabled={uploading}
              hidden
            />
          </label>
          {uploadError && <div className="inline-error">{uploadError}</div>}
        </div>
      ) : (
        <div>
          <div className="rag-cv-bar">
            <span className="rag-cv-name">📄 {cv.label}</span>
            <button className="rag-cv-remove" onClick={handleRemove}>Remove</button>
          </div>

          <div className="rag-actions">
            {Object.entries(ACTION_LABELS).map(([act, label]) => (
              <button
                key={act}
                className={`rag-action-btn ${action === act && ragLoading ? "loading" : ""}`}
                onClick={() => runAction(act)}
                disabled={ragLoading}
              >
                {action === act && ragLoading ? "Generating…" : label}
              </button>
            ))}
          </div>

          {ragError && <div className="error-msg" style={{ marginTop: "var(--space-3)" }}>{ragError}</div>}

          {ragResult && (
            <div className="rag-result">
              <div className="rag-result-header">
                <span>{ACTION_LABELS[action]}</span>
                <span className="rag-result-btns">
                  <button className="rag-copy-btn" onClick={copyResult}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                  <button className="rag-copy-btn" onClick={downloadResult}>
                    Download
                  </button>
                </span>
              </div>
              <pre className="rag-result-text">{ragResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS = {
  saved: "Saved", need_cv: "Need CV", applied: "Applied",
  interview: "Interview", offer: "Offer 🎉", rejected: "Rejected", archived: "Archived",
};

function SaveButton({ jobId }) {
  const [app, setApp] = useState(undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/applications?job_id=${jobId}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((arr) => setApp(arr?.[0] || null))
      .catch((e) => { if (e.name !== "AbortError") setApp(null); });
    return () => ctrl.abort();
  }, [jobId]);

  async function save() {
    const r = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    });
    const data = await r.json();
    setApp(data);
  }

  async function changeStatus(status) {
    if (!app) return;
    const r = await fetch(`/api/applications/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setApp(await r.json());
  }

  if (app === undefined) return null;

  if (!app) {
    return (
      <button className="save-btn" onClick={save}>
        + Save
      </button>
    );
  }

  return (
    <select
      className="status-select-inline"
      value={app.status}
      onChange={(e) => changeStatus(e.target.value)}
      title="Change status"
    >
      {Object.entries(STATUS_LABELS).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function SkillGap({ jobId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/cv/skill-gap/${jobId}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => { if (e.name !== "AbortError") setData(null); });
    return () => ctrl.abort();
  }, [jobId]);

  if (!data || !data.has_cv) return null;
  if (!data.matched.length && !data.missing.length) return null;

  return (
    <div className="detail-section">
      <div className="detail-section-title">Your CV vs this job</div>
      <div className="skillgap">
        {data.matched.length > 0 && (
          <div className="skillgap-row">
            <span className="skillgap-label match">✓ You have ({data.matched.length})</span>
            <div className="skills-grid">
              {data.matched.map((s) => (
                <span key={s} className="skill-chip match">{s}</span>
              ))}
            </div>
          </div>
        )}
        {data.missing.length > 0 && (
          <div className="skillgap-row">
            <span className="skillgap-label gap">✗ Gaps ({data.missing.length})</span>
            <div className="skills-grid">
              {data.missing.map((s) => (
                <span key={s} className="skill-chip gap">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompanyBrief({ jobId, company }) {
  const [loading, setLoading] = useState(false);
  const [brief, setBrief]     = useState(null);
  const [error, setError]     = useState(null);

  if (!company) return null;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/company-brief`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setBrief(data.result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="detail-section">
      <div className="detail-section-title">Company brief</div>
      {!brief && !loading && (
        <button className="rag-action-btn" onClick={generate}>
          🏢 Brief me on {company}
        </button>
      )}
      {loading && <div className="status-msg">Researching {company}…</div>}
      {error && <div className="error-msg" style={{ marginTop: "var(--space-3)" }}>{error}</div>}
      {brief && <pre className="rag-result-text">{brief}</pre>}
    </div>
  );
}

function SimilarJobs({ jobId }) {
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/jobs/${jobId}/similar`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch((e) => { if (e.name !== "AbortError") setJobs([]); });
    return () => ctrl.abort();
  }, [jobId]);

  if (!jobs || jobs.length === 0) return null;

  return (
    <div className="detail-section">
      <div className="detail-section-title">Similar roles</div>
      <div className="similar-list">
        {jobs.map((j) => (
          <Link key={j.id} to={`/jobs/${j.id}`} className="similar-item">
            <span className="similar-title">{j.title}</span>
            <span className="similar-meta">
              {j.company}
              {j.JobClassification?.role_family &&
              j.JobClassification.role_family !== "Other / Unclear"
                ? ` · ${j.JobClassification.role_family}`
                : ""}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Go back through history so the filtered/sorted feed is restored exactly;
  // fall back to a clean /jobs only when this page was opened directly (no in-app history).
  const backToJobs = () => (location.key === "default" ? navigate("/jobs") : navigate(-1));
  const [job, setJob]           = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/${id}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setJob)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, reloadKey]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page" style={{ paddingTop: "var(--space-6)" }}><SkeletonFeed rows={3} /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <Navbar />
        <div className="page" style={{ paddingTop: "var(--space-6)" }}>
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        </div>
      </>
    );
  }
  if (!job) return null;

  const c            = job.JobClassification;
  const skills       = job.JobSkills || [];
  const requiredLangs = c?.required_languages || [];
  const optionalLangs = c?.optional_languages || [];
  const showLangBlock = requiredLangs.length > 0 || optionalLangs.length > 0;

  return (
    <div>
      <Navbar />

      <div className="page">
        <button className="back-btn" onClick={backToJobs}>
          ← Back to jobs
        </button>

        {/* Header */}
        <div className="detail-header">
          <div className="detail-title">{job.title}</div>
          <div className="detail-company">
            {job.company}
            {job.location_raw && (
              <> · {COUNTRY_FLAGS[job.country] || ""} {job.location_raw}</>
            )}
            {formatSalary(job.salary_min, job.salary_max, job.salary_currency) && (
              <> · {formatSalary(job.salary_min, job.salary_max, job.salary_currency)}</>
            )}
            {job.posted_at && <> · Posted {relativeTime(job.posted_at)}</>}
          </div>
        </div>

        {/* Badges */}
        <div className="detail-badges">
          <LanguageBadge match={c?.language_match} large />
          {c?.employment_type && c.employment_type !== "unclear" && (
            <span className="chip">{c.employment_type.replace("_", "-")}</span>
          )}
          {c?.remote_type && c.remote_type !== "unknown" && (
            <span className="chip">{c.remote_type}</span>
          )}
          {c?.role_family && c.role_family !== "Other / Unclear" && (
            <span className="chip">{c.role_family}</span>
          )}
          {c?.seniority && c.seniority !== "unknown" && (
            <span className="chip">{c.seniority}</span>
          )}
          {c?.portfolio_required && <span className="chip">📎 portfolio required</span>}
          {c?.job_post_language && (
            <span className="chip chip--warn">posted in {c.job_post_language}</span>
          )}
        </div>

        {/* Apply CTA — above description so it's always in view */}
        <div className="detail-cta">
          <ApplyButton url={job.apply_url} />
          <SaveButton jobId={id} />
          <SourceCredit source={job.Source} />
        </div>

        {/* Language requirements */}
        {showLangBlock && (
          <div className="detail-section">
            <div className="detail-section-title">Language requirements</div>
            <div className="lang-list">
              {requiredLangs.map((l) => (
                <div key={l} className="lang-item required">✗ Required: {l}</div>
              ))}
              {optionalLangs.map((l) => (
                <div key={l} className="lang-item optional">~ Preferred: {l}</div>
              ))}
            </div>
          </div>
        )}
        {!showLangBlock && c && (
          <div className="detail-section">
            <div className="detail-section-title">Language requirements</div>
            <div className="lang-list">
              <div className="lang-item ok">✓ English only — no local language required</div>
            </div>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Detected skills</div>
            <div className="skills-grid">
              {skills.map((s) => (
                <span key={s.skill} className="skill-chip">{s.skill}</span>
              ))}
            </div>
          </div>
        )}

        {/* CV ↔ job skill gap (only renders when a CV is uploaded) */}
        <SkillGap jobId={id} />

        {/* Description — expandable */}
        {job.description && (
          <div className="detail-section">
            <div className="detail-section-title">Job description</div>
            <div className={`description-box ${expanded ? "expanded" : ""}`}>
              {job.description}
            </div>
            {!expanded && (
              <button className="expand-btn" onClick={() => setExpanded(true)}>
                Show full description ↓
              </button>
            )}
          </div>
        )}

        {/* Company brief (LLM, no CV needed). key={id} forces a fresh state when
            navigating job→job (e.g. via Similar roles) so stale output never sticks. */}
        <CompanyBrief key={id} jobId={id} company={job.company} />

        {/* RAG Assistant */}
        <RagPanel key={id} jobId={id} />

        {/* Similar roles (embedding-based) */}
        <SimilarJobs jobId={id} />

        {/* Bottom apply anchor */}
        {job.apply_url && (
          <div style={{ marginTop: "var(--space-6)" }}>
            <ApplyButton url={job.apply_url} />
          </div>
        )}
      </div>
    </div>
  );
}
