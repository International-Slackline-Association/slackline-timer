import { describe, expect, it } from 'vitest';

import { advanceLabel, advanceRoute } from 'app/util/advanceRoute';
import { initialBattleState, type BattleState } from 'app/util/battleMachine';
import { initialTrySeries } from 'app/util/bestTrickSeries';
import { ADVANCE_BUTTON, buzzerRows } from 'app/util/buzzer';
import { agoLabel, handsetOutcome, handsetReadout } from 'app/util/handsetReadout';

const BUDGET_MS = 150_000;
const NAMES = { 1: 'C. Bianchi', 2: 'R. Lafleur' } as const;
const idle = (): BattleState => initialBattleState(BUDGET_MS, 1);

const running = (): BattleState => ({
  ...idle(),
  1: { phase: 'running', budgetMs: BUDGET_MS, armedMs: BUDGET_MS, startedAt: 1000, breaksLeft: 1 },
  lastRan: 1,
});

const bothSpent = (): BattleState => ({
  ...idle(),
  1: { phase: 'finished', armedMs: BUDGET_MS, breaksLeft: 1 },
  2: { phase: 'finished', armedMs: BUDGET_MS, breaksLeft: 1 },
  lastRan: 2,
});

/** The lane-Reset question, as `CountdownControl` registers it — named for the
 * lane that raised it, since the battle board stands one per card. */
const RESET_CONFIRM = { dialog: 'Reset Athlete 1', safeAction: 'Keep timing' };

const ctx = (over: Partial<Parameters<typeof handsetOutcome>[1]> = {}) => ({
  mode: 'battle' as const,
  battle: idle(),
  trySeries: null,
  names: NAMES,
  advanceOverlay: null,
  ...over,
});

/** One press through both halves — the verdict and the line the card renders. */
const press = (button: number, over?: Partial<Parameters<typeof handsetOutcome>[1]>): string =>
  handsetReadout(button, handsetOutcome(button, ctx(over)));

// FREESTYLE_BOARD_UX §4.14: every one of the eleven bindings answers in one
// press, and an inert press answers too — a silent handset and a locked one
// must never look the same (audit S18).
describe('handsetOutcome', () => {
  it('answers all eleven battle bindings on an idle board', () => {
    expect(buzzerRows('battle').map((row) => press(row.button))).toEqual([
      'handset 1 · red → Start Athlete 1',
      'handset 1 · yellow → Reset Athlete 1',
      'handset 1 · green → locked: Athlete 1 is not running',
      'handset 1 · orange → locked: best trick is not armed',
      'handset 1 · blue → locked: Athlete 1 is not running',
      'handset 2 · red → Start Athlete 2',
      'handset 2 · yellow → Reset Athlete 2',
      'handset 2 · green → locked: Athlete 2 is not running',
      'handset 2 · orange → locked: best trick is not armed',
      'handset 2 · blue → locked: Athlete 2 is not running',
      'handset 3 · red → START Athlete 1 · C. Bianchi',
    ]);
  });

  // §4.1: ADVANCE is one press with three triggers, so the key that fires it
  // reports the route it dispatched — the plate's own verb and target — and not
  // the row label the mapping list carries. The card is read AFTER the press,
  // by which time the plate has moved on to promising the next one, so this
  // line is the only record of what the press actually did.
  it.each([
    { state: 'an idle board', battle: idle, trySeries: null },
    { state: 'a running lane', battle: running, trySeries: null },
    { state: 'an armed best-trick series', battle: idle, trySeries: () => initialTrySeries(3) },
  ])(
    'names what an ADVANCE press did, in the route’s own words ($state)',
    ({ battle, trySeries }) => {
      const board = { battle: battle(), trySeries: trySeries?.() ?? null };
      const label = advanceLabel(advanceRoute('battle', board.battle, board.trySeries), NAMES);

      expect(press(ADVANCE_BUTTON, board)).toBe(
        `handset 3 · red → ${label.verb} ${label.target}`.trim(),
      );
    },
  );

  // The dead end (§3's no-op row): the press changed nothing, so the readout
  // may not say it fired — it prints the plate's own sentence, reason included,
  // for the operator who was looking at the handset rather than the board.
  it('logs an ADVANCE with nothing left to do as a dead end, not a step', () => {
    const spent = { battle: bothSpent() };

    expect(handsetOutcome(ADVANCE_BUTTON, ctx(spent)).kind).toBe('noop');
    expect(press(ADVANCE_BUTTON, spent)).toBe(
      'handset 3 · red → NOTHING TO ADVANCE — Begin best trick or Reset a lane',
    );
  });

  // The plate falls back to the bare player number before an athlete is picked
  // (`advanceLabel`), and so does the readout: one label, so the two cannot
  // word the same press differently.
  it('falls back to the player number before an athlete is picked', () => {
    expect(press(ADVANCE_BUTTON, { names: { 1: '', 2: '' } })).toBe(
      'handset 3 · red → START Athlete 1',
    );
  });

  it('names the lock a live run puts on the other player, mid lock-out', () => {
    const board = { battle: running() };
    expect(press(0, board)).toBe('handset 1 · red → locked while Athlete 1 runs');
    expect(press(4, board)).toBe('handset 1 · blue → Stop Athlete 1');
    expect(press(5, board)).toBe('handset 2 · red → locked while Athlete 1 runs');
    expect(press(9, board)).toBe('handset 2 · blue → locked while Athlete 1 runs');
  });

  // The orange key on the ordinary mid-turn battle board: the series is off AND
  // a lane runs, and §4.7's precedence puts the board-wide hold first. Naming
  // the missing series instead would send the operator to a Begin button the
  // same run holds shut — one lock, reported two ways, two presses to learn it.
  it('names the live run before the missing series on the try key', () => {
    expect(press(3, { battle: running() })).toBe(
      'handset 1 · orange → locked while Athlete 1 runs',
    );
    expect(press(8, { battle: running() })).toBe(
      'handset 2 · orange → locked while Athlete 1 runs',
    );
  });

  it('reads the aux key as End turn in battle and Take break in quali', () => {
    const board = { battle: running() };
    expect(press(2, board)).toBe('handset 1 · green → End turn Athlete 1');
    expect(press(2, { ...board, mode: 'quali' as const })).toBe(
      'handset 1 · green → Take break Athlete 1',
    );
  });

  it('says nothing is bound to the keys quali does not render', () => {
    const quali = { mode: 'quali' as const };
    expect(press(3, quali)).toBe('handset 1 · orange → nothing on this board');
    expect(press(5, quali)).toBe('handset 2 · red → nothing on this board');
  });

  // Brief §4.7: an armed series takes the whole run board away, Reset (yellow)
  // included — so eight of the ten player keys answer with the same one line,
  // and the two try keys are all that is left.
  it('logs every player key as locked while best trick is armed, Reset included', () => {
    const armed = { trySeries: initialTrySeries(3) };
    const locked = 'locked during best trick — Leave best trick first';

    expect([0, 1, 2, 4, 5, 6, 7, 9].map((button) => press(button, armed))).toEqual([
      `handset 1 · red → ${locked}`,
      `handset 1 · yellow → ${locked}`,
      `handset 1 · green → ${locked}`,
      `handset 1 · blue → ${locked}`,
      `handset 2 · red → ${locked}`,
      `handset 2 · yellow → ${locked}`,
      `handset 2 · green → ${locked}`,
      `handset 2 · blue → ${locked}`,
    ]);
    expect(press(3, armed)).toBe('handset 1 · orange → Start try Athlete 1');
  });

  it('routes the try key through the series: start a try, then end the open one', () => {
    const armed = initialTrySeries(3);
    expect(press(3, { trySeries: armed })).toBe('handset 1 · orange → Start try Athlete 1');
    expect(
      press(8, {
        trySeries: { ...armed, clock: { running: true, side: 1, startedAt: 1000, tryMs: 30_000 } },
      }),
    ).toBe('handset 2 · orange → End try');
  });

  it('logs an ADVANCE behind a confirm as the answer it gave, not as a step', () => {
    expect(press(ADVANCE_BUTTON, { advanceOverlay: { confirm: RESET_CONFIRM } })).toBe(
      'handset 3 · red → closed the Reset Athlete 1 dialog (Keep timing)',
    );
    expect(press(ADVANCE_BUTTON, { advanceOverlay: { confirm: null } })).toBe(
      'handset 3 · red → locked: a picker is open',
    );
  });

  // Brief §4.8: the question owns the board, and ADVANCE is the only key with
  // an answer for it — every other key is inert while it stands, on a running
  // lane as much as an idle one, and names the question rather than the state
  // it would otherwise have reported.
  it('logs every other key as inert behind an open question', () => {
    const open = { battle: running(), advanceOverlay: { confirm: RESET_CONFIRM } };

    expect([0, 1, 2, 3, 4].map((button) => press(button, open))).toEqual([
      'handset 1 · red → locked: answer the Reset Athlete 1 question first',
      'handset 1 · yellow → locked: answer the Reset Athlete 1 question first',
      'handset 1 · green → locked: answer the Reset Athlete 1 question first',
      'handset 1 · orange → locked: answer the Reset Athlete 1 question first',
      'handset 1 · blue → locked: answer the Reset Athlete 1 question first',
    ]);
    expect(press(0, { battle: running(), advanceOverlay: { confirm: null } })).toBe(
      'handset 1 · red → locked: a picker is open',
    );
  });

  it('says so for a button no page binds', () => {
    expect(press(17)).toBe('handset 4 · green → nothing on this board');
  });
});

describe('agoLabel', () => {
  it('reads seconds, then minutes, unpadded', () => {
    expect(agoLabel(0)).toBe('0:00');
    expect(agoLabel(4_400)).toBe('0:04');
    expect(agoLabel(125_000)).toBe('2:05');
  });
});
