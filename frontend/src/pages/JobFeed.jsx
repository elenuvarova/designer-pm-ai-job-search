import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";
import LanguageBadge from "../components/LanguageBadge.jsx";
import SourceCredit from "../components/SourceCredit.jsx";
import Tour, { shouldShowTour } from "../components/Tour.jsx";
import { SkeletonFeed, ErrorState, EmptyState } from "../components/States.jsx";
import { COUNTRY_FLAGS } from "../lib/countries.js";
import { relativeTime, formatSalary } from "../lib/format.js";

// USA + Asia are collected remote-only (see backend collectors).
const REMOTE_COUNTRIES = [["US", "United States"], ["IN", "India"], ["SG", "Singapore"]];

// Rest-of-Europe countries we surface in the filter (home region BE/NL is its own group).
const REST_COUNTRIES = [
  ["GB", "United Kingdom"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"],
  ["IT", "Italy"], ["AT", "Austria"], ["PL", "Poland"], ["PT", "Portugal"],
  ["IE", "Ireland"], ["SE", "Sweden"], ["DK", "Denmark"], ["FI", "Finland"],
  ["NO", "Norway"], ["CH", "Switzerland"], ["LU", "Luxembourg"], ["CZ", "Czechia"],
  ["RO", "Romania"], ["GR", "Greece"], ["HU", "Hungary"],
  ["EE", "Estonia"], ["LV", "Latvia"], ["LT", "Lithuania"],
  ["BG", "Bulgaria"], ["HR", "Croatia"], ["SK", "Slovakia"], ["SI", "Slovenia"], ["IS", "Iceland"],
];

// Disciplines (role_family) grouped by category — mirrors backend/nlp/role.js.
const FAMILIES = {
  Design: [
    "Product Design", "UX Research", "Graphic / Visual Design", "Brand / Art Direction",
    "Motion / 3D / Illustration", "Content Design / UX Writing", "Design Systems", "Design Leadership",
  ],
  Product: ["Product Management", "Product Owner", "Growth / Technical Product", "Product Leadership"],
};

const GRADES = [
  ["intern", "Intern"], ["junior", "Junior"], ["mid", "Mid"],
  ["senior", "Senior"], ["lead", "Lead / Head"],
];

const LANG_DEFAULT = "good,maybe,unknown"; // English-friendly: hides risk + blocker

function CvUploadBanner({ onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef();

  async function handle(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("cv", file);
    try {
      const r = await fetch("/api/cv/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      onUploaded();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="cv-banner">
      <span className="cv-banner-text">
        📄 Upload your CV to rank every job by how well it matches you.
      </span>
      {error && <div className="inline-error">{error}</div>}
      <label className="rag-upload-btn">
        {uploading ? "Analysing CV…" : "Upload CV (PDF or DOCX)"}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          onChange={handle}
          disabled={uploading}
          hidden
        />
      </label>
    </div>
  );
}

function CvScoreBadge({ score }) {
  if (!score || score < 10) return null;
  const level = score >= 25 ? "high" : "mid";
  return <span className={`cv-score-badge ${level}`}>{score}% match</span>;
}

function JobCard({ job, isFirst }) {
  const c = job.JobClassification;
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  return (
    <Link
      to={`/jobs/${job.id}`}
      className="job-card"
      data-tour={isFirst ? "first-card" : undefined}
    >
      <div className="job-card-top">
        <div className="job-title">{job.title}</div>
        <div className="job-card-badges">
          <CvScoreBadge score={job.cv_match} />
          <span data-tour={isFirst ? "lang-badge" : undefined}>
            <LanguageBadge match={c?.language_match} />
          </span>
        </div>
      </div>

      <div className="job-meta">
        {job.company && <span>{job.company}</span>}
        {job.location_raw && (
          <span>{COUNTRY_FLAGS[job.country] || ""} {job.location_raw}</span>
        )}
        {salary && <span className="job-salary">{salary}</span>}
      </div>

      <div className="job-chips">
        {c?.role_family && c.role_family !== "Other / Unclear" && (
          <span className="chip">{c.role_family}</span>
        )}
        {c?.seniority && c.seniority !== "unknown" && (
          <span className="chip">{c.seniority}</span>
        )}
        {c?.employment_type && c.employment_type !== "unclear" && (
          <span className="chip">{c.employment_type.replace("_", "-")}</span>
        )}
        {c?.remote_type && c.remote_type !== "unknown" && (
          <span className="chip">{c.remote_type}</span>
        )}
        {c?.portfolio_required && <span className="chip">📎 portfolio</span>}
        {c?.job_post_language && c.job_post_language !== "english" && (
          <span className="chip chip--warn">posted in {c.job_post_language}</span>
        )}
      </div>

      <div className="job-footer">
        <span>{relativeTime(job.posted_at)}</span>
        <SourceCredit source={job.Source} />
      </div>
    </Link>
  );
}

export default function JobFeed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [showTour, setShowTour] = useState(false);
  const [hasCv, setHasCv]     = useState(null); // null=unknown, false=none, true=yes
  const [reloadKey, setReloadKey] = useState(0);

  const q          = searchParams.get("q")              || "";
  const country    = searchParams.get("country")        || "";
  const category   = searchParams.get("category")       || "";
  const roleFamily = searchParams.get("role_family")    || "";
  const seniority  = searchParams.get("seniority")      || "";
  const langMatch  = searchParams.get("language_match") || LANG_DEFAULT;
  const employment = searchParams.get("employment_type")|| "";
  const remote     = searchParams.get("remote_type")    || "";
  const minSalary  = searchParams.get("min_salary")     || "";
  const portfolio  = searchParams.get("portfolio_required") === "true";
  const page       = parseInt(searchParams.get("page")  || "1");
  const sortParam  = searchParams.get("sort");
  const strongOnly = searchParams.get("min_match") === "25";
  const smart      = searchParams.get("smart") === "1";
  // CV-independent sorts are always available; "match" needs a CV. With no
  // explicit choice, default to match when a CV is present, else newest.
  const VALID_SORTS = ["newest", "oldest", "company", "title", "match"];
  const sort =
    VALID_SORTS.includes(sortParam) ? sortParam
    : hasCv ? "match"
    : "newest";

  const hasFilters =
    q || country || category || roleFamily || seniority || employment || remote ||
    minSalary || portfolio || searchParams.has("language_match");

  const update = useCallback(
    (key, value) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Changing category clears a now-mismatched discipline.
  const updateCategory = useCallback(
    (value) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set("category", value);
      else next.delete("category");
      next.delete("role_family");
      next.delete("page");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const clearAll = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Switch sort mode; leaving "match" also drops the strong-only filter.
  const setSort = useCallback(
    (value) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set("sort", value);
      else next.delete("sort");
      if (value !== "match") next.delete("min_match");
      next.delete("page");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    let active = true; // guard against a stale (aborted) response landing late
    setLoading(true);
    setError(null);

    const onError = (e) => { if (active && e.name !== "AbortError") setError(e.message); };
    const onDone  = () => { if (active) setLoading(false); };

    // Semantic mode: rank by meaning over embeddings (ignores filters/pagination).
    if (smart && q.trim().length >= 3) {
      fetch("/api/search/semantic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
        signal: ctrl.signal,
      })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => {
          if (active) setResult({
            jobs: data.jobs || [],
            total: (data.jobs || []).length,
            pages: 1,
            semantic: true,
            note: data.note,
          });
        })
        .catch(onError)
        .finally(onDone);
      return () => { active = false; ctrl.abort(); };
    }

    const params = new URLSearchParams();
    if (country)    params.set("country", country);
    if (category)   params.set("category", category);
    if (roleFamily) params.set("role_family", roleFamily);
    if (seniority)  params.set("seniority", seniority);
    if (langMatch && langMatch !== "all") params.set("language_match", langMatch);
    if (employment) params.set("employment_type", employment);
    if (remote)     params.set("remote_type", remote);
    if (minSalary)  params.set("min_salary", minSalary);
    if (portfolio)  params.set("portfolio_required", "true");
    if (q)          params.set("q", q);
    params.set("home_first", "1"); // surface BE/NL first (ignored when a country is picked)
    if (sort !== "newest") params.set("sort", sort);
    if (sort === "match" && strongOnly) params.set("min_match", "25");
    params.set("page", page);
    params.set("limit", "25");

    fetch(`/api/jobs?${params}`, { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { if (active) setResult(data); })
      .catch(onError)
      .finally(onDone);
    return () => { active = false; ctrl.abort(); };
  }, [country, category, roleFamily, seniority, langMatch, employment, remote, minSalary, portfolio, q, page, sort, strongOnly, smart, reloadKey]);

  // Auto-launch tour for first-time users (after data loads)
  useEffect(() => {
    if (!loading && result && shouldShowTour()) setShowTour(true);
  }, [loading, result]);

  // Check once on mount whether a CV is uploaded
  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((cv) => setHasCv(!!cv))
      .catch(() => setHasCv(false));
  }, []);

  const disciplineOptions = category ? FAMILIES[category] || [] : null;

  return (
    <div>
      <Navbar onHelpClick={() => setShowTour(true)} />

      <div className="page">
        {/* Filter bar */}
        <div className="filters" data-tour="filters">
          <div className="filter-group search-group">
            <label className="filter-label" htmlFor="f-q">Search</label>
            <div className="search-input-wrap">
              <input
                id="f-q"
                type="text"
                placeholder={smart ? "Describe what you want…" : "Job title…"}
                value={q}
                onChange={(e) => update("q", e.target.value)}
              />
              <button
                type="button"
                className={`smart-toggle ${smart ? "is-active" : ""}`}
                onClick={() => update("smart", smart ? "" : "1")}
                title="Semantic search — rank by meaning, not keywords"
                aria-pressed={smart}
              >
                ✨ Smart
              </button>
            </div>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-category">Category</label>
            <select id="f-category" value={category} onChange={(e) => updateCategory(e.target.value)}>
              <option value="">All</option>
              <option value="Design">🎨 Design</option>
              <option value="Product">📦 Product</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-discipline">Discipline</label>
            <select id="f-discipline" value={roleFamily} onChange={(e) => update("role_family", e.target.value)}>
              <option value="">All</option>
              {disciplineOptions
                ? disciplineOptions.map((f) => <option key={f} value={f}>{f}</option>)
                : Object.entries(FAMILIES).map(([cat, fams]) => (
                    <optgroup key={cat} label={cat}>
                      {fams.map((f) => <option key={f} value={f}>{f}</option>)}
                    </optgroup>
                  ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-grade">Grade</label>
            <select id="f-grade" value={seniority} onChange={(e) => update("seniority", e.target.value)}>
              <option value="">All</option>
              {GRADES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-country">Country</label>
            <select id="f-country" value={country} onChange={(e) => update("country", e.target.value)}>
              <option value="">All of Europe</option>
              <optgroup label="Focus · Belgium &amp; Netherlands">
                <option value="BE">🇧🇪 Belgium</option>
                <option value="NL">🇳🇱 Netherlands</option>
              </optgroup>
              <optgroup label="Rest of Europe">
                {REST_COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>{COUNTRY_FLAGS[code]} {name}</option>
                ))}
              </optgroup>
              <optgroup label="Remote · US &amp; Asia">
                {REMOTE_COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>{COUNTRY_FLAGS[code]} {name} (remote)</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-lang">Language</label>
            <select id="f-lang" value={langMatch} onChange={(e) => update("language_match", e.target.value)}>
              <option value={LANG_DEFAULT}>✓ English-friendly</option>
              <option value="all">Show all (incl. local language)</option>
              <option value="good">English only</option>
              <option value="maybe">~ Maybe (preferred)</option>
              <option value="risk">! Risk (likely required)</option>
              <option value="blocker">✗ Blocker (required)</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-emp">Employment</label>
            <select id="f-emp" value={employment} onChange={(e) => update("employment_type", e.target.value)}>
              <option value="">All</option>
              <option value="full_time">Full-time</option>
              <option value="contract">Contract / Freelance</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-remote">Remote</label>
            <select id="f-remote" value={remote} onChange={(e) => update("remote_type", e.target.value)}>
              <option value="">All</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="f-salary">Min salary</label>
            <input
              id="f-salary"
              type="number"
              min="0"
              step="5000"
              placeholder="e.g. 50000"
              value={minSalary}
              onChange={(e) => update("min_salary", e.target.value)}
            />
          </div>

          <div className="filter-group filter-group--checkbox">
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={portfolio}
                onChange={(e) => update("portfolio_required", e.target.checked ? "true" : "")}
              />
              📎 Portfolio required
            </label>
          </div>

          {hasFilters && (
            <button className="filter-clear" onClick={clearAll}>
              Clear all
            </button>
          )}
        </div>

        {/* Language legend */}
        <div className="lang-legend">
          <span>Language:</span>
          {[
            { key: "good",    icon: "✓", tip: "English only" },
            { key: "maybe",   icon: "~", tip: "Optional local language" },
            { key: "risk",    icon: "!", tip:  "Likely required" },
            { key: "blocker", icon: "✗", tip: "Hard requirement" },
          ].map(({ key, icon, tip }) => (
            <span key={key} className="lang-legend-item">
              <span className={`lang-badge ${key}`}>{icon}</span>
              <span>{tip}</span>
            </span>
          ))}
        </div>

        {/* CV upload — rank jobs by match (single-user: one employee, one CV) */}
        {hasCv === false && !smart && (
          <CvUploadBanner onUploaded={() => setHasCv(true)} />
        )}

        {/* Sort */}
        {!smart && (
          <div className="sort-bar">
            <span className="sort-bar-label">Sort</span>
            <select
              className="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort jobs"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="company">Company A–Z</option>
              <option value="title">Title A–Z</option>
              {hasCv && <option value="match">★ Best match</option>}
            </select>
            {hasCv && sort === "match" && (
              <label className="sort-strong">
                <input
                  type="checkbox"
                  checked={strongOnly}
                  onChange={(e) => update("min_match", e.target.checked ? "25" : "")}
                />
                Strong only
              </label>
            )}
          </div>
        )}

        {/* Stats */}
        {result && (
          <div className="feed-stats">
            <strong>{result.total}</strong> jobs
            {langMatch === LANG_DEFAULT && " · English-friendly"}
            {country && ` · ${country}`}
            {result.sort === "match" &&
              (result.capped ? " · best matches among the 600 most recent jobs" : " · sorted by CV match")}
            {result.semantic && " · ✨ semantic"}
            {result.pages > 1 && ` · page ${page} of ${result.pages}`}
          </div>
        )}

        {result?.semantic && result?.note && (
          <div className="status-msg">{result.note}</div>
        )}

        {loading && <SkeletonFeed />}

        {!loading && error && (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        )}

        {!loading && !error && result?.jobs?.length === 0 && (
          <EmptyState
            title="No jobs match these filters"
            action={
              hasFilters && (
                <button className="empty-clear" onClick={clearAll}>Clear all filters</button>
              )
            }
          />
        )}

        {!loading && !error && result?.jobs?.map((job, i) => (
          <JobCard key={job.id} job={job} isFirst={i === 0} />
        ))}

        {!loading && !error && result && result.pages > 1 && (
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => update("page", String(page - 1))}>
              ← Prev
            </button>
            <span className="pagination-info">{page} / {result.pages}</span>
            <button disabled={page >= result.pages} onClick={() => update("page", String(page + 1))}>
              Next →
            </button>
          </div>
        )}
      </div>

      {showTour && <Tour onDone={() => setShowTour(false)} />}
    </div>
  );
}
