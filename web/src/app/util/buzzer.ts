/**
 * Sony "Buzz!" quiz-buzzer helpers. The full hardware reference (why a button
 * index maps to a given handset + colour) is in `doc/dev/buzzer-hardware.md`.
 */

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import { laneControlName } from 'app/util/controlName';

/**
 * Whether a `Gamepad.id` string is a Buzz! buzzer. The string varies by
 * browser/OS ("Sony Buzz", "Logitech Buzz(tm) Controller V1", or a generic
 * "…Vendor: 054c Product: 0002…"), so match either the name or the USB
 * vendor/product pair rather than one exact string.
 */
export const isBuzzController = (id: string): boolean =>
  /buzz/i.test(id) || (/054c/i.test(id) && /0002/.test(id));

const BUZZ_COLORS = ['Red', 'Yellow', 'Green', 'Orange', 'Blue'] as const;
export type BuzzColor = (typeof BUZZ_COLORS)[number];

/**
 * The physical button behind a Gamepad button index: one dongle exposes four
 * handsets of five buttons (indices 0–19), each handset ordered
 * red, yellow, green, orange, blue. Derived (not hand-listed) so a page only
 * needs to state `{ button, action }`; handset/colour follow from the index.
 */
export const buzzButton = (index: number): { handset: number; color: BuzzColor } => ({
  handset: Math.floor(index / 5) + 1,
  color: BUZZ_COLORS[index % 5],
});

/** CSS swatch colour for a physical button colour (the real object colour, not
 *  a theme token — it must match the hardware the operator is looking at). */
export const buzzSwatch: Record<BuzzColor, string> = {
  Red: '#e53935',
  Yellow: '#fdd835',
  Green: '#43a047',
  Orange: '#fb8c00',
  Blue: '#1e88e5',
};

/**
 * The one hardware↔screen colour pair that actively misleads, said out loud on
 * every surface that lists the mapping (FREESTYLE_BOARD_UX §4.14): the handset's
 * red key is the board's green control. Both boards start from red, so one
 * sentence serves both desks — a second copy is how the two would drift.
 */
export const HANDSET_COLOUR_NOTE = 'red → Start (green on screen)';

/** One page-specific line: which gamepad button index does what on this page. */
export interface BuzzerMappingRow {
  /** Gamepad button index (0–19). Handset + colour are derived from it. */
  button: number;
  /** What the button does on this page. */
  action: string;
}

/**
 * The Freestyle board's five per-athlete buttons, in the handset's own colour
 * order (red, yellow, green, orange, blue). Athlete 2's handset is the same five
 * at `+LANE_2_OFFSET`.
 *
 * Exported because the lane guards (`CountdownControl`), the best-trick guards
 * (`BestTrickPanel`), `buzzerRows` and the readout all read THESE numbers — the
 * mapping the operator is shown is generated from the constants the handlers
 * dispatch on, never hand-retyped beside them (audit S18).
 */
export const LANE_BUTTONS = { start: 0, reset: 1, aux: 2, try: 3, stop: 4 } as const;
export type LaneButtonRole = keyof typeof LANE_BUTTONS;

/** Athlete 2's handset is Athlete 1's, one handset along. */
export const LANE_2_OFFSET = 5;

/**
 * The pad index of the one-button ADVANCE (ADR 0037): handset 3's red. 0–9 are
 * all claimed by the per-athlete buttons above, so the buzzer defaults to 10.
 * One constant to re-map once the venue buzzer hardware is known — a buzzer
 * presenting as pad button 0 collides with Athlete 1's Start and needs that
 * mapping re-homed first (ADR 0037 consequences).
 */
export const ADVANCE_BUTTON = 10;

/** Roles in the handset's physical top-to-bottom order. */
const LANE_ROLES = ['start', 'reset', 'aux', 'try', 'stop'] as const;

/**
 * The Freestyle board's whole handset mapping, generated from the constants
 * above and named through `controlName`, so a row and the on-screen twin of
 * its key say the same words. Mode-aware, because a row that does nothing is
 * worse than no row: quali renders one athlete slot and no best-trick panel, so it
 * maps four keys plus ADVANCE, where battle maps all eleven.
 */
export const buzzerRows = (mode: FreestyleMode): BuzzerMappingRow[] => {
  const athletes: (1 | 2)[] = mode === 'battle' ? [1, 2] : [1];
  const roles = LANE_ROLES.filter((role) => role !== 'try' || mode === 'battle');
  const lanes = athletes.flatMap((athlete) =>
    roles.map((role) => ({
      button: LANE_BUTTONS[role] + (athlete === 2 ? LANE_2_OFFSET : 0),
      action: laneControlName(role, mode, athlete),
    })),
  );
  return [
    ...lanes.sort((a, b) => a.button - b.button),
    { button: ADVANCE_BUTTON, action: 'ADVANCE (also Space)' },
  ];
};
