import { TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { WheelEvent } from 'react';

import { controlTargets } from 'app/theme/tokens';

/**
 * A wheel over a FOCUSED number input scrubs its value (freestyle-board-ux.md
 * §9): a stray scroll past the rail must not rewrite a judged score or a live
 * budget, so the field lets go of the focus first.
 *
 * Exported because the score rail's judged components are number inputs that
 * are **not** seconds — they carry caps, adornments and an error slot of their
 * own — so they cannot take the field below; they take the rule through it,
 * which is what keeps one wheel rule on the board rather than two copies.
 */
export const blurOnWheel = (event: WheelEvent<HTMLInputElement>): void =>
  event.currentTarget.blur();

/**
 * The board's whole-seconds number field — `Try (s)`, `Run (s)`, `Warm-up (s)`.
 * One component because all three tune a clock the operator is standing next
 * to: each is wheel-hardened, keyed numerically, and held to `controlTargets.live`
 * (MUI's `small` field is 40).
 *
 * It takes and hands back SECONDS and nothing else. `Try (s)` is ms-backed and
 * clamps at 1, the other two are seconds-backed and don't — that conversion is
 * the caller's, and the field must not assume it.
 */
export const SecondsField = ({
  label,
  value,
  onChange,
  disabled,
  helperText,
  sx,
}: {
  label: string;
  value: number;
  /** The typed seconds, unclamped and unconverted. */
  onChange: (seconds: number) => void;
  disabled?: boolean;
  helperText?: string;
  sx?: SxProps<Theme>;
}) => (
  <TextField
    label={label}
    variant="outlined"
    type="number"
    size="small"
    sx={sx}
    value={value}
    disabled={disabled}
    helperText={helperText}
    onChange={(e) => onChange(+e.target.value)}
    slotProps={{
      input: { sx: { minHeight: controlTargets.live } },
      htmlInput: { inputMode: 'numeric', onWheel: blurOnWheel },
    }}
  />
);
