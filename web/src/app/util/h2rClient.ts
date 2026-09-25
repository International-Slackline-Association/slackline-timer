import type { H2rPost } from 'app/util/h2rBridge';

/**
 * Fire every H2R POST descriptor at the operator's local H2R Graphics API
 * (`http://127.0.0.1:4001` by default). Runs in the browser on the operator's
 * machine — H2R serves CORS for its local API, so a `/stream/bridge` tab can POST
 * to it directly. Each POST is best-effort: a refused/slow slot is swallowed so
 * one dead variable never blocks the rest of the push (the next selection retries
 * the whole set anyway).
 */
export const pushToH2r = async (target: string, posts: H2rPost[]): Promise<void> => {
  const base = target.replace(/\/+$/, '');
  await Promise.all(
    posts.map((post) =>
      fetch(`${base}${post.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(post.body),
      }).catch(() => undefined),
    ),
  );
};
