/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every competition-scoped API path goes through `compPath`, which encodes each
 * segment; a hand-built template lets a crafted `compId` (an overlay URL param)
 * reroute the request within the API.
 */
const APP_DIR = resolve(process.cwd(), 'src/app');
const HELPER = join('api', 'paths.ts');
const RAW_COMP_PATH = /`\/competitions\/\$\{/;

const offenders = readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file) && file !== HELPER)
  .filter((file) => RAW_COMP_PATH.test(readFileSync(join(APP_DIR, file), 'utf8')));

describe('competition API paths', () => {
  it('are built only by compPath', () => {
    expect(offenders).toEqual([]);
  });

  it('the guard matches a raw template', () => {
    expect(RAW_COMP_PATH.test('apiFetch(`/competitions/${compId}/athletes`)')).toBe(true);
  });
});
