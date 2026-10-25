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

/**
 * Resolve the intrinsics the synthesized Lambda policies use (`Ref`,
 * `Fn::GetAtt …Arn` on tables and buckets, `Fn::Join`) against the live stack.
 * Anything else throws: a guessed ARN would grant the wrong resource.
 *
 * `ctx`: `{ partition, region, account, resources }`, `resources` being
 * `list-stack-resources` summaries.
 */
export function resolveIntrinsics(value, ctx) {
  if (Array.isArray(value)) return value.map((v) => resolveIntrinsics(v, ctx));
  if (!value || typeof value !== 'object') return value;

  const keys = Object.keys(value);
  const fn =
    keys.length === 1 && (keys[0] === 'Ref' || keys[0].startsWith('Fn::')) ? keys[0] : null;
  if (!fn) {
    return Object.fromEntries(keys.map((k) => [k, resolveIntrinsics(value[k], ctx)]));
  }

  const arg = value[fn];
  const resource = (logicalId) => {
    const found = ctx.resources.find((r) => r.LogicalResourceId === logicalId);
    if (!found) throw new Error(`cannot resolve '${logicalId}': not a resource of the stack`);
    return found;
  };
  if (fn === 'Ref') {
    const pseudo = {
      'AWS::Partition': ctx.partition,
      'AWS::Region': ctx.region,
      'AWS::AccountId': ctx.account,
      'AWS::URLSuffix': 'amazonaws.com',
    };
    return pseudo[arg] ?? resource(arg).PhysicalResourceId;
  }
  if (fn === 'Fn::GetAtt') {
    const [logicalId, attribute] = arg;
    const { ResourceType: type, PhysicalResourceId: name } = resource(logicalId);
    if (attribute === 'Arn' && type === 'AWS::DynamoDB::Table') {
      return `arn:${ctx.partition}:dynamodb:${ctx.region}:${ctx.account}:table/${name}`;
    }
    if (attribute === 'Arn' && type === 'AWS::S3::Bucket')
      return `arn:${ctx.partition}:s3:::${name}`;
    throw new Error(`cannot resolve Fn::GetAtt ${logicalId}.${attribute} (${type})`);
  }
  if (fn === 'Fn::Join') {
    const [separator, parts] = arg;
    return resolveIntrinsics(parts, ctx).join(separator);
  }
  throw new Error(`cannot resolve ${fn}`);
}

/** `current` with every statement of `target` it lacks appended. */
export function unionDocuments(current, target) {
  const key = (statement) => JSON.stringify(canonical(statement));
  const seen = new Set(current.Statement.map(key));
  return {
    ...current,
    Statement: [...current.Statement, ...target.Statement.filter((s) => !seen.has(key(s)))],
  };
}

// IAM's quota for the inline policies of one role, whitespace excluded.
const INLINE_POLICY_MAX_CHARS = 10_240;

/**
 * The template Metadata's external policies (externalPolicies.ts), each resolved
 * onto its role: `[{ roleName, policyName, document }]`.
 */
export function planPolicies(external, ctx) {
  return Object.values(external).map(({ PolicyName, Roles, PolicyDocument }) => {
    if (Roles.length !== 1)
      throw new Error(`${PolicyName} attaches to ${Roles.length} roles, expected 1`);
    const document = resolveIntrinsics(PolicyDocument, ctx);
    const size = JSON.stringify(document).length;
    if (size > INLINE_POLICY_MAX_CHARS) {
      throw new Error(`${PolicyName} is ${size} characters, past IAM's ${INLINE_POLICY_MAX_CHARS}`);
    }
    return { roleName: resolveIntrinsics(Roles[0], ctx), policyName: PolicyName, document };
  });
}

/**
 * A copy of `template` with every `AWS::IAM::Policy` marked
 * `DeletionPolicy`/`UpdateReplacePolicy: Retain` and nothing else changed, so
 * the deploy that drops them from the template leaves them in IAM.
 */
export function retainPolicies(template) {
  const out = structuredClone(template);
  const changed = [];
  for (const [id, resource] of Object.entries(out.Resources)) {
    if (resource.Type !== 'AWS::IAM::Policy') continue;
    if (resource.DeletionPolicy === 'Retain' && resource.UpdateReplacePolicy === 'Retain') continue;
    resource.DeletionPolicy = 'Retain';
    resource.UpdateReplacePolicy = 'Retain';
    changed.push(id);
  }
  return { template: out, changed };
}
