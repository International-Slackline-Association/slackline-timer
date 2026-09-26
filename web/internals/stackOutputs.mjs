// Read a CloudFormation stack's Outputs: ask the stack that OWNS a value
// (bucket name, distribution id, API URLs) instead of carrying a copy that goes
// stale silently. A stale bucket name is not a broken deploy, it is
// `s3 sync --delete` against whatever bucket now answers to that name — so
// nothing here falls back to a literal.
//
// Shells out to the AWS CLI v2 rather than adding @aws-sdk/client-cloudformation:
// the web package carries no AWS SDK at all, and every ops script in this repo
// goes through the CLI. Conventions mirror server/scripts/lib/awsCli.mjs —
// profile/region appended as flags, `--output json`, the CLI's own stderr
// surfaced verbatim (an expired SSO session is the usual cause).

import { execFileSync } from 'node:child_process';

const AWS_ENV = {
  ...process.env,
  // Non-ASCII output otherwise crashes the CLI's Python stdout encoder (the
  // Windows cp1252 charmap error).
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
};

/**
 * Run `aws <args>` with the given profile/region, returning stdout. Throws with
 * the CLI's stderr on a non-zero exit.
 */
export function runAws(args, { profile, region } = {}) {
  const full = [...args];
  if (region) full.push('--region', region);
  if (profile) full.push('--profile', profile);
  try {
    return execFileSync('aws', full, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: AWS_ENV,
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('`aws` CLI not found on PATH — install AWS CLI v2 (see README.md).', {
        cause: err,
      });
    }
    const stderr = err.stderr?.toString?.().trim();
    throw new Error(stderr || err.message, { cause: err });
  }
}

/**
 * `describe-stacks` → `{ [OutputKey]: OutputValue }` for one stack in one region.
 * `run` is the AWS-CLI seam the tests inject. A CLI failure, an unparseable
 * payload or a missing stack throws rather than returning a partial map a
 * caller could read as "no outputs".
 */
export function stackOutputs(stackName, { region, profile, run = runAws } = {}) {
  const where = `${stackName} (${region})`;
  const args = ['cloudformation', 'describe-stacks', '--stack-name', stackName, '--output', 'json'];
  let stdout;
  try {
    stdout = run(args, { profile, region });
  } catch (err) {
    throw new Error(`cannot describe stack ${where}: ${err.message}`, { cause: err });
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`describe-stacks returned no parseable JSON for stack ${where}.`, {
      cause: err,
    });
  }

  const stack = payload?.Stacks?.[0];
  if (!stack) {
    throw new Error(`stack ${where} does not exist — deploy it before deploying the web app.`);
  }

  const outputs = {};
  for (const entry of stack.Outputs ?? []) {
    if (entry?.OutputKey) outputs[entry.OutputKey] = entry.OutputValue;
  }
  return outputs;
}

/**
 * Pick the named outputs out of a `stackOutputs()` map, or throw naming every
 * missing one plus what the stack does publish. Blank counts as missing: an
 * empty bucket name reaching `s3 sync` is the failure this module exists to
 * prevent.
 */
export function requireOutputs(outputs, names, { stackName, region } = {}) {
  const resolved = {};
  const missing = [];
  for (const name of names) {
    const value = typeof outputs[name] === 'string' ? outputs[name].trim() : '';
    if (value) resolved[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    const present = Object.keys(outputs).sort().join(', ') || 'none';
    throw new Error(
      `stack ${stackName} (${region}) publishes no ${missing.join(', ')} output` +
        ` — it publishes: ${present}.` +
        ` Deploy the current template (cdk deploy ${stackName}) and re-run.`,
    );
  }
  return resolved;
}
