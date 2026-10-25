// Hand-written declarations for iamPolicies.mjs (same arrangement as
// scripts/maintenance/lib/fieldBounds.mjs).

export interface StackResourceSummary {
  LogicalResourceId: string;
  ResourceType: string;
  PhysicalResourceId: string;
}

export declare function pickProbeRole(resources: StackResourceSummary[], prefix: string): string;
export declare function samePolicyDocument(a: unknown, b: unknown): boolean;
export declare function classifyDenial(message: string): 'scp' | 'identity' | 'other';

export interface ResolveContext {
  partition: string;
  region: string;
  account: string;
  resources: StackResourceSummary[];
}

export interface PolicyDocument {
  Version?: string;
  Statement: unknown[];
}

export interface ExternalPolicy {
  PolicyName: string;
  Roles: unknown[];
  PolicyDocument: unknown;
}

export interface PlannedPolicy {
  roleName: string;
  policyName: string;
  document: PolicyDocument;
}

export declare function resolveIntrinsics(value: unknown, ctx: ResolveContext): unknown;
export declare function unionDocuments(
  current: PolicyDocument,
  target: PolicyDocument,
): PolicyDocument;
export declare function planPolicies(
  external: Record<string, ExternalPolicy>,
  ctx: ResolveContext,
): PlannedPolicy[];

export interface Template {
  Resources: Record<string, Record<string, unknown>>;
  [section: string]: unknown;
}

export declare function retainPolicies<T extends Template>(
  template: T,
): { template: T; changed: string[] };
