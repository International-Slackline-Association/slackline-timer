import { describe, expect, it } from 'vitest';

import type { FreestyleSelection, LiveSelection, SpeedSelection } from 'app/hooks/useWebSocket';
import {
  INITIAL_SELECTION_STAMP,
  acceptSelectionStamp,
  selectionSignature,
} from 'app/util/selectionLww';

// The LWW rule pinned by the useControlSession convergence tests, extracted so
// passive consumers (overlays/previews) drop the same losing side of a crossed
// edit the control panels do.
describe('acceptSelectionStamp', () => {
  it('accepts the first stamped message and advances the stamp', () => {
    expect(acceptSelectionStamp(INITIAL_SELECTION_STAMP, { seq: 100, senderId: 'a' })).toEqual({
      seq: 100,
      by: 'a',
      echo: false,
    });
  });

  it('accepts a newer seq', () => {
    expect(
      acceptSelectionStamp({ seq: 100, by: 'a', echo: false }, { seq: 101, senderId: 'b' }),
    ).toEqual({ seq: 101, by: 'b', echo: false });
  });

  it('drops an older seq (the losing side of a crossed edit arriving late)', () => {
    expect(
      acceptSelectionStamp({ seq: 100, by: 'a', echo: false }, { seq: 99, senderId: 'b' }),
    ).toBeNull();
  });

  it('tiebreaks two equal-seq claims by senderId — only a greater sender wins', () => {
    const last = { seq: 100, by: 'b', echo: false };
    expect(acceptSelectionStamp(last, { seq: 100, senderId: 'c' })).toEqual({
      seq: 100,
      by: 'c',
      echo: false,
    });
    expect(acceptSelectionStamp(last, { seq: 100, senderId: 'a' })).toBeNull();
    expect(acceptSelectionStamp(last, { seq: 100, senderId: 'b' })).toBeNull();
  });

  it('accepts an unstamped (pre-feature) message without moving the stamp', () => {
    const last = { seq: 100, by: 'a', echo: false };
    expect(acceptSelectionStamp(last, { senderId: 'b' })).toBe(last);
  });

  it('treats a missing senderId as the lowest tiebreak key', () => {
    expect(acceptSelectionStamp({ seq: 100, by: '', echo: false }, { seq: 100 })).toBeNull();
    expect(acceptSelectionStamp(INITIAL_SELECTION_STAMP, { seq: 1 })).toEqual({
      seq: 1,
      by: '',
      echo: false,
    });
  });
});

/**
 * The authority rank (ADR 0038 §4 addendum). A mirror's re-push forwards the
 * stamp it adopted, so it can only TIE the panel that authored the value — and
 * a tie used to fall to `senderId`, a per-mount UUID: whether a re-statement
 * outranked its own author was a coin flip fixed for the life of the room. The
 * wire now says which one a frame is, and a re-statement loses every tie.
 */
describe('acceptSelectionStamp authority rank', () => {
  const stored = {
    authoritative: { seq: 100, by: 'm', echo: false },
    echo: { seq: 100, by: 'm', echo: true },
  } as const;

  const cases: {
    name: string;
    last: (typeof stored)[keyof typeof stored];
    message: { seq?: number; senderId?: string; echo?: boolean };
    expected: { seq: number; by: string; echo: boolean } | null;
  }[] = [
    {
      // The author's frame lands after its own mirror's echo: the consumer that
      // took the echo first must be corrected, whatever the two ids sort like.
      name: 'authoritative beats a stored echo at equal seq (lower sender id)',
      last: stored.echo,
      message: { seq: 100, senderId: 'a', echo: undefined },
      expected: { seq: 100, by: 'a', echo: false },
    },
    {
      name: 'authoritative beats a stored echo at equal seq (higher sender id)',
      last: stored.echo,
      message: { seq: 100, senderId: 'z' },
      expected: { seq: 100, by: 'z', echo: false },
    },
    {
      name: 'an echo never beats a stored authoritative frame (lower sender id)',
      last: stored.authoritative,
      message: { seq: 100, senderId: 'a', echo: true },
      expected: null,
    },
    {
      name: 'an echo never beats a stored authoritative frame (higher sender id)',
      last: stored.authoritative,
      message: { seq: 100, senderId: 'z', echo: true },
      expected: null,
    },
    {
      name: 'echo vs echo falls back to the sender id — greater wins',
      last: stored.echo,
      message: { seq: 100, senderId: 'z', echo: true },
      expected: { seq: 100, by: 'z', echo: true },
    },
    {
      name: 'echo vs echo falls back to the sender id — lesser loses',
      last: stored.echo,
      message: { seq: 100, senderId: 'a', echo: true },
      expected: null,
    },
    {
      name: 'a higher seq wins regardless of the flag',
      last: stored.authoritative,
      message: { seq: 101, senderId: 'a', echo: true },
      expected: { seq: 101, by: 'a', echo: true },
    },
    {
      name: 'a lower seq loses regardless of the flag',
      last: stored.echo,
      message: { seq: 99, senderId: 'z' },
      expected: null,
    },
    {
      name: 'an unstamped message still applies, whatever is stored',
      last: stored.echo,
      message: { senderId: 'z' },
      expected: stored.echo,
    },
  ];

  it.each(cases)('$name', ({ last, message, expected }) => {
    expect(acceptSelectionStamp(last, message)).toEqual(expected);
  });
});

/**
 * Each arm of `LiveSelection` with EVERY field populated. Typed `Required<…>`
 * on purpose: a field added to either arm — optional ones included — stops that
 * literal compiling until it is added here, and the leaf walk below then covers
 * it automatically. That is the guard the hand-listed dep array lacked, and the
 * union split (`SpeedSelection | FreestyleSelection`) is why there are two: a
 * single literal carrying both boards' session state no longer typechecks, and
 * a `Required<LiveSelection>` would have silently satisfied itself with whichever
 * arm happened to match.
 */
const fullFreestyleSelection: Required<FreestyleSelection> = {
  discipline: 'freestyle',
  round: 'final',
  gender: 'male',
  matchId: 'match-1',
  athlete1Id: 'athlete-1',
  athlete2Id: 'athlete-2',
  freestyleMode: 'battle',
  bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: true },
  nextUp: 1,
  qualiNextUp: 'athlete-3',
};

const fullSpeedSelection: Required<SpeedSelection> = {
  discipline: 'speed',
  round: 'final',
  gender: 'male',
  matchId: 'match-1',
  athlete1Id: 'athlete-1',
  athlete2Id: 'athlete-2',
  runWins: { 1: 1, 2: 2 },
  falseStarts: { 1: 0, 2: 1 },
};

const FULL_SELECTIONS: [string, LiveSelection][] = [
  ['freestyle', fullFreestyleSelection],
  ['speed', fullSpeedSelection],
];

type Nested = Record<string, unknown>;
const isNested = (value: unknown): value is Nested => typeof value === 'object' && value !== null;

/** Every leaf path of a nested plain object, as key arrays. */
const leafPaths = (value: unknown, prefix: string[] = []): string[][] =>
  isNested(value)
    ? Object.keys(value).flatMap((key) => leafPaths(value[key], [...prefix, key]))
    : [prefix];

/** A copy with the leaf at `path` replaced by a different value of its type. */
const mutateLeaf = (value: unknown, path: string[]): unknown => {
  const [key, ...rest] = path;
  if (key === undefined) {
    if (typeof value === 'number') return value + 1;
    if (typeof value === 'boolean') return !value;
    return `${String(value)}-changed`;
  }
  return { ...(value as Nested), [key]: mutateLeaf((value as Nested)[key], rest) };
};

/** The same values under reversed key insertion order, at every level. */
const reverseKeys = (value: unknown): unknown =>
  isNested(value)
    ? Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, member]) => [key, reverseKeys(member)]),
      )
    : value;

describe('selectionSignature', () => {
  it.each(FULL_SELECTIONS)(
    'changes when any %s leaf changes, nested tallies included',
    (_arm, full) => {
      const base = selectionSignature(full);
      const paths = leafPaths(full);

      for (const path of paths) {
        const mutated = mutateLeaf(full, path) as LiveSelection;
        expect(selectionSignature(mutated), path.join('.')).not.toBe(base);
      }
    },
  );

  // The walk must reach INTO the tallies — a per-try best-trick count and a
  // per-lane run-wins digit are the deps the hand-listed array was most likely
  // to miss.
  it('walks into the nested tallies of both arms', () => {
    expect(leafPaths(fullFreestyleSelection)).toContainEqual(['bestTrick', 'tries', '1']);
    expect(leafPaths(fullSpeedSelection)).toContainEqual(['runWins', '2']);
  });

  it.each(FULL_SELECTIONS)(
    'digests equal %s values equally, whatever the key order (the echo terminator)',
    (_arm, full) => {
      const reordered = reverseKeys(full) as LiveSelection;
      expect(selectionSignature(reordered)).toBe(selectionSignature(full));
      expect(reordered).not.toBe(full);
    },
  );

  it('reads an absent optional field and an explicit undefined as the same value', () => {
    // Both are the same thing once JSON.stringify has run over the wire, so
    // neither may fake a change and re-push.
    const absent: FreestyleSelection = { ...fullFreestyleSelection };
    delete absent.nextUp;
    expect(selectionSignature({ ...absent, nextUp: undefined })).toBe(selectionSignature(absent));
  });
});
