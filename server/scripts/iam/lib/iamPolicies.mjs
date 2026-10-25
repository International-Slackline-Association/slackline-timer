// Pure helpers for syncLambdaPolicies.mjs, kept free of AWS calls so the TS
// suite can test them (declarations: iamPolicies.d.mts).

/**
 * The physical name of the one `AWS::IAM::Role` whose logical id starts with
 * `prefix`, from `list-stack-resources` summaries.
 */
export function pickProbeRole(resources, prefix) {
  const roles = resources.filter(
    (r) => r.ResourceType === 'AWS::IAM::Role' && r.LogicalResourceId.startsWith(prefix),
  );
  if (roles.length === 0) throw new Error(`no AWS::IAM::Role in the stack matches '${prefix}'`);
  if (roles.length > 1) {
    const ids = roles.map((r) => r.LogicalResourceId).join(', ');
    throw new Error(
      `${roles.length} roles match '${prefix}' (${ids}) — pass a longer --role prefix`,
    );
  }
  return roles[0].PhysicalResourceId;
}

// IAM stores policy documents URL-encoded; the CLI usually decodes them, but
// not on every path.
function parseDocument(doc) {
  return typeof doc === 'string' ? JSON.parse(decodeURIComponent(doc)) : doc;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

/** Equal up to object key order; array order is significant, as in IAM. */
export function samePolicyDocument(a, b) {
  return (
    JSON.stringify(canonical(parseDocument(a))) === JSON.stringify(canonical(parseDocument(b)))
  );
}

/** Which policy type an AccessDenied names: `scp`, `identity`, or `other`. */
export function classifyDenial(message) {
  if (/service control polic/i.test(message)) return 'scp';
  if (/identity-based polic/i.test(message)) return 'identity';
  return 'other';
}
