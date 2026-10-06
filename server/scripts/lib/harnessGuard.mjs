// Network guard shared by the two local harnesses. They run the offline
// authorizers, which accept the `local-dev` dummy as a full operator, so
// anything that can reach them is an operator:
//   - the bind address keeps them off the LAN (HARNESS_HOST opts in);
//   - the Host check defeats DNS rebinding (a page on attacker.example whose
//     name re-resolves to 127.0.0.1 still sends `Host: attacker.example`);
//   - the Origin allowlist stops a page on any other site from reading HTTP
//     responses (CORS) or opening an operator WebSocket (browsers do not apply
//     CORS to WebSockets — the server has to check Origin itself).

export const LOOPBACK_HOST = '127.0.0.1';
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const hostWithPort = (host, port) => `${host.includes(':') ? `[${host}]` : host}:${port}`;

const listFromEnv = (value) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Resolve the bind address and the Host/Origin allowlists from the env:
 * `HARNESS_HOST` (bind address, default loopback) and `HARNESS_ALLOWED_ORIGINS`
 * (comma-separated, on top of the Vite dev origins).
 */
export const harnessGuard = (port, env = process.env) => {
  const bindHost = env.HARNESS_HOST || LOOPBACK_HOST;
  const hosts = new Set(
    [LOOPBACK_HOST, 'localhost', bindHost].map((h) => hostWithPort(h, port).toLowerCase()),
  );
  const origins = new Set([...DEV_ORIGINS, ...listFromEnv(env.HARNESS_ALLOWED_ORIGINS)]);
  return {
    bindHost,
    isAllowedHost: (host) => typeof host === 'string' && hosts.has(host.toLowerCase()),
    isAllowedOrigin: (origin) => typeof origin === 'string' && origins.has(origin),
  };
};
