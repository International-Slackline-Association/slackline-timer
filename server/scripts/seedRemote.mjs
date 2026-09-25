// Seed a competition into a DEPLOYED data plane (or any HTTP API) from a single
// JSON file plus a directory of athlete photos. Where seedLocal.mjs GENERATES a
// fixed demo against the offline harness, this LOADS the whole competition (meta,
// athletes, times, scores, matches) from a data file you supply — so it works for
// real events. Both share the write path in lib/seedClient.mjs.
//
//   node server/scripts/seedRemote.mjs <data.json> [--assets <dir>] [flags]
//
// Writes go ONLY through the HTTP API (never DynamoDB/S3), so every record is
// validated, `name`/`overall` are derived server-side, and each write fires the
// `db_update` live-refresh broadcast — exactly as the admin UI does.
//
// Auth / target:
//   API_URL     base URL of the HTTP API      (default: prod, see DEFAULT_API)
//   AUTH_TOKEN  admin Cognito IdToken          (raw or "Bearer …"; required for
//               any non-local API_URL — get one by logging into the admin UI as
//               a `timeradmin` user and copying the IdToken, or via an
//               initiate-auth USER_PASSWORD_AUTH call against the SPA client)
// Against the local harness (npm run dev) AUTH_TOKEN falls back to the `local-dev`
// dummy the offline authorizer accepts.
//
//   API_URL=https://16e1mgulu0.execute-api.eu-central-2.amazonaws.com/prod \
//   AUTH_TOKEN=<idToken> \
//   node server/scripts/seedRemote.mjs resources/seed/prod/laax-2026.seed.json --yes
//
// Flags:
//   --assets <dir>  directory the athlete `photo` filenames resolve against
//                   (default: a `photos`/`assets` dir next to the data file, else
//                   the data file's own directory — so a self-contained seed dir
//                   with a sibling `photos/` needs no flag)
//   --reset         delete the competition's existing matches/times/scores/
//                   athletes before seeding (safe re-run; META is kept/updated)
//   --dry-run       parse + validate + print the plan; make NO writes
//   --yes           required to write to a non-local API_URL (guards prod)
//
// ── Data file shape ──────────────────────────────────────────────────────────
//   {
//     "competition": { "compId","name","startDate","endDate", "config"? },
//     "athletes": [ { "ref","firstName","lastName","birthDate","country","gender",
//                     "shortName"?,"country2"?,"notes"?,"photo"? } ],   // or "name"
//     "times":   [ { "athlete": <ref>, "round","timeMs", "startTime"?,"matchId"? } ],
//     "scores":  [ { "athlete": <ref>, "round","difficulty","combo","style",
//                    "bestTrick","controlPenalty", "overall"?,"dnf"? } ],
//     "matches": [ { "discipline","round","gender","position",
//                    "athlete1"?,"athlete2"?,"winner"?, "roundName"? } ]  // <ref>s
//   }
// `ref` is a LOCAL id used only to cross-reference athletes from times/scores/
// matches; real server-minted athleteIds are resolved at seed time. `timeMs`
// 3355550 (or "dnf": true on a score) encodes DNF. See resources/seed/demo.seed.json.

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { makeCall, seedDataset, validateDataset } from './lib/seedClient.mjs';
import { isLocalApi, seedTableHint } from './lib/seedPreflight.mjs';

const DEFAULT_API = 'https://16e1mgulu0.execute-api.eu-central-2.amazonaws.com/prod';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const assetsFlagIdx = argv.indexOf('--assets');
const assetsArg = assetsFlagIdx >= 0 ? argv[assetsFlagIdx + 1] : undefined;

const dataPath = positional[0];
if (!dataPath) {
  console.error(
    'usage: node server/scripts/seedRemote.mjs <data.json> [--assets <dir>] [--reset] [--dry-run] [--yes]',
  );
  process.exit(2);
}

const DRY_RUN = flags.has('--dry-run');
const RESET = flags.has('--reset');
const YES = flags.has('--yes');

const API = process.env.API_URL ?? DEFAULT_API;
const isLocal = isLocalApi(API);
const TOKEN = process.env.AUTH_TOKEN ?? (isLocal ? 'local-dev' : undefined);

if (!isLocal && !DRY_RUN && !TOKEN) {
  console.error(
    `AUTH_TOKEN is required for a non-local API (${API}).\nSet AUTH_TOKEN to an admin Cognito IdToken (see header).`,
  );
  process.exit(2);
}
if (!isLocal && !DRY_RUN && !YES) {
  console.error(
    `Refusing to write to a non-local API without --yes:\n  ${API}\nRe-run with --yes once you've confirmed the target.`,
  );
  process.exit(2);
}

const dataAbs = isAbsolute(dataPath) ? dataPath : resolve(process.cwd(), dataPath);
const raw = await readFile(dataAbs, 'utf8').catch((e) => {
  console.error(`cannot read data file ${dataAbs}: ${e.message}`);
  process.exit(2);
});
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`data file is not valid JSON: ${e.message}`);
  process.exit(2);
}

const { competition, athletes = [], times = [], scores = [], matches = [] } = data;
if (!competition?.compId || !competition?.name) {
  console.error('data.competition must have at least { compId, name, startDate, endDate }');
  process.exit(2);
}
try {
  validateDataset(data); // unique refs + every time/score/match ref resolves
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

// Resolve the assets directory: explicit flag > photos/ or assets/ next to the
// data file > the data file's own directory.
const dataDir = dirname(dataAbs);
const ASSETS = assetsArg
  ? isAbsolute(assetsArg)
    ? assetsArg
    : resolve(process.cwd(), assetsArg)
  : (['photos', 'assets'].map((d) => resolve(dataDir, d)).find(existsSync) ?? dataDir);

const photoCount = athletes.filter((a) => a.photo).length;
console.log(`Target : ${API}${isLocal ? '  (local)' : ''}`);
console.log(`Comp   : ${competition.compId} — "${competition.name}"`);
console.log(`Assets : ${ASSETS}`);
console.log(
  `Plan   : ${athletes.length} athletes (${photoCount} photos), ${times.length} times, ${scores.length} scores, ${matches.length} matches${RESET ? '  [--reset]' : ''}`,
);

if (DRY_RUN) {
  let missing = 0;
  for (const a of athletes) {
    if (!a.photo) continue;
    const p = isAbsolute(a.photo) ? a.photo : resolve(ASSETS, a.photo);
    if (!existsSync(p)) {
      console.warn(`! photo not found for ref "${a.ref}": ${p}`);
      missing += 1;
    }
  }
  console.log(
    `\n--dry-run: no writes made.${missing ? ` ${missing} photo file(s) missing.` : ' all photo files present.'}`,
  );
  process.exit(missing ? 1 : 0);
}

// Preflight: a local target whose LocalStack container was recreated without
// `npm run db:init` has no tables — every write 500s. Name the missing table
// instead of the opaque "seed failed" cascade (no-op for a remote API).
const tableHint = await seedTableHint({ api: API });
if (tableHint) {
  console.error(`seed preflight failed: ${tableHint}`);
  process.exit(1);
}

const call = makeCall({ api: API, token: TOKEN });
const { counts } = await seedDataset(call, data, {
  assetsDir: ASSETS,
  reset: RESET,
  log: (m) => console.log(m),
}).catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});

console.log(
  `\nDone in "${competition.compId}": ${counts.athletes}/${athletes.length} athletes (${counts.photos} photos), ${counts.times}/${times.length} times, ${counts.scores}/${scores.length} scores, ${counts.matches}/${matches.length} matches.`,
);
