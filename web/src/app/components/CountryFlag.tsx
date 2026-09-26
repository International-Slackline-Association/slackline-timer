import 'app/flag-icons/css/flag-icons.min.css';

import { Typography } from '@mui/material';

import { ALPHA3_TO_ALPHA2 } from './countryAlpha2';
import { IOC_TO_ALPHA2 } from './iocAlpha2';

// flag-icons renders 4:3 flags via a CSS background; size by height and derive
// the matching width so call sites keep passing only `height` as before.
const ASPECT = 4 / 3;

/**
 * Normalizes a country code (alpha-2, IOC, ISO alpha-3 or numeric-3, as stored
 * on athletes) to the lowercase alpha-2 form flag-icons keys on, or null when it
 * matches no known country. IOC codes (GER, SUI, NED, …) take precedence over
 * the ISO map for the three-letter codes where the two disagree.
 */
export const toAlpha2 = (code: string): string | null => {
  const trimmed = code.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^\d+$/.test(trimmed)) return ALPHA3_TO_ALPHA2[trimmed] ?? null;
  const key = trimmed.toUpperCase();
  return IOC_TO_ALPHA2[key] ?? ALPHA3_TO_ALPHA2[key] ?? null;
};

/**
 * Renders a country flag from a country code (alpha-2, IOC, ISO alpha-3 or
 * numeric-3, as stored on athletes). Renders nothing for an empty code; falls
 * back to the raw code text when it matches no known flag.
 *
 * With `showCode`, the code text is rendered once beside the flag (and is the
 * sole output on fallback) — so callers don't print the code a second time.
 *
 * Flags come from the vendored flag-icons artwork in `app/flag-icons` (CSS
 * classes + per-country SVG assets fetched on demand) — each flag is a
 * separately-cached asset, so no single megabyte bundle ships up front.
 */
export const CountryFlag = ({
  code,
  height = 16,
  showCode = false,
}: {
  code?: string;
  /** Flag height. A number is px (width derived at the 4:3 aspect); a CSS length
   *  string (e.g. a `clamp(...)`) lets the flag scale responsively, with the width
   *  taken from `aspect-ratio` — used by the bracket plates so the flag tracks the
   *  overlay-scaled name instead of staying a fixed px badge. */
  height?: number | string;
  showCode?: boolean;
}) => {
  if (!code) return null;
  const alpha2 = toAlpha2(code);
  if (!alpha2) return <Typography component="span">{code}</Typography>;
  const flag = (
    <span
      className={`fi fi-${alpha2}`}
      role="img"
      aria-label={code}
      // Inline style beats the imported `.fi` width rule; a numeric height keeps
      // the explicit px width, a string height derives width from aspect-ratio.
      style={{
        display: 'inline-block',
        height,
        ...(typeof height === 'number'
          ? { width: height * ASPECT }
          : { width: 'auto', aspectRatio: ASPECT }),
      }}
    />
  );
  if (!showCode) return flag;
  return (
    <>
      {flag}
      <Typography component="span">{code}</Typography>
    </>
  );
};
