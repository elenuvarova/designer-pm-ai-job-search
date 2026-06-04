# Stage 1 — build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2 — install backend production deps
FROM node:20-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Stage 3 — runtime
# No build ARG/ENV for API keys here: ADZUNA_*/GEMINI_API_KEY/GROQ_API_KEY/
# THE_MUSE_API_KEY are backend RUNTIME secrets read from process.env, injected by
# Coolify at run time. Declaring them as ARG/ENV would bake them into image layers
# (SecretsUsedInArgOrEnv). The frontend uses no VITE_* build args (it calls /api
# with relative URLs), so the build needs no secrets at all.
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app/backend
COPY backend/ ./
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY --from=frontend-build /app/frontend/dist ./public
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "server.js"]
