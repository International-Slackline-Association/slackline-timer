// Shared seed write-path for the data plane — the single place that knows how to
// push a competition dataset through the HTTP API. Both seeders sit on top of it:
//   • seedRemote.mjs — LOADS an explicit dataset from a JSON file (any stage)
//   • seedLocal.mjs  — GENERATES a demo dataset then loads it (local harness)
// so there is one write path, not two. Writes go ONLY through the HTTP API (never
// DynamoDB/S3 directly), so records are server-validated, `name`/`overall` are
// derived, and every write fires the `db_update` live-refresh broadcast.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

export const DNF_SENTINEL = 3_355_550;

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Content type for a photo filename, or throws on an unsupported extension. */
export const contentTypeFor = (file) => {
  const ct = CONTENT_TYPES[file.split('.').pop().toLowerCase()];
  if (!ct) throw new Error(`unsupported photo extension: ${file}`);
  return ct;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the `call(method, path, body)` helper both seeders use:
 * an authenticated JSON fetch against one API base, returning `{ status, body }`.
 */
export const makeCall =
  ({ api, token }) =>
  async (method, path, body) => {
    const r = await fetch(`${api}${path}`, {
      method,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };

/**
 * Upload one photo file and return its server `photoKey` — mirrors
 * app/api/photoUpload.ts: SHA-256 → presigned POST → direct-to-S3 multipart POST
 * (the policy fields carry the signature; the file part comes last; no auth
 * header on the S3 POST). Works offline (LocalStack S3) and against a deployed
 * stage (S3 + CloudFront) unchanged.
 */
export const uploadPhoto = async (call, compId, filePath) => {
  const contentType = contentTypeFor(filePath);
  const bytes = await readFile(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const presign = await call('POST', `/competitions/${compId}/photo-uploads`, {
    contentType,
    sha256,
  });
  if (presign.status !== 200)
    throw new Error(`presign ${presign.status}: ${JSON.stringify(presign.body)}`);

  const { url, fields, photoKey } = presign.body;
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', new Blob([bytes], { type: contentType }), basename(filePath));

  const post = await fetch(url, { method: 'POST', body: form });
  if (!post.ok) throw new Error(`S3 POST ${post.status}`);
  return photoKey;
};

/**
 * Clear a competition's entities (matches → times → scores → athletes), keeping
 * META. Athlete deletes are refused while times/matches still reference them, and
 * those checks are eventually-consistent Queries — so each pass clears the
 * dependents first, then athletes, looping until the partition is empty.
 */
export const resetCompetition = async (call, compId, { log = () => {} } = {}) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const m of (await call('GET', `/competitions/${compId}/matches`)).body ?? [])
      await call('DELETE', `/competitions/${compId}/matches/${m.matchId}`);
    for (const t of (await call('GET', `/competitions/${compId}/times`)).body ?? [])
      await call('DELETE', `/competitions/${compId}/times/${t.timeId}`);
    for (const s of (await call('GET', `/competitions/${compId}/scores`)).body ?? [])
      await call('DELETE', `/competitions/${compId}/scores/${s.scoreId}`);
    const existing = (await call('GET', `/competitions/${compId}/athletes`)).body ?? [];
    if (existing.length === 0) break;
    for (const a of existing)
      await call('DELETE', `/competitions/${compId}/athletes/${a.athleteId}`);
    await sleep(150);
  }
  const left = ((await call('GET', `/competitions/${compId}/athletes`)).body ?? []).length;
  log(`reset: ${left} athletes remaining`);
};

/**
 * Validate a dataset's internal cross-references (unique athlete `ref`s; every
 * time/score/match athlete reference resolves). Returns `refs` (ref → spec) on
 * success or throws with a human-readable message. Loaders should call this
 * before seedDataset when the data is untrusted (a hand-authored file).
 */
export const validateDataset = ({ athletes = [], times = [], scores = [], matches = [] }) => {
  const refs = new Map();
  athletes.forEach((a, i) => {
    const ref = a.ref ?? a.firstName ?? a.name;
    if (!ref) throw new Error(`athletes[${i}] needs a "ref" (or a name to derive one)`);
    if (refs.has(ref)) throw new Error(`duplicate athlete ref "${ref}" (athletes[${i}])`);
    a.ref = ref;
    refs.set(ref, a);
  });
  const check = (ref, where) => {
    if (ref != null && !refs.has(ref))
      throw new Error(`${where} references unknown athlete ref "${ref}"`);
  };
  times.forEach((t, i) => check(t.athlete, `times[${i}]`));
  scores.forEach((s, i) => check(s.athlete, `scores[${i}]`));
  matches.forEach((m, i) => {
    check(m.athlete1, `matches[${i}].athlete1`);
    check(m.athlete2, `matches[${i}].athlete2`);
    check(m.winner, `matches[${i}].winner`);
  });
  return refs;
};

const compBody = (c) => ({
  name: c.name,
  startDate: c.startDate,
  endDate: c.endDate,
  ...(c.config ? { config: c.config } : {}),
});

/**
 * Seed a whole dataset through `call`. The dataset is the same shape seedRemote
 * loads from JSON (see its header): `{ competition, athletes, times, scores,
 * matches }`, athletes cross-referenced by a local `ref` and carrying an optional
 * `photo` filename (resolved against `assetsDir`, or absolute). Creates/updates
 * the competition META, optionally resets, then writes athletes (uploading
 * portraits first so the key lands in the create body), times, scores and
 * matches, resolving refs → server athleteIds. Returns per-entity counts.
 */
export const seedDataset = async (
  call,
  { competition, athletes = [], times = [], scores = [], matches = [] },
  { assetsDir = '.', reset = false, log = () => {} } = {},
) => {
  const compId = competition.compId;

  const created = await call('POST', '/competitions', { compId, ...compBody(competition) });
  if (created.status === 201) {
    log('competition: created');
    if (competition.config) await call('PUT', `/competitions/${compId}`, compBody(competition));
  } else {
    const upd = await call('PUT', `/competitions/${compId}`, compBody(competition));
    log(`competition: exists → META ${upd.status === 200 ? 'updated' : `PUT ${upd.status}`}`);
  }

  if (reset) await resetCompetition(call, compId, { log });

  const idByRef = new Map();
  const counts = { athletes: 0, photos: 0, times: 0, scores: 0, matches: 0 };
  for (const a of athletes) {
    const ref = a.ref ?? a.firstName ?? a.name;
    let photoKey;
    if (a.photo) {
      try {
        photoKey = await uploadPhoto(
          call,
          compId,
          isAbsolute(a.photo) ? a.photo : resolve(assetsDir, a.photo),
        );
        counts.photos += 1;
      } catch (e) {
        log(`! ${ref}: photo — ${e.message}`);
      }
    }
    const body = {
      ...(a.firstName != null
        ? { firstName: a.firstName, lastName: a.lastName ?? '' }
        : { name: a.name }),
      ...(a.shortName ? { shortName: a.shortName } : {}),
      country: a.country,
      ...(a.country2 ? { country2: a.country2 } : {}),
      gender: a.gender,
      ...(a.birthDate ? { birthDate: a.birthDate } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      ...(photoKey ? { photoKey } : {}),
    };
    const res = await call('POST', `/competitions/${compId}/athletes`, body);
    if (res.status !== 201) {
      log(`! athlete "${ref}": ${res.status} ${JSON.stringify(res.body)}`);
      continue;
    }
    idByRef.set(ref, res.body.athleteId);
    counts.athletes += 1;
    log(`+ athlete ${ref} → ${res.body.athleteId}${photoKey ? ' 📷' : ''}`);
  }

  for (const [i, t] of times.entries()) {
    const athleteId = idByRef.get(t.athlete);
    if (!athleteId) {
      log(`! times[${i}]: athlete "${t.athlete}" was not created; skipping`);
      continue;
    }
    const res = await call('POST', `/competitions/${compId}/times`, {
      athleteId,
      round: t.round,
      timeMs: t.dnf ? DNF_SENTINEL : t.timeMs,
      ...(t.startTime != null ? { startTime: t.startTime } : {}),
      ...(t.matchId ? { matchId: t.matchId } : {}),
    });
    if (res.status === 201) counts.times += 1;
    else log(`! times[${i}] (${t.athlete}/${t.round}): ${res.status} ${JSON.stringify(res.body)}`);
  }

  for (const [i, s] of scores.entries()) {
    const athleteId = idByRef.get(s.athlete);
    if (!athleteId) {
      log(`! scores[${i}]: athlete "${s.athlete}" was not created; skipping`);
      continue;
    }
    const res = await call('POST', `/competitions/${compId}/scores`, {
      athleteId,
      round: s.round,
      difficulty: s.difficulty,
      combo: s.combo,
      style: s.style,
      bestTrick: s.bestTrick,
      controlPenalty: s.controlPenalty,
      ...(s.overall != null ? { overall: s.overall } : {}),
      ...(s.dnf ? { dnf: true } : {}),
    });
    if (res.status === 201 || res.status === 200) counts.scores += 1;
    else log(`! scores[${i}] (${s.athlete}/${s.round}): ${res.status} ${JSON.stringify(res.body)}`);
  }

  for (const [i, m] of matches.entries()) {
    const a1 = m.athlete1 != null ? idByRef.get(m.athlete1) : undefined;
    const a2 = m.athlete2 != null ? idByRef.get(m.athlete2) : undefined;
    const win = m.winner != null ? idByRef.get(m.winner) : undefined;
    const res = await call('POST', `/competitions/${compId}/matches`, {
      discipline: m.discipline,
      round: m.round,
      gender: m.gender,
      position: m.position,
      ...(m.roundName ? { roundName: m.roundName } : {}),
      ...(a1 ? { athlete1Id: a1 } : {}),
      ...(a2 ? { athlete2Id: a2 } : {}),
      ...(win ? { winnerId: win } : {}),
    });
    if (res.status === 201) counts.matches += 1;
    else
      log(
        `! matches[${i}] (${m.discipline}/${m.gender}/${m.round}#${m.position}): ${res.status} ${JSON.stringify(res.body)}`,
      );
  }

  return { idByRef, counts };
};
