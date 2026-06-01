# Europe Design & Product Job Scout — Free Implementation Plan

> A personal job-search intelligence tool for **Designers and Product Managers** across **all of Europe + the UK**, with **Belgium and the Netherlands** as the prioritized home region. It collects vacancies from free sources, normalizes messy multilingual job data, classifies role **category / discipline / grade**, detects employment type and **language blockers** (is English enough, or is a local language required?), scores each role against your CV, and helps you prioritize and tailor applications.
>
> **History:** this started as the *Benelux AI Job Scout* (ML / Data / AI roles in BE/NL/LU). It was repurposed in June 2026 to target Design & Product roles across Europe — the architecture below is unchanged; only the domain (role/skill rules, search terms, geography, filters, branding) was swapped. Sections describing ML roles / Benelux-only scope are kept for historical context.
>
> **Hard constraint: $0 to build and $0 to run, for a single user.** Every component was chosen against free-tier limits. Free tiers move — these were last verified **2026-06-01**, and one has since tightened: Gemini cut its free request quota in Dec 2025 (see §2 / §12). The design still runs at $0; the headroom is just smaller than first written.

---

## What actually shipped (built vs planned)

This document is the original design. The codebase has since evolved — this table is the source of truth for what exists today (2026-06).

| Area | Planned here | Actually shipped |
|---|---|---|
| **Job sources** | 5 (Adzuna, Arbeitnow, Remotive, Muse, Greenhouse) | **14**: + RemoteOK, Jobicy, Lever, **EURES** (native LU/BE/NL), Recruitee, SmartRecruiters, Ashby, Workable, HN "Who's Hiring" |
| **Geographic scope** | Benelux (BE/NL/LU) | Benelux in full **+ wider EU & UK filtered to remote/contract** (Adzuna gb/de/fr/es/it/at/pl behind a remote-or-contract gate; remote feeds) |
| **Embeddings** | Local `transformers.js` (`multilingual-e5-small`, 384-dim) | **Gemini `gemini-embedding-001`** API, 768-dim (`backend/rag/embed.js`). The local model was never added. |
| **Fit scoring** | Weighted formula (35% skill · 20% role · …) + apply-priority tiers | **CV-match % via term overlap** (`backend/routes/cv.js`, `/api/cv/scores`) — no weighted formula or priority tiers yet |
| **Data models** | incl. `SearchProfile`, `JobScore` | Not built. Shipped: Source, Job, JobClassification, JobSkill, Application, CvDocument, CvChunk |
| **API routers** | profiles, scoring, jobs sub-routes (save/hide/apply) | jobs, collect, **classify**, cv, rag, **applications**, **analytics** (no profiles router) |
| **Frontend** | "no router for v1" | React Router + pages JobFeed/JobDetail/Applications/**Skills** + guided Tour + theme toggle |
| **Deploy** | Render web service + Neon Postgres + GitHub Actions cron | As planned (Render web + Neon + Actions) |
| **Cross-source dedup** | "keep richest description, merge sources" | App-level skip on `dedupe_hash` in `scripts/collect.js` (store-once, no merge) |

---

## 0. Key decisions (locked, with rationale)

| Decision | Choice | Why (research-backed) |
|---|---|---|
| **Backend language** | **Node.js + Express** — extend the existing template, do **not** rewrite to Python/FastAPI | Every multilingual NLP task is achievable in Node with free libs. The template already solves single-service free deploy, DB portability, health checks, and the React build. Python would discard all of that, add a second language, and ship a heavier image on a 512 MB free tier. |
| **Frontend** | **React + Vite (JavaScript)** — the existing `frontend/` | Already wired (dev proxy, build → `dist`, served by Express in prod). Keep JS, not TS, for PM simplicity and template alignment. |
| **Database (prod)** | **Neon Free** Postgres | Render's free Postgres **self-deletes ~44 days after creation** — disqualifying. Neon **never expires, never deletes**, ~ms cold resume, includes `pgvector`. |
| **Database (local)** | **SQLite** (unchanged) | Zero install. `db.js` already auto-switches dialect from `DATABASE_URL`. |
| **Vector storage (v1)** | **Embeddings as a JSON column + brute-force cosine in Node** | A single-user scout has a small corpus (hundreds–few-thousand vectors). Brute-force cosine is sub-millisecond and works **identically on SQLite and Postgres** with no extension. `pgvector`/HNSW on Neon is the documented scale-up path, not an MVP need. |
| **Scheduled collector** | **GitHub Actions cron** (public repo) running a Node script against Neon | Render Cron is **paid-only**. GitHub Actions in a public repo = **unlimited free minutes**, can run long jobs, survives the web service sleeping. |
| **Web service** | **Render free web service** (existing Dockerfile/`render.yaml`) | Simplest one-click Blueprint deploy. Accept ~60 s cold start after 15 min idle (fine for a personal tool). |
| **LLM (only where needed)** | **Gemini 2.5 Flash** primary, **Groq Llama 3.3 70B** fallback | Gemini free tier was 1,500 req/day when planned; **Google cut it to ~250–500 req/day in Dec 2025**. Still ample for one user since Tasks 1–5 are rule-based (zero calls). Groq (1,000 req/day, confirmed) is the practical workhorse for the LLM tail. Behind a thin provider abstraction so swaps are config-only. |
| **Embeddings** | **Gemini `gemini-embedding-001`** (768-dim) via API *(shipped; the planned local `transformers.js` was never added)* | Multilingual EN/NL/FR/DE. **Note:** the predecessor `text-embedding-004` was shut down 2026-01-14 — migrated to `gemini-embedding-001`. This spends a (separate) free quota, unlike the originally-planned offline model; revisit local embeddings if it ever bites. |
| **NLP strategy** | **Rule-based first, LLM only for the ambiguous tail** | 5 of 7 tasks are reliably rule-based using the doc's existing multilingual keyword lists → near-zero API spend at steady state. |

**Sources shipped (free, all zero-cost):** Adzuna · **EURES** (native LU/BE/NL) · Arbeitnow · Remotive · RemoteOK · Jobicy · The Muse · Greenhouse · Lever · Recruitee · SmartRecruiters · Ashby · Workable · HN "Who's Hiring". *(Planned v1 was the first five; the rest were added later.)*
**Deferred / confirmed unavailable:** VDAB (needs signed partner agreement), ADEM/`data.public.lu` (open data is skills *statistics*, not vacancies), UWV/werk.nl (no API), Indeed publisher API (dead since 2020), Moovijob/jobs.lu (bot-blocked). LinkedIn/Indeed scraping: **out of scope** (ToS).

---

## 1. Architecture

```
                          ┌─────────────────────────────────────┐
                          │   GitHub Actions (cron, public repo) │
                          │   daily: node scripts/collect.js     │  ← FREE scheduler
                          └───────────────┬─────────────────────┘
                                          │ fetch → normalize → classify → score
                                          │ (rule-based; LLM only for ambiguous tail)
                                          ▼
   Free job APIs ───────────────►  ┌──────────────┐  writes      ┌──────────────────┐
   Adzuna / Arbeitnow /            │  Collector   │ ───────────► │  Neon Postgres    │
   Remotive / Muse / Greenhouse    │  (Node)      │              │  (never expires)  │
                                   └──────────────┘              │  jobs, scores,    │
                                                                 │  cv_chunks(+vec)  │
                                          ┌──────────────────────┤                  │
                                          │ reads                └──────────────────┘
                                          ▼                               ▲
   Browser ──► ┌──────────────────────────────────────┐  reads/writes    │
               │  Render free web service (one container)│ ────────────────┘
               │  Express API  +  built React (static)   │
               │  /api/*  +  SPA fallback                │
               │  RAG: local embeddings + Gemini/Groq    │ ──► Gemini 2.5 Flash (free)
               └──────────────────────────────────────┘      Groq (fallback)
```

**Why this shape:** the heavy, bursty work (fetch + classify hundreds of jobs) runs in GitHub Actions — which doesn't sleep and is free — and only *writes results* to Neon. The Render web service stays light: it reads from Neon and serves the UI + on-demand RAG. The DB is the durable hub both share.

---

## 2. The $0 guarantee (component-by-component)

| Component | Provider / approach | Free limit that matters | Cost |
|---|---|---|---|
| Web service + API + UI | Render free web service | 750 instance-hrs/mo; sleeps after 15 min (~60 s cold start) | $0 |
| Database | Neon Free | 0.5 GB/project, never expires, ~ms resume | $0 |
| Scheduled collector | GitHub Actions (public repo) | Unlimited minutes; min 5-min interval | $0 |
| Job data — Adzuna | REST + free key (instant) | ~250 calls/day *(observed, not documented)* | $0 |
| Job data — EURES | Zero-auth JSON search API | none published; poll politely ~daily | $0 |
| Job data — Arbeitnow / Remotive / RemoteOK | Zero-auth feeds | generous; cache once/day | $0 |
| Job data — The Muse | Free key | 3,600 req/hr | $0 |
| Job data — Greenhouse / Lever / Recruitee / SmartRecruiters | Public board APIs | per-company; polite ~daily | $0 |
| Job data — HN "Who's Hiring" | Algolia HN API (zero-auth) | generous | $0 |
| Language detect, employment, role, skills | Rule-based (offline) | unlimited | $0 |
| Embeddings | Gemini `gemini-embedding-001` (API) | shares the Gemini free quota | $0 |
| LLM (classification tail + RAG) | Gemini 2.5 Flash | **~250–500 req/day** (cut from 1,500 in Dec 2025) | $0 |
| LLM fallback | Groq Llama 3.3 70B | ~1,000 req/day | $0 |

**Steady-state LLM budget:** Tasks 1–5 cost **zero** API calls. Only the low-confidence classification tail and RAG chats consume the Gemini/Groq quotas — still well above what a single user needs even after the Dec-2025 cut, with Groq's 1,000/day as the fallback workhorse.

---

## 3. Data sources (v1) — usage & obligations

| Source | Auth | Coverage | Role density | Attribution / ToS to honor |
|---|---|---|---|---|
| **Adzuna** | free key (instant) | **BE + NL + LU native** + salary | High | Show **"Jobs by Adzuna"** logo + credit Adzuna as source. Personal use tolerated; don't redistribute. **The backbone — and the only free native LU source.** |
| **Arbeitnow** | none | EU (DE-heavy) + remote | Good | Requires a **backlink to Arbeitnow.com**. Filter `location` client-side for BE/NL/LU. |
| **Remotive** | none | Remote-EU/worldwide only | High (AI/Data categories) | **Link back to the Remotive job URL + credit "Remotive."** Do **not** re-post its jobs elsewhere. Cache once/day. |
| **The Muse** | free key | BE/NL/LU city filters | Moderate | Easy win; curated employers. |
| **Greenhouse** | none (GET) | per-company (curated slugs) | Very high per company | Maintain a hand-picked list of Benelux-hiring companies' `board_token`s. Best as enrichment, not discovery. |

**Deferred / avoided:** VDAB (partner agreement + signed cooperation; use only their aggregated open dataset for trends later), ADEM/`data.public.lu` (no live listing API; the open dataset is skills *statistics*, not vacancies), Jooble (sales-gated key), Reed/USAJobs (no Benelux), LinkedIn/Indeed (ToS — out of scope).

**Luxembourg reality:** the only free *live* LU vacancy stream is **Adzuna `lu`**. Plan LU coverage around it; lean on Greenhouse slugs of LU-based finance/consulting firms to enrich.

---

## 4. Data model (Sequelize)

All via Sequelize `sequelize.define(...)`, additive to the existing `db.js`. Maps the doc's schema onto a Node/portable shape. Embeddings stored as JSON text (portable across SQLite/Postgres).

```
Source            id, key (adzuna|arbeitnow|remotive|muse|greenhouse), label, attribution_html, enabled
Job               id, source_id, source_job_id (unique per source), title, company, country,
                  city, location_raw, description, apply_url, posted_at, raw_json, dedupe_hash,
                  created_at, updated_at
JobClassification job_id, role_family, role_confidence, seniority, employment_type,
                  employment_confidence, remote_type, job_post_language,
                  required_languages (JSON), optional_languages (JSON),
                  language_blocker (bool), classification_method (rule|llm), evidence (JSON)
JobSkill          job_id, skill, skill_type (matched|gap), confidence
SearchProfile     [PLANNED — not built] id, name, target_roles, countries, cities,
                  employment_types, accepted_languages, blocked_languages, ...
JobScore          [PLANNED — not built] job_id, profile_id, fit_score, ... apply_priority
                  (today's scoring is term-overlap CV-match %, computed on the fly in
                   routes/cv.js — not persisted)
Application       id, job_id, status, notes, cv_version, cover_letter, applied_at, follow_up_at
CvDocument        id, label, raw_text, created_at
CvChunk           id, cv_document_id, chunk_text, embedding (JSON float[768])
```

**Dedup:** `dedupe_hash = sha1(normalize(title) + normalize(company) + country)`; on collision, keep the richest description and merge sources. Unique index on `(source_id, source_job_id)` prevents intra-source dupes.

`sequelize.sync()` on boot for v1 (no migration tooling needed); switch to migrations only if the schema churns.

---

## 5. NLP pipeline — rule-based first, $0

Pipeline order (collector runs steps 1–11 per job; the API runs 10–12 on demand for a given profile):

| # | Step | Method | Free libs |
|---|---|---|---|
| 1 | Detect job-post language | **Rule-based** | `franc` (long text) / `cld3-asm` WASM (short) |
| 2 | Normalize role → family | **Rule-based + fuzzy**, LLM tail | doc keyword lists + `fuse.js` / `fastest-levenshtein` |
| 3 | Employment type | **Rule-based** | regex + multilingual keyword dicts (CDI/CDD/zzp/Festanstellung…) |
| 4 | Language requirement + **blocker vs nice-to-have** | **Hybrid** | gazetteer + modifier-proximity regex; LLM adjudicates ambiguous snippets only |
| 5 | Skill extraction | **Rule-based gazetteer** | skill dict + alias table (sklearn↔scikit-learn, k8s↔Kubernetes) + fuzzy |
| 6 | Seniority | **Rule-based** | title/years regex (junior/medior/senior/lead) |
| 7 | Remote type | **Rule-based** | keyword (remote/hybrid/onsite/thuiswerk/télétravail) |
| 8 | Location → country/city | **Rule-based** | Benelux city→country map + source country code |
| 9 | Dedupe | **Rule-based** | dedupe_hash + fuzzy title match |
| 10 | Embed (CV chunks) | **Gemini API** | `gemini-embedding-001` (768-d) — *planned local model not built* |
| 11 | Fit score | **Features + LLM rationale** | deterministic features → Gemini for explained score |
| 12 | RAG answers | **LLM** | retrieve chunks (cosine) → Gemini/Groq |

**Language-blocker logic** (the product's core differentiator):
```
Good      English only / "English is sufficient" / "no Dutch required"
Maybe     Dutch/French/German "is a plus / atout / pré / von Vorteil"
Risk      a non-English language "required" but role is technical/English-team
Blocker   "fluent/native/courant/maîtrise/vloeiend/muttersprachlich/C1" in NL/FR/DE/LU
Unknown   no language signal found
```
First pass is regex proximity (language term within N tokens of a requirement modifier). Only **negation / indirect phrasing** ("working language is French", "English is sufficient, Dutch not required") escalates to a one-shot Gemini call over the *extracted snippet*, never the whole JD — keeping tokens tiny.

**Fit score formula** (from the doc): 35% skill · 20% role · 15% seniority · 15% language · 10% location/remote · 5% employment. Language sub-score: English-only 100 · optional NL/FR/DE 85 · one required 40 · two required 10 · Luxembourgish required 5 · unclear 60. **Apply priority:** Apply Today (≥80, no blocker) · Good Fit (65–79) · Stretch (50–64) · Language Risk (strong tech fit but required-language issue) · Skip.

---

## 6. RAG assistant (free)

- **Index** ($0): chunk the uploaded CV → embed with Gemini `gemini-embedding-001` (768-dim) → store `embedding` JSON on `CvChunk`. *(The plan originally called for an offline local model; the API model shipped instead.)*
- **Retrieve:** cosine similarity in Node over the small corpus (no pgvector needed at MVP scale).
- **Generate:** Gemini 2.5 Flash (Groq fallback) for: tailor CV to a job, draft cover letter, explain gaps, interview prep, compare jobs, "is this language requirement a real blocker?"
- Pass **structured features + top-k chunks**, not raw documents, to stay well inside free token limits.

---

## 7. API endpoints (Express, additive to current `server.js`)

```
Profiles    POST /api/profiles · GET /api/profiles · PATCH /api/profiles/:id
Jobs        GET  /api/jobs?profile_id=&country=&employment=&blocker=&minFit=
            GET  /api/jobs/:id
            POST /api/jobs/:id/save · /hide · /apply-status
Collection  POST /api/collect/run   (manual trigger; same code path as the cron script)
            GET  /api/collect/status
Scoring     POST /api/jobs/:id/score · POST /api/profiles/:id/rescore
RAG         POST /api/cv/upload · /api/jobs/:id/tailor-cv · /cover-letter
            POST /api/jobs/:id/interview-prep · POST /api/compare-jobs
Health      GET  /api/health   (already exists)
```
Existing `/api/health` and `/api/hello` stay. Production SPA-fallback already serves the React app.

---

## 8. Frontend screens (React, additive to `frontend/src/`)

Minimal pages, reusing the existing dark theme; no router library required for v1 (can add later). Priority order:
1. **Job Feed** — filterable table: title, company, country, source, employment, **language status badge**, remote, seniority, fit score, apply priority, posted date. Filters: country, employment, English-only / blocker, remote, fit > N, "Apply Today."
2. **Job Detail** — full JD, matched skills (+), gaps (−), language evidence, fit breakdown, RAG actions (tailor CV / cover letter / interview prep).
3. **Search Profiles** — define roles, countries, cities, employment, accepted/blocked languages, min fit.
4. **Application Tracker** — Saved → Need CV → Applied → Interview → Rejected → Offer → Archived.
5. *(later)* Skill Gap Radar, Company Hiring Radar (analytics views).

Attribution: render Adzuna logo/credit, Arbeitnow + Remotive backlinks wherever those sources' jobs appear.

---

## 9. The collector (GitHub Actions cron)

`backend/scripts/collect.js` — one entrypoint that: fetches each enabled source → normalizes → dedupes → runs rule-based classification → stores → (optionally) scores against saved profiles.

```yaml
# .github/workflows/collect.yml  (in a PUBLIC repo → unlimited free minutes)
on:
  schedule:
    - cron: "17 4 * * *"     # off-peak minute; avoid top-of-hour (delayed/skipped)
  workflow_dispatch: {}
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd backend && npm ci
      - run: cd backend && node scripts/collect.js
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}      # Neon connection string
          ADZUNA_APP_ID: ${{ secrets.ADZUNA_APP_ID }}
          ADZUNA_APP_KEY: ${{ secrets.ADZUNA_APP_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```
Gotchas baked in: off-peak minute (schedules are best-effort/delayed); the repo's own daily commits keep the workflow from auto-disabling after 60 days of inactivity; secrets live in GitHub Secrets, never in the public code.

---

## 10. Build sequence (phased, each phase shippable & free)

**Phase 0 — Infra swap (½ day).** Create Neon project; set `DATABASE_URL` to Neon in Render + GitHub Secrets. Remove the `databases:` block from `render.yaml` (DATABASE_URL becomes a dashboard/secret env var, since Render's free Postgres expires). Confirm `/api/health` returns `db: postgres` against Neon. *Local dev still SQLite — unchanged.*

**Phase 1 — Data foundation (Week 1).** Models (`Source`, `Job`, `JobClassification`, `JobSkill`). Collectors for Adzuna + Arbeitnow + Remotive. Normalizer + dedupe. `scripts/collect.js` + the GitHub Action. Result: jobs flowing into Neon daily, free.

**Phase 2 — Classification (Week 2).** Rule-based: language detect, role family, employment type, seniority, remote, location, **skill extraction**, and the **language-requirement extractor + blocker logic** (with Gemini escalation for ambiguous snippets only). Add `SearchProfile`.

**Phase 3 — Dashboard (Week 3).** Job Feed table + filters, Job Detail, Profiles screen, Application Tracker. Wire `/api/jobs`, `/api/profiles`. Fit scoring (features → Gemini rationale) + apply-priority badges. Source attribution in UI.

**Phase 4 — RAG-lite (Week 4).** Local embeddings (`transformers.js`), CV upload + chunking, cosine retrieval, Gemini-powered tailor-CV / cover-letter / interview-prep / compare-jobs. Provider abstraction with Groq fallback.

**Later (v2):** Skill Gap Radar + Company Hiring Radar analytics; curated Greenhouse/Lever slugs; The Muse; LinkedIn-email→parser ingestion; pgvector/HNSW if the corpus outgrows brute-force cosine; revisit VDAB if a partner agreement becomes worthwhile.

---

## 11. Repo structure (extending the current template)

```
backend/
  server.js                 # + new routers (additive)
  db.js                     # unchanged (SQLite local / Postgres prod)
  models/                   # Source, Job, JobClassification, JobSkill, SearchProfile,
                            #   JobScore, Application, CvDocument, CvChunk
  collectors/               # adzuna.js, arbeitnow.js, remotive.js, muse.js, greenhouse.js
  nlp/                      # language.js, role.js, employment.js, languageReq.js,
                            #   skills.js, seniority.js, remote.js, location.js, dedupe.js
  scoring/                  # fitScore.js, languageBlocker.js, applyPriority.js
  rag/                      # embeddings.js (transformers.js), retrieve.js, assistant.js
  llm/                      # provider.js (Gemini primary, Groq fallback)
  routes/                   # profiles.js, jobs.js, collect.js, scoring.js, rag.js
  scripts/collect.js        # GitHub Actions entrypoint
frontend/src/
  pages/                    # JobFeed.jsx, JobDetail.jsx, Profiles.jsx, Applications.jsx
  components/               # JobTable, LanguageBadge, FitBreakdown, RagPanel, SourceCredit
.github/workflows/collect.yml
render.yaml                 # databases block removed; DATABASE_URL = Neon (secret)
.env.example                # + ADZUNA_*, GEMINI_API_KEY, GROQ_API_KEY, DATABASE_URL(Neon)
```

---

## 12. Risks, limits & when you'd ever pay

- **Free LLM daily caps** (Gemini ~250–500/day since the Dec-2025 cut; Groq ~1,000/day) are the real ceiling — mitigated by doing Tasks 1–5 rule-based (zero API) and falling back to Groq. A single user still won't approach the cap.
- **Render cold start** (~60 s after idle) — acceptable for personal use; optional 10-min keep-alive ping if it annoys you.
- **GitHub Actions schedules** are best-effort (can lag/skip) and auto-disable after 60 days idle — off-peak minute + daily state commit handle both.
- **Luxembourg coverage** is thin (Adzuna-only for live jobs) — enrich with LU company Greenhouse slugs.
- **Attribution is mandatory** for Adzuna/Arbeitnow/Remotive — build the credit components in Phase 3, not as an afterthought.
- **Rule-based tail** (~5–10% novel titles, negated language phrasing) — exactly the cases routed to the LLM; don't over-engineer regex for them.
- **You'd only pay if:** you exhaust both the Gemini and Groq free daily quotas (paid Gemini is cheap), need guaranteed quality (Claude/GPT as a quality tier), or the corpus outgrows brute-force cosine (Neon pgvector, still free). None apply to a single-user MVP — **it runs at $0 at today's free tiers** (re-verify periodically; free tiers move, as Gemini's Dec-2025 cut showed).

---

## 13. First concrete steps

1. **Neon:** create a free project, copy the connection string.
2. Set `DATABASE_URL` (Neon) in **Render env vars** and **GitHub Secrets**; verify `/api/health` → `{"status":"ok","db":"postgres"}`.
3. **Adzuna:** register at developer.adzuna.com → instant `app_id`/`app_key` → add to secrets.
4. **Gemini:** get a free AI Studio key → add `GEMINI_API_KEY`.
5. Begin **Phase 1**: `Source`/`Job` models + Adzuna collector + `scripts/collect.js` + the GitHub Action.

Phases 0–5 are built and running. Free-tier numbers were last verified **2026-06-01** — re-check periodically, since they move (Gemini's Dec-2025 quota cut is the cautionary example).
