// Seed the local data plane with sample data for a competition: 8 athletes per
// gender plus their training + qualification runs and freestyle scores, then a
// full playoff bracket per discipline×gender played out to a winner and its
// final-round results — so the demo comp comes up complete in one command:
//   node server/scripts/seedLocal.mjs [compId]   (default compId: demo)
// Idempotent (it resets the competition first). Run against `npm run dev`.
//
// This is the demo GENERATOR: it builds a dataset in memory and pushes it through
// the shared write path (lib/seedClient.mjs `seedDataset`) — the same code
// seedRemote.mjs uses to LOAD a dataset from a file. Only the bracket play-out
// (server-side seed/advance from the qualification ranking) is local-demo-only.
//
// EVERY athlete gets a generated placeholder identicon (lib/avatar.mjs, written to
// a temp file and folded in by absolute path) so the demo board is fully populated
// offline with no real person's likeness in the repo — the roster is fictional and
// the portraits are derived from the name.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateAvatarPng } from './lib/avatar.mjs';
import { buildFinalResults } from './lib/finalResults.mjs';
import { makeCall, seedDataset } from './lib/seedClient.mjs';
import { seedTableHint } from './lib/seedPreflight.mjs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3002';
const compId = process.argv[2] ?? 'demo';
const call = makeCall({ api: API, token: process.env.AUTH_TOKEN ?? 'local-dev' });

const rand = (min, max) => min + Math.floor(Math.random() * (max - min));

// Roster (8 per gender, one DNF each) is the single source of truth in
// seedRoster.json, shared with the web flag-coverage parity test
// (web/test/app/components/CountryFlag.test.tsx). The names are invented; only the
// countries carry meaning (they drive the flag coverage the parity test asserts).
const { female: FEMALE, male: MALE } = JSON.parse(
  await readFile(new URL('./seedRoster.json', import.meta.url), 'utf8'),
);

const shortName = (name) => `${name[0]}. ${name.split(' ').slice(1).join(' ')}`;

// Generated portraits land here; the paths are absolute so seedDataset uploads
// them as-is.
const avatarDir = await mkdtemp(join(tmpdir(), 'seed-avatars-'));
const avatarFor = async (name) => {
  const file = join(avatarDir, `${name.replace(/[^\p{L}\p{N}]+/gu, '_')}.png`);
  await writeFile(file, generateAvatarPng(name));
  return file;
};

// Build the demo dataset in the shape seedDataset consumes (same as a seed file).
// A generated identicon per athlete, so no card is blank.
const athletes = await Promise.all(
  [
    ...FEMALE.map((a) => ({ ...a, gender: 'female' })),
    ...MALE.map((a) => ({ ...a, gender: 'male' })),
  ].map(async (a) => ({
    ref: a.name,
    name: a.name,
    shortName: shortName(a.name),
    country: a.country,
    gender: a.gender,
    birthDate: a.birthDate,
    photo: await avatarFor(a.name),
  })),
);

const times = athletes.flatMap((a) => [
  { athlete: a.ref, round: 'training', timeMs: rand(6500, 9500) },
  // The DNF flag rides on the roster entry; re-derive it by name.
  { athlete: a.ref, round: 'qualification', timeMs: rand(5200, 8200), dnf: dnfFor(a.ref) },
]);

const scores = athletes.map((a) => ({
  athlete: a.ref,
  round: 'qualification',
  difficulty: rand(4, 10),
  combo: rand(4, 10),
  style: rand(4, 10),
  // Best trick + control penalty are battles-only (rule F8) — a qualification
  // Score must carry 0 for both or `validateScoreInput` 400s the write.
  bestTrick: 0,
  controlPenalty: 0,
}));

function dnfFor(name) {
  return [...FEMALE, ...MALE].some((a) => a.name === name && a.dnf);
}

// Anchor the demo event window to "now" (opened yesterday, closes in 5 days) so
// read tokens mint against it — a frozen past window makes `createReadToken`
// refuse ("competition has ended"), breaking the /stream/* token path. Same
// reason the e2e harnesses date their comps relative to now.
const isoDay = (offsetDays) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const dataset = {
  competition: { compId, name: 'Demo Cup', startDate: isoDay(-1), endDate: isoDay(5) },
  athletes,
  times,
  scores,
};

// ── bracket play-out (local-demo only) ───────────────────────────────────────
// Seed the four quarters from the qualification ranking, then set a deterministic
// winner and advance each round to the final. Drives the same server-authoritative
// seed/advance endpoints the admin Matches page uses (no bespoke fixtures to drift).
const decideWinner = async (match) => {
  const winnerId = match.athlete1Id ?? match.athlete2Id;
  if (!winnerId) return null;
  await call('PUT', `/competitions/${compId}/matches/${match.matchId}`, {
    discipline: match.discipline,
    round: match.round,
    gender: match.gender,
    position: match.position,
    ...(match.athlete1Id ? { athlete1Id: match.athlete1Id } : {}),
    ...(match.athlete2Id ? { athlete2Id: match.athlete2Id } : {}),
    winnerId,
  });
  return { ...match, winnerId };
};

const advance = async (discipline, gender, fromRound) => {
  const { body } = await call('POST', `/competitions/${compId}/matches/advance`, {
    discipline,
    gender,
    fromRound,
  });
  // A wrong `fromRound` (e.g. no quarter round in a small-field top-4 bracket)
  // answers with a non-array error body — normalize so callers can always iterate.
  return Array.isArray(body) ? body : [];
};

const playOutBracket = async (discipline, gender) => {
  const seed = await call('POST', `/competitions/${compId}/matches/seed`, {
    discipline,
    gender,
    force: true,
  });
  if (seed.status !== 201 || !Array.isArray(seed.body)) {
    console.warn(`! seed ${discipline}/${gender}: ${seed.status}`, seed.body);
    return null;
  }
  // `chooseSeedStage` (src/core/bracketProgression.ts) starts a small field at
  // `half`, a large one at `quarter` — advance from whichever stage seeding produced.
  const startRound = seed.body[0]?.round;
  for (const m of seed.body) await decideWinner(m);
  if (startRound === 'quarter')
    for (const m of await advance(discipline, gender, 'quarter')) await decideWinner(m);
  let final = null;
  for (const m of await advance(discipline, gender, 'half')) {
    const decided = await decideWinner(m);
    if (decided?.round === 'final') final = decided;
  }
  console.log(`+ bracket ${discipline}/${gender} → final winner`);
  return { final };
};

// ── final-round results ──────────────────────────────────────────────────────
// Without these the demo's VS cards render their stats boxes empty: the overlay
// reads `final`-round Times (speed) and Scores (freestyle). The run order + DNF
// rules live in lib/finalResults.mjs; only the randomness is here.
const finalLaps = () => [rand(5200, 6200), rand(5200, 6200), rand(5200, 6200)];

const finalComponents = () => ({
  difficulty: rand(4, 10),
  combo: rand(4, 10),
  style: rand(4, 10),
  // Nonzero because this is a battle (rule F8, see the qualification scores
  // above) — the two cells the VS table and the score card add in one.
  bestTrick: rand(3, 9),
  controlPenalty: rand(1, 4),
});

const recordFinalResults = async (discipline, final) => {
  const { times, scores } = buildFinalResults({
    discipline,
    match: final,
    runsFor: finalLaps,
    scoreFor: finalComponents,
    // Land the runs in the recent past so the card reads as a just-run final.
    startEpoch: Date.now() - 300_000,
  });
  const counts = { times: 0, scores: 0 };
  for (const [entity, rows] of [
    ['times', times],
    ['scores', scores],
  ]) {
    for (const row of rows) {
      const res = await call('POST', `/competitions/${compId}/${entity}`, row);
      if (res.status === 201 || res.status === 200) counts[entity] += 1;
      else console.warn(`! final ${entity}: ${res.status}`, res.body);
    }
  }
  return counts;
};

const run = async () => {
  console.log(`Seeding "${compId}" via ${API}`);

  // Preflight: a LocalStack container recreated without `npm run db:init` has
  // no tables — every write below would 500. Fail with the fix, not a cascade.
  const tableHint = await seedTableHint({ api: API });
  if (tableHint) {
    console.error(`seed preflight failed: ${tableHint}`);
    process.exit(1);
  }

  // No assetsDir: every generated portrait is an absolute path already.
  const { counts } = await seedDataset(call, dataset, {
    reset: true,
    log: (m) => console.log(m),
  });
  console.log(
    `\nSeeded: ${counts.athletes} athletes (${counts.photos} photos), ${counts.times} times, ${counts.scores} scores.\n`,
  );

  let brackets = 0;
  const finals = { times: 0, scores: 0 };
  for (const discipline of ['speed', 'freestyle'])
    for (const gender of ['female', 'male']) {
      const played = await playOutBracket(discipline, gender);
      if (!played) continue;
      brackets += 1;
      const counts = await recordFinalResults(discipline, played.final);
      finals.times += counts.times;
      finals.scores += counts.scores;
    }
  console.log(
    `brackets: ${brackets}/4 seeded to a final winner; ` +
      `final results: ${finals.times} times, ${finals.scores} scores`,
  );
};

run().catch((e) => {
  console.error(
    'seed failed:',
    e.message,
    '\nIs the backend up? `npm run dev` / `npm run dev:api`',
  );
  process.exit(1);
});
