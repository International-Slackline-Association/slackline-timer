import { describe, expect, it } from 'vitest';

import type { FreestyleSelection, LiveSelection, SpeedSelection } from 'app/hooks/useWebSocket';

/**
 * The selection union's split (`SpeedSelection | FreestyleSelection`,
 * discriminated on `discipline`), held at the TYPE level: the two boards share
 * one relay room, and the whole point of the split is that neither arm can
 * carry — or read — the other board's session state. A field parked on the
 * wrong arm is invisible to a runtime assertion (it is optional, so nothing
 * ever sets it), so the guard has to be the compiler: the tables below stop
 * compiling the moment a key crosses over.
 *
 * The wire is unchanged by the split — every field was already optional and
 * each board already sent only its own — so there is nothing here about the
 * message shapes; `selectionLww.test.ts` walks both arms' full literals.
 */

/** `true` only while `K` is absent from `T`. */
type Excludes<T, K extends string> = K extends keyof T ? false : true;

/** `true` only while `K` is present on `T`. */
type Carries<T, K extends string> = K extends keyof T ? true : false;

const speedExcludesFreestyleFields: [
  Excludes<SpeedSelection, 'freestyleMode'>,
  Excludes<SpeedSelection, 'bestTrick'>,
  Excludes<SpeedSelection, 'nextUp'>,
  Excludes<SpeedSelection, 'qualiNextUp'>,
] = [true, true, true, true];

const freestyleExcludesSpeedFields: [
  Excludes<FreestyleSelection, 'runWins'>,
  Excludes<FreestyleSelection, 'falseStarts'>,
] = [true, true];

/** Both arms still answer the identity question every consumer asks first. */
const bothCarryTheCommonIdentity: [
  Carries<SpeedSelection, 'round'>,
  Carries<SpeedSelection, 'gender'>,
  Carries<SpeedSelection, 'matchId'>,
  Carries<SpeedSelection, 'athlete1Id'>,
  Carries<SpeedSelection, 'athlete2Id'>,
  Carries<FreestyleSelection, 'round'>,
  Carries<FreestyleSelection, 'gender'>,
  Carries<FreestyleSelection, 'matchId'>,
  Carries<FreestyleSelection, 'athlete1Id'>,
  Carries<FreestyleSelection, 'athlete2Id'>,
] = [true, true, true, true, true, true, true, true, true, true];

describe('LiveSelection arms', () => {
  it('keeps each board’s session state on its own arm', () => {
    expect(speedExcludesFreestyleFields.every(Boolean)).toBe(true);
    expect(freestyleExcludesSpeedFields.every(Boolean)).toBe(true);
    expect(bothCarryTheCommonIdentity.every(Boolean)).toBe(true);
  });

  it('narrows to the freestyle arm on the discipline tag', () => {
    // The runtime half of the same promise: `discipline` is what every consumer
    // already checks before reading a board-specific field, and after that check
    // the compiler hands it the right arm.
    const selection: LiveSelection = {
      discipline: 'freestyle',
      round: 'qualification',
      gender: 'male',
      matchId: null,
      athlete1Id: 'a1',
      athlete2Id: null,
      qualiNextUp: 'a2',
    };

    expect(selection.discipline === 'freestyle' ? selection.qualiNextUp : null).toBe('a2');
  });
});
