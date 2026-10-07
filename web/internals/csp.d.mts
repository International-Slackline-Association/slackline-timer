// Hand-written declarations for csp.mjs — see stackOutputs.d.mts.

import type { Plugin } from 'vite';

export declare const CSP_INPUTS: string[];

export declare function buildCsp(env: Record<string, string | undefined>): string;

export interface CspMetaPlugin extends Plugin {
  apply: 'build';
  configResolved: () => void;
  transformIndexHtml: { order: 'post'; handler: (html: string) => string };
}

export declare function cspMetaPlugin(env: Record<string, string | undefined>): CspMetaPlugin;
