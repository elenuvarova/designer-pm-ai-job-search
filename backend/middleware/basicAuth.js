import crypto from "crypto";

// HTTP Basic Auth gate for the whole app (SPA + every /api route) on the public
// internet. Credentials come from env vars; if either is unset the gate is a
// no-op so the app never hard-locks before the orchestrator injects them.
//
// /api/health is always exempt so the container HEALTHCHECK (wget /api/health)
// keeps passing regardless of auth state.

const HEALTH_PATH = "/api/health";

// Constant-time string compare. Returns false for any length mismatch up front
// (timingSafeEqual throws on unequal lengths), so the length check itself is the
// only early-exit and it does not leak the secret's contents.
function safeEqual(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Parse "Basic <base64(user:pass)>". The password may itself contain ':', so we
// only split on the first colon. Returns null if the header is missing or not
// well-formed Basic credentials.
function parseBasicAuth(header) {
  if (typeof header !== "string") return null;
  const match = /^Basic (.+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

export function basicAuth() {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;
  const enabled = Boolean(expectedUser) && Boolean(expectedPass);

  console.log(`[auth] HTTP Basic Auth ${enabled ? "ENABLED" : "DISABLED"}`);

  return function basicAuthMiddleware(req, res, next) {
    // Gate disabled (creds not configured): let everything through.
    if (!enabled) return next();

    // Health check is always reachable so the container stays healthy.
    if (req.path === HEALTH_PATH) return next();

    const creds = parseBasicAuth(req.headers.authorization);

    if (creds) {
      // Evaluate both comparisons (no short-circuit) so a wrong username and a
      // wrong password take the same path.
      const userOk = safeEqual(creds.user, expectedUser);
      const passOk = safeEqual(creds.pass, expectedPass);
      if (userOk && passOk) return next();
    }

    res.set("WWW-Authenticate", 'Basic realm="Restricted"');
    return res.status(401).json({ error: "Authentication required" });
  };
}

export default basicAuth;
