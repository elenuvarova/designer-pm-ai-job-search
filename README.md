# Europe Design & Product Job Scout

A personal, **$0-to-run** job-search intelligence tool for **Designers and Product Managers** across **all of Europe + the UK** — with **Belgium and the Netherlands** surfaced first as the home region — plus **remote roles from the USA and Asia**. It collects vacancies from free sources, normalizes messy multilingual job data, flags **language blockers** (is English enough, or is a local language required?), classifies each role by **category, discipline and grade**, scores each role against your CV, and helps you track and tailor applications.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the design rationale.

## What it does

- **Collects** Design & Product jobs daily from **14 free sources** into Postgres. BE/NL are prioritized; the rest of Europe + UK is collected in full (all role types — onsite, hybrid and remote).
- **Classifies** each posting with rule-based NLP: **category** (Design / Product), **discipline** (Product Design, UX Research, Graphic/Visual, Brand, Motion, Content Design, Design Systems, Design Leadership, Product Management, Product Owner, Growth/Technical Product, Product Leadership), **grade** (intern → lead), employment type, remote type, a **portfolio-required** flag, and a **language-requirement blocker** (is the local language a hard requirement or a nice-to-have?).
- **Scores** each job against your uploaded CV (term-overlap match %, shown as a badge) and lets you **sort the feed by best match**.
- **Tool-stack gap**: on each job, shows which design/PM tools (Figma, Sketch, Jira, Amplitude…) your CV covers vs. the gaps.
- **Salary**: shows the pay range where the source provides it (Adzuna), with a min-salary filter.
- **RAG assistant**: upload a CV (PDF/DOCX) → tailor it to a job, draft a cover letter, get gap analysis, interview prep, an LLM **company interview brief**, or a one-click **Apply-kit** — Gemini, with a Groq fallback.
- **Analyze any job**: paste an arbitrary JD — including LinkedIn/Indeed roles we don't collect — to classify it + score it against your CV + see tool gaps. Nothing is stored.
- **Semantic search & chat**: a "✨ Smart" toggle ranks the feed by meaning (embeddings), each job shows **Similar roles**, and an **Ask** page answers natural-language questions ("remote UX roles that don't need Dutch and match my CV") grounded in the collected jobs.
- **Tracks** applications (status, notes, follow-up) with an **application funnel**, plus a market-wide **Skill Gap Radar**.

## Filters

Category (Design / Product) → Discipline · Grade · Country (Focus BE/NL · Rest of Europe) · Language (English-friendly by default) · Employment · Remote · Min salary · Portfolio required · free-text & semantic search.

## Stack

- **Frontend:** React 18 + Vite 5 (JavaScript), React Router
- **Backend:** Node.js + Express, ES modules, Sequelize ORM
- **Database:** Postgres in production, SQLite in local dev (dialect chosen automatically from `DATABASE_URL`)
- **Scheduled collector:** **GitHub Actions** cron (public repo → free unlimited minutes) running `backend/scripts/collect.js`
- **AI:** Gemini 2.5 Flash (primary) + Groq Llama 3.3 70B (fallback); embeddings via Gemini `gemini-embedding-001`
- **Web service:** single Node container (`node server.js`) serving both the API and the built React app on port 3001, deployed on Coolify (no nginx)

## Job sources

All zero-cost (free key or zero-auth):

| Source | Auth | Notes |
|---|---|---|
| Adzuna | free key | Native BE/NL + all major EU endpoints (GB/DE/FR/ES/IT/AT/PL) + salary; **US/IN/SG remote-only** |
| **EURES** | zero-auth | EU portal — broadest native coverage across every EU/EEA country |
| Arbeitnow · Remotive · RemoteOK · Jobicy | zero-auth | EU + **US & Asia** remote design & product feeds |
| The Muse | free key | "Design and UX", "Creative" & "Product Management" across European hubs + **Flexible/Remote** |
| Greenhouse · Lever · Recruitee · SmartRecruiters · Ashby · Workable | zero-auth | Curated European company boards |
| HN "Who's Hiring" | zero-auth | Monthly Hacker News thread (Europe-filtered) |

## Local development

No database to install — SQLite is created automatically on first run.

**Terminal 1 — backend:**

```bash
cd backend
npm install
npm run dev
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api` to the backend on port 3001.

**Collect & classify jobs** (writes into your local DB):

```bash
cd backend
node scripts/collect.js        # fetch from all sources
node scripts/classify.js       # classify new jobs (rule-based + LLM tail)
node scripts/embedJobs.js      # (optional) embeddings for semantic search
```

**Re-domain an existing database** (after changing the role/skill rules, or to switch from the old ML build):

```bash
cd backend
node scripts/reset.js          # clears jobs + classifications + skills (keeps your CV + applications)
node scripts/collect.js
node scripts/classify.js
# or, to re-classify in place without re-collecting:
node scripts/classify.js --all # wipes classifications/skills and recomputes for every job
```

### Environment variables

Copy `.env.example` and fill in (all free to obtain):

| Var | Used for |
|---|---|
| `DATABASE_URL` | Postgres connection string (omit locally → SQLite). Coolify-internal Postgres needs no SSL flag; an external SSL Postgres requires `?sslmode=require` |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Adzuna source |
| `THE_MUSE_API_KEY` | The Muse source |
| `GEMINI_API_KEY` | classification tail, CV embeddings, RAG |
| `GROQ_API_KEY` | LLM fallback |

Secrets live in `.env` (gitignored) locally, in the **Coolify environment variables** for the deployed app, and in **GitHub Secrets** for the cron — never in the repo. They are read at runtime from `process.env` and are never baked into the Docker image.

## Deploy

Deployed on **Coolify** as a single Docker container that runs `node server.js` and serves both the `/api` backend and the built React SPA on port **3001** (no nginx).

- **Build:** Coolify build pack = **Dockerfile** (multi-stage: build the Vite frontend, install backend prod deps, copy the built SPA into `backend/public`).
- **Container:** exposes port 3001. The image ships a `HEALTHCHECK` that probes `/api/health`, so Coolify gets container health for free — no separate health-check path config needed.
- **Secrets:** set `DATABASE_URL`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and `THE_MUSE_API_KEY` as **Coolify environment variables** (Configuration → Environment Variables). They are read at runtime from `process.env`, never build args, so nothing is baked into the image.
- **Database:** point `DATABASE_URL` at a Postgres instance (Coolify-managed Postgres needs no SSL flag; an external SSL Postgres needs `?sslmode=require`). Use the same connection string in GitHub Secrets so the collector writes to the same DB.
- **Collector:** `.github/workflows/collect.yml` runs daily on GitHub Actions and writes to the same Postgres.

Deploys are automatic on git push (Coolify auto-deploy).

## API (high level)

| Group | Path | Purpose |
|---|---|---|
| Jobs | `GET /api/jobs`, `GET /api/jobs/:id` | filterable feed (category, role_family, seniority, country, language_match, min_salary, portfolio_required, home_first…) + detail |
| Collection | `POST /api/collect/run` | manual collector trigger |
| CV | `POST /api/cv/upload`, `GET /api/cv/scores` | CV upload + per-job match scores |
| RAG | `POST /api/rag/*` | tailor CV / cover letter / gap / interview prep |
| Applications | `/api/applications` | tracker CRUD |
| Analytics | `/api/analytics/*` | skill-gap radar |
| Health | `GET /api/health` | DB connectivity (`{ status, db }`) |
