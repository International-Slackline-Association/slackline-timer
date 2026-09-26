import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ControlStatusHeader } from 'app/components/ControlStatusHeader';
import type { AthleteSlot, ScoreEntry } from 'app/hooks/useScoreRecorder';
import { FreestyleScoreControls } from 'app/pages/Freestyle/FreestyleScoreControls';
import { HandsetCard } from 'app/pages/Freestyle/HandsetCard';
import { TallyPlate } from 'app/pages/Freestyle/TallyPlate';
import { GamepadSelectionProvider } from 'app/state/gamepadSelection';
import { liveCaption } from 'app/theme/tokens';
import type { Athlete } from 'app/types';
import { initialBattleState } from 'app/util/battleMachine';
import type { SlotEntry } from 'app/util/scoreInput';
import type { TallyInput } from 'app/util/tallyModel';

// The card polls the Gamepad API off requestAnimationFrame, which jsdom does
// not run; nothing here presses a button, so a resting seam is enough.
vi.mock('app/hooks/useGamepads', () => ({ useGamepads: () => ({}) }));

/**
 * The daylight type floor (FREESTYLE_BOARD_UX §8 C12, anti-pattern "text
 * <14 px on the live path"): every string the operator reads mid-match renders
 * at least 14 px, in venue sunlight, from a step back.
 *
 * The floor has ONE owner — `liveCaption` — so this asserts the rendered size
 * of one string per surface family that lifted off MUI's 12 px `caption`
 * (handset rail, plate, score status slot) rather than every call site: a
 * regression can only arrive by a call site dropping the token, and each family
 * here would catch its own. Computed px, not a grep: the size that matters is
 * the one that survives the variant it is layered over.
 */
const FLOOR_PX = 14;
/** jsdom reports a `rem` size as written, so the floor is compared in px. */
const ROOT_PX = 16;

const fontSizePx = (el: HTMLElement): number => {
  const size = window.getComputedStyle(el).fontSize;
  return parseFloat(size) * (size.endsWith('rem') ? ROOT_PX : 1);
};

const expectAtFloor = (el: HTMLElement): void =>
  expect(fontSizePx(el)).toBeGreaterThanOrEqual(FLOOR_PX);

const BUDGET = 120_000;

const board = (): Omit<TallyInput, 'now'> => ({
  mode: 'battle',
  battle: initialBattleState(BUDGET, 2),
  trySeries: null,
  names: { 1: 'C. Bianchi', 2: 'R. Lafleur' },
  warmup: { kind: 'idle', remainingMs: 420_000 },
  link: 'open',
  audioBlocked: false,
  peerState: 'alone',
  saves: { 1: { status: 'empty' }, 2: { status: 'empty' } },
});

const ATHLETES: Athlete[] = [
  {
    athleteId: 'a1',
    compId: 'c1',
    name: 'Jane Doe',
    firstName: 'Jane',
    lastName: 'Doe',
    shortName: 'Jane',
    birthDate: '1990-01-01',
    country: 'USA',
    gender: 'female',
  },
];

const emptyFields = { difficulty: 0, combo: 0, style: 0, bestTrick: 0, controlPenalty: 0 };

/** A quali rail whose only player sits in the state under test. */
const renderStatus = (entry: SlotEntry) =>
  render(
    <FreestyleScoreControls
      scoring={
        {
          round: 'qualification',
          athletes: { 1: 'a1', 2: '' },
          entries: { 1: entry, 2: { status: 'empty' } } as Record<AthleteSlot, SlotEntry>,
          records: { 1: null, 2: null },
          setField: vi.fn(),
          setOverride: vi.fn(),
          recordScore: vi.fn(),
          recordDnf: vi.fn(),
          moveScore: vi.fn(),
          movingSlot: null,
          selectedMatchId: '',
          updateMatch: { isError: false, error: null },
          retryMatchUpdate: vi.fn(),
          derivedWinner: null,
        } as unknown as ScoreEntry
      }
      athletes={ATHLETES}
      mode="quali"
    />,
  );

describe('live-path type floor', () => {
  it('owns the floor in one token', () => {
    expect(liveCaption.fontSize).toBeGreaterThanOrEqual(FLOOR_PX);
  });

  it('renders the handset readout at the floor', () => {
    render(
      <GamepadSelectionProvider>
        <HandsetCard
          mode="battle"
          battle={initialBattleState(BUDGET, 2)}
          trySeries={null}
          names={{ 1: 'C. Bianchi', 2: 'R. Lafleur' }}
        />
      </GamepadSelectionProvider>,
    );

    // The colour note and the full button map now live behind the "Open
    // handset map" dialog trigger (progressive disclosure, fsux round 10) —
    // reference material read at leisure, not the always-on live surface this
    // suite pins.
    expectAtFloor(screen.getByTestId('handset-readout'));
  });

  it('renders the plate keycaps at the floor', () => {
    render(
      <TallyPlate board={board()} onAdvance={vi.fn()} noopPress={{ token: 0, reason: null }} />,
    );

    const plate = screen.getByRole('button', { name: /^ADVANCE — / });
    expectAtFloor(within(plate).getByText('SPACE'));
    expectAtFloor(within(plate).getByText(/^HANDSET /));
  });

  // The persistent save state (§4.9) is read across the desk while a lane is
  // still timing, so all four faces of the slot carry the floor.
  it.each([
    { state: 'empty', entry: { status: 'empty' } as SlotEntry, text: 'not entered' },
    {
      state: 'pending',
      entry: {
        status: 'pending',
        fields: emptyFields,
        override: null,
        result: { overall: 0, dnf: false },
      } as SlotEntry,
      text: 'SAVING…',
    },
    {
      state: 'saved',
      entry: {
        status: 'saved',
        fields: emptyFields,
        override: null,
        result: { overall: 26, dnf: false },
        origin: 'live',
      } as SlotEntry,
      text: /^locked — correct it on the$/,
    },
    {
      state: 'error',
      entry: {
        status: 'error',
        fields: emptyFields,
        override: null,
        result: { overall: 26, dnf: false },
        reason: 'offline',
      } as SlotEntry,
      text: 'values kept · timing unaffected',
    },
  ])('renders the $state score status at the floor', ({ entry, text }) => {
    renderStatus(entry);

    expectAtFloor(screen.getByText(text));
  });

  // The health slot's alarm line: read across the desk while a lane is timing,
  // and the one that talks the operator out of the reset reflex.
  it('renders the link detail line at the floor', () => {
    render(
      <ControlStatusHeader
        context={{
          mode: 'Freestyle',
          round: 'Final',
        }}
        health={{
          link: 'lost',
          audioBlocked: false,
        }}
      />,
    );

    expectAtFloor(screen.getByTestId('control-link-detail'));
  });
});
