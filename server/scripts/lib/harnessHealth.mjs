// Harness-identifying readiness endpoint, shared by the two local harnesses.
// A bare port-open is not proof of readiness: a foreign process squatting
// :3001/:3002 reads as "backend up" to a liveness probe, which then skips
// booting the real harness and fails downstream. GET /health answers a body only
// these harnesses produce, so a probe asserts identity, not just liveness —
// probe tooling imports these constants, so the contract cannot drift.

export const HEALTH_PATH = '/health';
export const HTTP_HARNESS_ID = 'slackline-local-http';
export const WS_HARNESS_ID = 'slackline-local-ws';

/**
 * Answer `GET /health` with the identifying body; return whether the request
 * was handled so callers can fall through to their own routing otherwise.
 */
export const handleHealthRequest = (req, res, harness) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method !== 'GET' || path !== HEALTH_PATH) return false;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ harness }));
  return true;
};
