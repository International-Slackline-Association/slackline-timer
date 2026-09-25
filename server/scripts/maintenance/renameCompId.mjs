// Rename a competition's compId across the prod data plane.
//
// There is NO API for this: compId is the DynamoDB partition key (`COMP#<id>`)
// for EVERY item in the competition (META / athletes / times / matches / scores)
// AND is stored as a plain `compId` attribute on each of them, AND is baked into
// each athlete's S3 photo key (`photos/<compId>/<hash>.ext`). DynamoDB can't
// mutate a primary key in place, so a rename is a copy-the-whole-partition-to-a-
// new-key migration plus a matching S3 object copy — not an edit. This script is
// that migration, run directly against DynamoDB + S3 (bypassing the HTTP API,
// which has no rename route and couldn't express a PK change anyway).
//
// What it does NOT touch, and why:
//   - Relay table (`…-relay-prod`): only ephemeral connection rows keyed by the
//     old sessionId, TTL'd out in minutes (CONNECTION_TTL_SECONDS in
//     src/core/db.ts). Live tabs must reconnect on the new compId anyway
//     (reload with ?compId=<new>), so migrating dead connection rows is pointless.
//   - Read tokens: HMAC JWTs are scoped to the compId claim, so every existing
//     OBS overlay link breaks on rename. Re-mint them on /admin/overlays after.
//   - Web localStorage (selected competition): operators re-select the new id.
//
// Safety model (mirrors decommission/gc + seedRemote):
//   - DRY RUN by default: prints the plan, writes nothing. Pass --yes to execute.
//   - Never clobbers: aborts if the target partition already holds any item.
//   - Copy → verify → (optional) sweep. The source is LEFT INTACT unless you pass
//     --delete-source, so you can sanity-check the renamed comp in the admin UI
//     first, then re-run with --delete-source to remove the old partition.
//   - Idempotent: copy uses Put/CopyObject (overwrite), so a re-run after a
//     partial failure is safe.
//
// Usage:
//   node scripts/maintenance/renameCompId.mjs --from <oldId> --to <newId>
//   node scripts/maintenance/renameCompId.mjs --from old --to new --yes
//   node scripts/maintenance/renameCompId.mjs --from old --to new --yes --delete-source
//
// Flags:
//   --from <id>        source compId (required)
//   --to <id>          target compId (required; 1-64 chars, [A-Za-z0-9_-])
//   --yes              actually write (default is dry-run)
//   --delete-source    after a verified copy, delete the old partition + photos
//   --skip-photos      DON'T copy S3 photo objects / rewrite photoKey. Photos then
//                      keep pointing at photos/<oldId>/… — which KEEPS WORKING only
//                      while the old objects survive (so never combine with a later
//                      old-prefix cleanup). Use only for a DynamoDB-only rename.
//   --region <r>       AWS region (default eu-central-2)
//   --table <name>     competition table (default slackline-timer-v1-competition-prod)
//   --bucket <name>    photos bucket    (default slackline-timer-v1-photos-prod)
//   --profile <p>      AWS profile (else $AWS_PROFILE, else default chain)
//
// Auth: pass --profile and the script materializes that profile's (SSO) creds
// into the env itself — no `eval "$(aws configure export-credentials …)"` dance
// needed (the SDK can't resolve the SSO cache directly on this box; see
// loadProfileCreds). With no --profile it uses the ambient env / default chain.
// Expired SSO? `aws sso login --profile <p>` first.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { parseArgs, resolveProfile, runAws, runMain } from '../lib/awsCli.mjs';

const DEFAULTS = {
  region: 'eu-central-2',
  table: 'slackline-timer-v1-competition-prod',
  bucket: 'slackline-timer-v1-photos-prod',
};

const COMP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // must match validateCompetitionInput
const compPk = (id) => `COMP#${id}`;
const photoPrefix = (id) => `photos/${id}/`;
const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Materialize concrete temporary credentials for `profile` into the env.
 *
 * The AWS SDK's default chain does NOT reliably resolve the SSO token cache on
 * this box: `--profile` alone fails "security token included in the request is
 * invalid" even right after `aws sso login` (the plain CLI refreshes SSO fine,
 * which is why `aws sts get-caller-identity` can succeed while this script
 * can't). The CLI's `export-credentials` DOES refresh SSO, so we shell out to it
 * and load the resulting keys into `process.env`, where the SDK's fromEnv
 * provider — first in the chain — picks them up. Same workaround the CDK deploys
 * use; see doc/dev/deploy.md §8.
 *
 * `env-no-export` emits bare `AWS_*=value` lines (no `export`, no quotes); values
 * can contain `=` and `/` (the session token), so split on the FIRST `=` only.
 * AWS_PROFILE is then cleared so the concrete env creds win outright and nothing
 * re-triggers the failing SSO role-assume.
 */
function loadProfileCreds(profile) {
  const out = runAws(['configure', 'export-credentials', '--format', 'env-no-export'], { profile });
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0 && line.startsWith('AWS_')) {
      process.env[line.slice(0, eq)] = line.slice(eq + 1).trim();
    }
  }
  delete process.env.AWS_PROFILE;
}

const HELP = `Rename a competition's compId across DynamoDB + S3 (dry-run unless --yes).

  node scripts/maintenance/renameCompId.mjs --from <oldId> --to <newId>
    [--yes] [--delete-source] [--skip-photos]
    [--region r] [--table name] [--bucket name] [--profile p]`;

/** Page through every item in a competition partition. */
async function scanPartition(ddb, table, id) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': compPk(id) },
        ExclusiveStartKey,
      }),
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** BatchWrite in 25-item chunks, re-driving UnprocessedItems with backoff. */
async function batchWrite(ddb, table, requests) {
  for (const group of chunk(requests, 25)) {
    let pending = { [table]: group };
    for (let attempt = 0; Object.keys(pending).length > 0; attempt += 1) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: pending }));
      pending = res.UnprocessedItems ?? {};
      if (Object.keys(pending).length === 0) break;
      if (attempt >= 8)
        throw new Error('BatchWrite kept returning UnprocessedItems after 8 retries');
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2), DEFAULTS);
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const from = opts.from;
  const to = opts.to;
  if (!from || !to) throw new Error('both --from and --to are required.\n\n' + HELP);
  if (from === to) throw new Error('--from and --to are identical; nothing to rename.');
  if (!COMP_ID_RE.test(to)) {
    throw new Error(`--to '${to}' is not a valid compId (1-64 chars, letters/digits/_/-).`);
  }

  const commit = Boolean(opts.yes);
  const deleteSource = Boolean(opts.deleteSource);
  const skipPhotos = Boolean(opts.skipPhotos);
  const { region, table, bucket } = opts;
  const profile = resolveProfile(opts);
  // Materialize SSO creds into the env when a profile is set (the SDK can't
  // resolve the SSO cache directly on this box — see loadProfileCreds). With no
  // profile we fall through to whatever the ambient env / default chain provides.
  if (profile) loadProfileCreds(profile);

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3 = new S3Client({ region });

  console.log('== rename compId ==');
  console.log(`  profile : ${profile ?? '(default chain)'}`);
  console.log(`  region  : ${region}`);
  console.log(`  table   : ${table}`);
  console.log(`  bucket  : ${skipPhotos ? '(skipped)' : bucket}`);
  console.log(`  from    : ${from}`);
  console.log(`  to      : ${to}`);
  console.log(
    `  mode    : ${commit ? (deleteSource ? 'COMMIT + DELETE SOURCE' : 'COMMIT (source kept)') : 'DRY RUN'}`,
  );
  console.log('');

  // --- read source + guard target --------------------------------------------
  const [source, targetExisting] = await Promise.all([
    scanPartition(ddb, table, from),
    scanPartition(ddb, table, to),
  ]);
  if (source.length === 0)
    throw new Error(`source competition '${from}' has no items (nothing at ${compPk(from)}).`);
  if (!source.some((i) => i.SK === 'META')) {
    throw new Error(
      `source partition ${compPk(from)} has ${source.length} item(s) but no META — refusing (not a competition?).`,
    );
  }
  if (targetExisting.length > 0) {
    throw new Error(
      `target '${to}' already holds ${targetExisting.length} item(s) — refusing to clobber. Pick a fresh compId.`,
    );
  }

  const byKind = source.reduce((acc, i) => {
    const kind = String(i.SK).split('#')[0];
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Source ${compPk(from)} holds ${source.length} item(s):`);
  for (const [kind, n] of Object.entries(byKind).sort()) console.log(`  ${kind.padEnd(8)} ${n}`);

  // --- plan photo moves -------------------------------------------------------
  const oldPrefix = photoPrefix(from);
  const photoMoves = []; // { oldKey, newKey }
  let foreignPhotos = 0;
  for (const item of source) {
    const key = item.photoKey;
    if (typeof key !== 'string' || key.length === 0) continue;
    if (key.startsWith(oldPrefix)) {
      photoMoves.push({ oldKey: key, newKey: photoPrefix(to) + key.slice(oldPrefix.length) });
    } else {
      foreignPhotos += 1; // photoKey not under this comp's prefix — leave untouched
    }
  }
  if (!skipPhotos) {
    console.log(
      `\nPhotos: ${photoMoves.length} object(s) to copy under ${photoPrefix(to)}` +
        (foreignPhotos
          ? ` (${foreignPhotos} photoKey(s) not under ${oldPrefix} — left as-is)`
          : ''),
    );
  } else if (photoMoves.length) {
    console.log(
      `\n--skip-photos: ${photoMoves.length} photoKey(s) will keep pointing at ${oldPrefix} (DO NOT clean up the old prefix later).`,
    );
  }

  // --- build rewritten items --------------------------------------------------
  // Rewrite PK + the self-describing `compId` attribute on every item; rewrite
  // photoKey too unless photos are being left in place.
  const rewritePhoto = !skipPhotos && photoMoves.length > 0;
  const newItems = source.map((item) => {
    const next = { ...item, PK: compPk(to), compId: to };
    if (rewritePhoto && typeof item.photoKey === 'string' && item.photoKey.startsWith(oldPrefix)) {
      next.photoKey = photoPrefix(to) + item.photoKey.slice(oldPrefix.length);
    }
    return next;
  });

  if (!commit) {
    console.log(
      '\nDRY RUN — no writes. Re-run with --yes to copy, then --yes --delete-source to sweep the old partition.',
    );
    return;
  }

  // --- copy DynamoDB ----------------------------------------------------------
  console.log(`\nCopying ${newItems.length} item(s) → ${compPk(to)} …`);
  await batchWrite(
    ddb,
    table,
    newItems.map((Item) => ({ PutRequest: { Item } })),
  );

  // --- copy S3 photos ---------------------------------------------------------
  if (!skipPhotos) {
    for (const { oldKey, newKey } of photoMoves) {
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: newKey,
          CopySource: `${bucket}/${encodeURIComponent(oldKey).replace(/%2F/g, '/')}`,
        }),
      );
    }
    if (photoMoves.length) console.log(`Copied ${photoMoves.length} photo object(s).`);
  }

  // --- verify -----------------------------------------------------------------
  const target = await scanPartition(ddb, table, to);
  if (target.length !== source.length) {
    throw new Error(
      `verify FAILED: source had ${source.length} item(s) but target has ${target.length}. Source left intact — inspect before retrying.`,
    );
  }
  if (!skipPhotos) {
    for (const { newKey } of photoMoves) {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: newKey })); // throws if missing
    }
  }
  console.log(
    `Verified: ${target.length} item(s)` +
      (skipPhotos ? '' : ` + ${photoMoves.length} photo(s)`) +
      ` present under '${to}'.`,
  );

  // --- sweep source (optional) ------------------------------------------------
  if (!deleteSource) {
    console.log(
      `\nSource '${from}' LEFT INTACT. Verify the renamed competition in the admin UI, then run:`,
    );
    console.log(
      `  node scripts/maintenance/renameCompId.mjs --from ${from} --to ${to} --yes --delete-source`,
    );
  } else {
    console.log(`\nDeleting source partition ${compPk(from)} …`);
    await batchWrite(
      ddb,
      table,
      source.map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })),
    );
    if (!skipPhotos && photoMoves.length) {
      for (const group of chunk(photoMoves, 1000)) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: group.map(({ oldKey }) => ({ Key: oldKey })), Quiet: true },
          }),
        );
      }
      console.log(`Deleted ${photoMoves.length} old photo object(s).`);
    }
    console.log(`Source '${from}' removed.`);
  }

  console.log('\nDone. Remaining manual steps:');
  console.log(
    '  - Re-mint OBS overlay read-token links on /admin/overlays (old tokens are scoped to the old compId).',
  );
  console.log(
    '  - Reload any open control/preview tabs with ?compId=' +
      to +
      ' (the relay sessionId changed).',
  );
});
