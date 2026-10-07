// Read-only audit of the competition table against the data-plane input bounds
// (ADR 0052; rules in lib/fieldBounds.mjs).
//
// PUT is a full replacement, so a stored value outside a new bound 400s on its
// next edit. Run this against prod before deploying a tightened bound: every
// violation is either fixed in the data or grandfathered in the validator first.
//
// Strictly read-only: one paginated Scan, no write call is imported, and any
// unknown or write-ish flag (--yes, --delete, …) is refused. Output carries
// PK/SK + lengths/reasons only — never names, birthDates or notes.
//
// Usage:
//   node scripts/maintenance/auditFieldBounds.mjs --local
//   node scripts/maintenance/auditFieldBounds.mjs --table <name> --profile <p> [--region r]
//
// Flags:
//   --local            LocalStack (offlineEnv endpoint/region/table); implied by IS_OFFLINE
//   --table <name>     audit this table on AWS (required unless local)
//   --region <r>       AWS region (default eu-central-2)
//   --profile <p>      AWS profile (else $AWS_PROFILE, else default chain)
//   --examples <n>     example keys per rule (default 5)
//   --json             machine-readable report on stdout
//
// Exit: 0 clean · 1 violations found · 2 error.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { loadProfileCreds, parseArgs, resolveProfile } from '../lib/awsCli.mjs';
import { OFFLINE_ENV } from '../offlineEnv.mjs';
import { auditItems } from './lib/fieldBounds.mjs';

const DEFAULT_REGION = 'eu-central-2';
const KNOWN_FLAGS = new Set(['local', 'table', 'region', 'profile', 'examples', 'json', 'help']);
const WRITE_FLAGS = new Set(['yes', 'delete', 'delete-source', 'write', 'fix', 'commit', 'apply']);

const HELP = `Read-only audit of stored competition data against the data-plane input bounds.

  node scripts/maintenance/auditFieldBounds.mjs --local [--json] [--examples n]
  node scripts/maintenance/auditFieldBounds.mjs --table <name> [--profile p] [--region r] [--json] [--examples n]

Exit: 0 clean, 1 violations, 2 error.`;

class UsageError extends Error {}

// loadProfileCreds clears AWS_PROFILE, so the failure hint needs its own copy.
let awsProfile;

function resolveTarget(argv) {
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const flag = arg.slice(2);
    if (WRITE_FLAGS.has(flag)) {
      throw new UsageError(`--${flag} refused: this audit is read-only and never writes.`);
    }
    if (!KNOWN_FLAGS.has(flag)) throw new UsageError(`unknown flag --${flag}.\n\n${HELP}`);
  }
  const opts = parseArgs(argv, { region: DEFAULT_REGION, examples: '5' });
  if (opts._.length > 0) throw new UsageError(`unexpected argument '${opts._[0]}'.\n\n${HELP}`);
  const examples = Number(opts.examples);
  if (!Number.isInteger(examples) || examples < 0) {
    throw new UsageError('--examples must be a non-negative integer.');
  }
  const local = Boolean(opts.local) || Boolean(process.env.IS_OFFLINE);
  if (!local && typeof opts.table !== 'string') {
    throw new UsageError(`pass --local (LocalStack) or --table <name> (AWS).\n\n${HELP}`);
  }
  return { opts, local, examples };
}

function makeClient({ opts, local }) {
  if (local) {
    const table = typeof opts.table === 'string' ? opts.table : OFFLINE_ENV.COMPETITION_TABLE;
    const client = new DynamoDBClient({
      endpoint: OFFLINE_ENV.DYNAMODB_ENDPOINT,
      region: OFFLINE_ENV.AWS_REGION,
      credentials: {
        accessKeyId: OFFLINE_ENV.AWS_ACCESS_KEY_ID,
        secretAccessKey: OFFLINE_ENV.AWS_SECRET_ACCESS_KEY,
      },
    });
    return { client, table, label: `LocalStack ${OFFLINE_ENV.DYNAMODB_ENDPOINT}` };
  }
  const profile = resolveProfile(opts);
  awsProfile = profile;
  if (profile) loadProfileCreds(profile);
  return {
    client: new DynamoDBClient({ region: opts.region }),
    table: opts.table,
    label: `AWS ${opts.region} (profile ${profile ?? 'default chain'})`,
  };
}

async function scanTable(ddb, table) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

function printReport(report, { label, table }) {
  console.log('== field-bounds audit (read-only) ==');
  console.log(`  target  : ${label}`);
  console.log(`  table   : ${table}`);
  console.log(`  scanned : ${report.scanned} item(s), ${report.skipped} non-competition skipped`);

  for (const [compId, comp] of Object.entries(report.competitions).sort()) {
    const rules = Object.entries(comp.violations).sort();
    const total = rules.reduce((n, [, v]) => n + v.count, 0);
    console.log(
      `\nCOMP#${compId} — ${comp.items} item(s), ${comp.athletes} athlete(s): ` +
        (total === 0 ? 'clean' : `${total} violation(s)`),
    );
    for (const [rule, { count, examples }] of rules) {
      console.log(`  ${rule.padEnd(30)} ${count}`);
      for (const ex of examples) console.log(`    ${ex.SK}  ${ex.detail}`);
    }
  }

  if (report.failingCountries.length > 0) {
    console.log(`\nCountry codes failing the regex: ${report.failingCountries.join(', ')}`);
  }
  const foreign = Object.entries(report.foreignPhotoPrefixes).sort();
  if (foreign.length > 0) {
    console.log('\nForeign-comp photoKey prefixes:');
    for (const [prefix, n] of foreign) console.log(`  ${prefix}  ×${n}`);
  }
  const comps = Object.values(report.competitions).filter(
    (c) => Object.keys(c.violations).length > 0,
  ).length;
  console.log(
    report.violationCount === 0
      ? '\nResult: clean.'
      : `\nResult: ${report.violationCount} violation(s) across ${comps} competition(s).`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return 0;
  }
  const target = resolveTarget(argv);
  const { client, table, label } = makeClient(target);
  const items = await scanTable(DynamoDBDocumentClient.from(client), table);
  const report = auditItems(items, { now: Date.now(), maxExamples: target.examples });
  if (target.opts.json) console.log(JSON.stringify({ table, ...report }, null, 2));
  else printReport(report, { label, table });
  return report.violationCount === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`\n❌ ${err.message}`);
    if (awsProfile && !(err instanceof UsageError)) {
      console.error(`   (expired SSO? try: aws sso login --profile ${awsProfile})`);
    }
    process.exit(2);
  },
);
