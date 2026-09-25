import { Box, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import type { NoopPress } from 'app/hooks/useFreestyleBoard';
import { RaceButton } from 'app/components/RaceButton';
import { colors, fonts, liveCaption, radii } from 'app/theme/tokens';
import { boardLive } from 'app/util/boardState';
import { ADVANCE_BUTTON, buzzButton } from 'app/util/buzzer';
import {
  tallyModel,
  type TallyInput,
  type TallyStateTier,
  type TallyTone,
} from 'app/util/tallyModel';

/** The §6 plate pairs, as palette entries so the theme stays the one place a
 * tier is retuned (each ratio is pinned in `test/app/theme/contrast.test.ts`). */
const FILL: Record<TallyTone, { bgcolor: string; color: string }> = {
  go: { bgcolor: 'success.main', color: 'success.contrastText' },
  stop: { bgcolor: 'error.dark', color: 'error.contrastText' },
  set: { bgcolor: 'warning.main', color: 'warning.contrastText' },
  idle: { bgcolor: 'background.paper', color: 'text.primary' },
};

/**
 * The state channel's colours — the §6 frame-stroke tiers the lane cards draw,
 * so the plate and the card under it say "running" in one language.
 *
 * Running steps to `runningText`, the on-light tier, rather than the base teal
 * the card's frame takes: that stroke is §6's one deliberate sub-3:1 mark,
 * carried there by the RUNNING word inside it, and a 12 px stripe read at 25 %
 * scale has no word inside it to lean on.
 */
export const STATE_STRIPE: Record<TallyStateTier, string> = {
  running: colors.race.runningText,
  break: colors.race.setDim,
  finished: colors.race.stopDim,
  // Nothing is live: the neutral the idle/held frames already take.
  held: colors.ink.mid,
  ready: colors.ink.mid,
  idle: colors.ink.mid,
};

/** Out of the flow, inside the plate's own `px: 2`: one place and one width in
 * every state is what makes the channel readable at a glance. The 2 px `panel`
 * keyline is the tier's ground — the plate paints four fills, and a dark tier
 * laid straight onto the stop fill would vanish exactly while a lane runs
 * (`test/app/theme/contrast.test.ts` pins the tiers against that keyline). */
const STRIPE_SX = {
  position: 'absolute',
  left: '2px',
  top: '12px',
  bottom: '12px',
  width: '12px',
  borderRadius: `${radii.sm}px`,
  boxShadow: `0 0 0 2px ${colors.surface.panel}`,
} as const;

/** The 1 s no-op answer (§3): a press that could do nothing greys the plate
 * while the `alert` tone plays, so the reason is looked at, not just heard. */
const NOOP_FLASH_MS = 1000;

/** What the plate's left half says, as one sentence for the reader. */
const stateReport = (word: string, fact: string, subline: string): string =>
  [word, fact, subline].filter(Boolean).join(' · ');

/** Hidden from the eye, not from the reader (the plate itself is the sighted
 * half). MUI's own `visuallyHidden` lives in `@mui/utils`, a transitive
 * dependency this package does not declare — six properties are cheaper than
 * adopting one for a single call site. */
const REPORT_SX = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

/** The two ADVANCE triggers, named on the plate itself. The handset number is
 * derived from the pad index, never re-typed (rubric C16). */
const KEYCAPS = ['SPACE', `HANDSET ${buzzButton(ADVANCE_BUTTON).handset}`];

const wordSx = {
  fontFamily: fonts.display,
  fontSize: { xs: 18, lg: 14 },
  fontWeight: 600,
  lineHeight: 1.1,
  letterSpacing: '0.06em',
} as const;

/** §6: the verb is the plate's scale — 36–40 px on the ≥1280 px desk. The
 * no-op verb is a sentence, not a word, so it takes the target's scale and a
 * dead end never wraps the plate off its min-height. */
const VERB_SIZE = 'clamp(1.25rem, 1.8vw, 1.75rem)';
const NOOP_VERB_SIZE = 'clamp(0.95rem, 1.4vw, 1.25rem)';
const VERB_LINE_HEIGHT = 1.1;
/** Reserved like every other slot (§4.12): the smaller sentence keeps the live
 * verb's line box, so the sticky plate is the same height in every state and
 * the run deck under it never steps when a run resolves. */
const VERB_SLOT = `calc(${VERB_SIZE} * ${VERB_LINE_HEIGHT})`;

const factSx = {
  fontFamily: fonts.numerals,
  fontVariantNumeric: 'tabular-nums',
  fontSize: { xs: 18, lg: 14 },
  lineHeight: 1.2,
} as const;

/** Reserved slots (§4.12): an absent fact or sub-line keeps its line height, so
 * nothing on the board moves when the state changes under the operator's hand.
 *
 * A `span`, like every other box inside the plate: the plate is one `<button>`
 * (below), and a button may hold phrasing content only. `display: block` keeps
 * the stacked line box a `div` gave it. */
const Line = ({ text, sx, testId }: { text: string; sx: object; testId?: string }) => (
  <Typography component="span" data-testid={testId} sx={{ display: 'block', ...sx }}>
    {text || ' '}
  </Typography>
);

interface Props {
  /** Everything the model reads; the plate stamps the wall clock itself so a
   * ticking fact does not re-render the whole board every second. */
  board: Omit<TallyInput, 'now'>;
  /** `useAdvanceInput`'s guarded press, never a raw dispatch (see below). */
  onAdvance: () => void;
  /** The board's last press that could do nothing — a no-op ADVANCE, or a
   * handset key an interlock blocked (which carries its lock's own words). */
  noopPress: NoopPress;
}

/**
 * The TALLY plate (FREESTYLE_BOARD_UX §2/§4.1) — the loudest object on the
 * Freestyle board and the screen twin of the buzzer.
 *
 * Left: where the board is (a state word plus one live fact). Right: what the
 * next ADVANCE press does (verb + target), rendered from the same
 * `advanceRoute` the press dispatches, so the plate cannot promise an effect
 * the press does not have. Clicking it IS that press: `onAdvance` is the seam's
 * own guarded press (§4.3), so behind an open confirm all three triggers do the
 * confirm's safe action and nothing else.
 */
export const TallyPlate = ({ board, onAdvance, noopPress }: Props) => {
  const [now, setNow] = useState(() => Date.now());
  const live = boardLive({
    mode: board.mode,
    battle: board.battle,
    trySeries: board.trySeries,
    warmupRunning: board.warmup.kind === 'running',
  });

  // Re-stamp on every board change (a fresh anchor must not be read against a
  // second-old clock) and tick only while something is actually counting.
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, board.battle, board.trySeries, board.warmup]);

  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (noopPress.token === 0) return;
    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), NOOP_FLASH_MS);
    return () => clearTimeout(id);
  }, [noopPress]);

  const model = tallyModel({ ...board, now });
  // A blocked key's own words take the sub-line for the second they flash: the
  // reserved slot §4.12 already holds, and the only line on the plate free to
  // answer a press the verb above it is not about (an ADVANCE no-op keeps
  // printing its reason beside the verb, so it needs nothing here).
  const subline = flashing && noopPress.reason !== null ? noopPress.reason : model.subline;
  const fill = flashing
    ? { bgcolor: colors.surface.muted, color: colors.ink.hi }
    : FILL[model.tone];

  // The live fact ticks every second, and a live region that re-announced it
  // would talk over its reader without pause. So the report is stamped when the
  // STATE changes — the word, or the sub-line a blocked key borrows — and
  // carries the fact as it read at that moment.
  const [report, setReport] = useState(() => stateReport(model.word, model.fact, subline));
  useEffect(() => {
    setReport(stateReport(model.word, model.fact, subline));
  }, [model.word, subline]);

  return (
    <Box sx={{ position: 'relative' }}>
      <RaceButton
        size="race"
        onClick={onAdvance}
        // The visible content is a whole state report; the name says what the
        // control DOES, which is the one thing a press needs to know. The
        // report reaches a reader through the status region below instead.
        aria-label={`ADVANCE — ${model.verb}${model.target ? ` ${model.target}` : ''}`}
        data-noop-flash={flashing ? 'on' : undefined}
        sx={{
          display: 'block',
          width: '100%',
          minHeight: { xs: 120, lg: 76 },
          px: 2,
          py: { xs: 1.25, lg: 0.5 },
          textAlign: 'left',
          textTransform: 'none',
          border: '1px solid',
          borderColor: 'divider',
          transition: 'background-color 120ms linear',
          ...fill,
          '&:hover': { ...fill, filter: 'brightness(0.96)' },
        }}
      >
        {/* Hidden from a screen reader: the state word already says this in
            words, and a second announcement only slows the read. */}
        <Box
          component="span"
          aria-hidden
          data-state-tier={model.stateTier}
          sx={{ ...STRIPE_SX, bgcolor: STATE_STRIPE[model.stateTier] }}
        />
        <Stack
          component="span"
          data-testid="plate-content"
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          sx={{
            width: '100%',
            pl: 2,
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <Stack component="span" sx={{ minWidth: 0 }}>
            <Line text={model.word} sx={wordSx} />
            <Line text={model.fact} sx={factSx} />
            <Line
              text={subline}
              testId="plate-subline"
              sx={{ mt: 0.25, fontSize: 12, lineHeight: 1.3 }}
            />
          </Stack>
          <Stack
            component="span"
            sx={{
              minWidth: 0,
              alignItems: { xs: 'flex-start', md: 'flex-end' },
              textAlign: { xs: 'left', md: 'right' },
            }}
          >
            <Stack component="span" direction="row" spacing={0.5} sx={{ mb: 0 }}>
              {KEYCAPS.map((cap) => (
                <Box
                  component="span"
                  key={cap}
                  sx={{
                    px: 0.75,
                    borderRadius: 0.5,
                    bgcolor: 'background.paper',
                    color: 'text.secondary',
                    fontFamily: fonts.display,
                    ...liveCaption,
                    letterSpacing: '0.08em',
                  }}
                >
                  {cap}
                </Box>
              ))}
            </Stack>
            <Typography
              component="span"
              sx={{
                display: 'block',
                fontFamily: fonts.display,
                fontWeight: 700,
                letterSpacing: '0.04em',
                lineHeight: VERB_LINE_HEIGHT,
                fontSize: model.noop ? NOOP_VERB_SIZE : VERB_SIZE,
                minHeight: VERB_SLOT,
              }}
            >
              {model.verb}
            </Typography>
            <Line text={model.target} sx={{ fontSize: 14, lineHeight: 1.2 }} />
          </Stack>
        </Stack>
      </RaceButton>
      {/* Where the board IS, announced. The button's name is the press (§4.1),
          which leaves the report inside it unreadable, and lifting the report
          out of the button would split the buzzer's click twin — so it is said
          beside the target instead, blocked-key words and all. */}
      <Box role="status" sx={REPORT_SX}>
        {report}
      </Box>
    </Box>
  );
};
