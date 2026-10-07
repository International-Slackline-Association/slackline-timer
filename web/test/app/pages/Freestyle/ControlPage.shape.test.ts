/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `ControlPage.tsx` is **layout only**: no state hook of its own. Nothing else
 * checks it: the board renders identically whether the state it shows lives
 * here or in `useFreestyleBoard`, so a slice that grows one state hook back —
 * and with it the ordering races between the machines, the drains and the peer
 * router that the split removed (ADR 0032) — passes every behavioural test on
 * the board.
 */
const STATEFUL = /\buse(State|Reducer|Effect|LayoutEffect|Ref|SyncExternalStore)\s*\(/g;

const SOURCE_PATH = 'src/app/pages/Freestyle/ControlPage.tsx';

describe('the Freestyle control board file', () => {
  const source = readFileSync(resolve(process.cwd(), SOURCE_PATH), 'utf8');

  it('is layout only — every machine, drain and relay send stays in the board hook', () => {
    // Guards the path itself: a moved or renamed page would otherwise read as clean.
    expect(source).toContain('export const FreestyleControlPage');

    expect(Array.from(source.matchAll(STATEFUL), ([hook]) => hook)).toEqual([]);
    expect(source).not.toMatch(/\bsendWSMessage\b/);
  });
});
