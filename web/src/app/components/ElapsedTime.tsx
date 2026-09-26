import { Numeral } from 'app/components/Numeral';
import { formatClock, formatMs } from 'app/util/time';

/**
 * A time value rendered as a `Numeral` — the single presentational home for what
 * were three inline time formatters (ADR 0034 §6). Two faces, one component:
 *
 * - `race` (default) — `formatMs` `M:SS.hh`, DNF-aware (the `DNF_SENTINEL`
 *   renders `DNF`). The live stopwatch never carries the sentinel, so that half
 *   is inert there; it is still the one canonical race face.
 * - `clock` — `formatClock` `mm:ss` / `hh:mm:ss`, negatives clamped to `00:00`.
 *
 * Braid-strict leaf — no `sx`. The `Numeral` typography props (size/color/…) are
 * forwarded so a call site sets the hero clamp/race-state hue without a style
 * escape hatch; layout stays on a wrapping container.
 */
export const ElapsedTime = ({
  ms,
  format = 'race',
  color,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
  textShadow,
  component,
  testId,
}: {
  ms: number | null | undefined;
  format?: 'race' | 'clock';
  color?: string;
  fontSize?: string | number;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: string;
  textShadow?: string;
  component?: React.ElementType;
  testId?: string;
}) => (
  <Numeral
    color={color}
    fontSize={fontSize}
    fontWeight={fontWeight}
    lineHeight={lineHeight}
    letterSpacing={letterSpacing}
    textShadow={textShadow}
    component={component}
    testId={testId}
  >
    {format === 'clock' ? formatClock(ms ?? 0) : formatMs(ms)}
  </Numeral>
);
