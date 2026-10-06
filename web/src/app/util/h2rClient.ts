import type { H2rPost } from 'app/util/h2rBridge';

export type H2rTarget = { origin: string } | { error: string };

// H2R runs on the bridge tab's own machine. Must match the build-time CSP's
// connect-src (`http://127.0.0.1:*`, `http://localhost:*`, ADR 0054): a target
// it accepts but the CSP blocks fails silently in the browser.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Resolve `?h2r=` to a loopback http origin (any port), or the reason it is refused. */
export const resolveH2rTarget = (raw: string): H2rTarget => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'The h2r target is not a URL.' };
  }
  if (url.protocol !== 'http:') {
    return { error: 'The h2r target must be an http:// URL.' };
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return { error: 'The h2r target must be a bare origin, e.g. http://127.0.0.1:4001.' };
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return { error: 'The h2r target must be on this machine (127.0.0.1 or localhost).' };
  }
  return { origin: url.origin };
};

/**
 * Fire every H2R POST descriptor at the operator's local H2R Graphics API. H2R
 * serves CORS for its local API, so the bridge tab can POST to it directly. Each
 * POST is best-effort: a refused/slow slot is swallowed so one dead variable never
 * blocks the rest of the push (the next selection retries the whole set anyway).
 */
export const pushToH2r = async (
  origin: string,
  posts: H2rPost[],
  signal?: AbortSignal,
): Promise<void> => {
  await Promise.all(
    posts.map((post) =>
      fetch(`${origin}${post.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(post.body),
        signal,
      }).catch(() => undefined),
    ),
  );
};

export const H2R_PUSH_TIMEOUT_MS = 3_000;

export interface H2rPusher {
  push: (posts: H2rPost[]) => void;
  dispose: () => void;
}

/**
 * Serial, latest-wins H2R pushes: concurrent pushes can land out of order and
 * leave the stale athlete on air, so one push is in flight and only the newest
 * waiting set follows it. A hung H2R is aborted after the timeout (a manual
 * controller: jsdom lacks `AbortSignal.timeout`) so it cannot stall the chain.
 */
export const createH2rPusher = (origin: string, timeoutMs = H2R_PUSH_TIMEOUT_MS): H2rPusher => {
  let pending: H2rPost[] | null = null;
  let inFlight: AbortController | null = null;
  let disposed = false;

  const run = async (posts: H2rPost[]) => {
    const controller = new AbortController();
    inFlight = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await pushToH2r(origin, posts, controller.signal);
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
    if (pending && !disposed) {
      const next = pending;
      pending = null;
      void run(next);
    }
  };

  return {
    push: (posts) => {
      if (disposed) return;
      if (inFlight) pending = posts;
      else void run(posts);
    },
    dispose: () => {
      disposed = true;
      pending = null;
      inFlight?.abort();
    },
  };
};
