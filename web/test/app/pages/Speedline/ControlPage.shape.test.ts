/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The board reports one link, graded by the socket's owner (`useLinkPhase`, via
 * `useControlSession`). Nothing behavioural can catch a regression here — `open`
 * and `ReadyState.OPEN` are the same instant by construction — but a second
 * reading of the same socket is how the two boards' health surfaces drifted
 * apart in the first place (`fsux-followup-tally-plate-2`): a page that grades
 * `readyState` itself can gate its controls on a phase its own header never
 * reports.
 */
const SOURCE_PATH = 'src/app/pages/Speedline/ControlPage.tsx';

describe('the Speedline control board file', () => {
  const source = readFileSync(resolve(process.cwd(), SOURCE_PATH), 'utf8');

  it('reads the session-graded link rather than re-grading the socket', () => {
    // Guards the path itself: a moved or renamed page would otherwise read as clean.
    expect(source).toContain('export const SpeedlineControlPage');

    expect(source).not.toMatch(/\bReadyState\b/);
    expect(source).toContain("link === 'open'");
  });
});
