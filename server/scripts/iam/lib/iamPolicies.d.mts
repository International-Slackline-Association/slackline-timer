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
