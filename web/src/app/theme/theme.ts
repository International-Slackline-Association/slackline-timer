// TELEMETRY MUI theme, driven entirely by the tokens in
// `app/theme/tokens.ts`. Wired into the app in `app/index.tsx`.

import { createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

import { chosenKey, colors, fonts, radii, typeScale } from './tokens';

export const telemetryTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: colors.brand.teal,
      dark: colors.brand.tealDark,
      contrastText: colors.ink.onBrand,
    },
    secondary: {
      main: colors.brand.orange,
      dark: colors.brand.orangeDark,
      contrastText: colors.ink.onBrand,
    },
    // success/warning carry INK on their fill: white on `go` is 2.3:1 and on
    // `set` 2.0:1, so the Recording / Saved / Reconnecting chips were
    // unreadable (FREESTYLE_BOARD_UX §6). Slate clears 4.5:1 on both.
    success: { main: colors.race.go, dark: colors.race.goDim, contrastText: colors.ink.hi },
    warning: { main: colors.race.set, dark: colors.race.setDim, contrastText: colors.ink.hi },
    error: { main: colors.race.stop, dark: colors.race.stopDim, contrastText: colors.ink.onBrand },
    background: {
      default: colors.surface.canvas,
      paper: colors.surface.panel,
    },
    text: {
      primary: colors.ink.hi,
      secondary: colors.ink.mid,
      disabled: colors.ink.faint,
    },
    divider: colors.surface.line,
  },

  shape: {
    borderRadius: radii.md,
  },

  typography: {
    fontFamily: fonts.body,
    h1: {
      fontFamily: fonts.display,
      fontWeight: 700,
      fontSize: `${typeScale.display1}rem`,
      lineHeight: 1.05,
    },
    h2: {
      fontFamily: fonts.display,
      fontWeight: 700,
      fontSize: `${typeScale.display2}rem`,
      lineHeight: 1.1,
    },
    h3: {
      fontFamily: fonts.display,
      fontWeight: 600,
      fontSize: `${typeScale.h1}rem`,
      lineHeight: 1.15,
    },
    h4: {
      fontFamily: fonts.display,
      fontWeight: 600,
      fontSize: `${typeScale.h2}rem`,
      lineHeight: 1.2,
    },
    h5: {
      fontFamily: fonts.display,
      fontWeight: 600,
      fontSize: `${typeScale.h3}rem`,
      lineHeight: 1.25,
    },
    h6: {
      fontFamily: fonts.display,
      fontWeight: 600,
      fontSize: `${typeScale.body}rem`,
      lineHeight: 1.3,
    },
    body1: { fontFamily: fonts.body, fontWeight: 400, fontSize: `${typeScale.body}rem` },
    body2: { fontFamily: fonts.body, fontWeight: 400, fontSize: `${typeScale.small}rem` },
    button: { fontFamily: fonts.body, fontWeight: 600, textTransform: 'none' },
    overline: {
      fontFamily: fonts.body,
      fontWeight: 600,
      fontSize: `${typeScale.label}rem`,
      letterSpacing: typeScale.labelLetterSpacing,
      textTransform: 'uppercase',
      lineHeight: 1.6,
    },
  },

  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: radii.md,
          // §6 "Disabled race control" — one look for locked, whatever tone the
          // control paints live. MUI's own disabled pair is rgba(0,0,0,0.26) on
          // the button's own ground: unreadable at 2.8:1, and an outlined
          // neutral Reset read as live while `laneLocks` held it.
          '&.Mui-disabled': { color: colors.ink.mid, backgroundColor: colors.surface.muted },
        },
        outlined: {
          // The live outlined stroke is `ink.mid`; dropping to `line` is the
          // 4.6:1 step that tells locked from live at a glance. The stroke owes
          // no 3:1 floor of its own (WCAG 1.4.11 exempts inactive components).
          '&.Mui-disabled': { borderColor: colors.surface.line },
        },
      },
      variants: [
        // The brand fill is the DARK teal (§6 "Save contained", 4.61:1):
        // `primary.main` under `contrastText` is 2.9:1, which is what
        // `Set both lanes` and every admin/nav primary shipped while the score
        // rail hand-painted the fix on Save alone. Owned here so a call site
        // never has to remember it. The pair holds through hover — MUI's hover
        // shade IS `primary.dark` — so the press reads as a brightness dip.
        {
          props: { variant: 'contained', color: 'primary' },
          style: {
            backgroundColor: colors.brand.tealDark,
            color: colors.ink.onBrand,
            '&:hover': {
              backgroundColor: colors.brand.tealDark,
              filter: 'brightness(0.94)',
              boxShadow: `0 2px 14px ${alpha(colors.brand.teal, 0.35)}`,
            },
          },
        },
        // The same tier as ink, for the brand's other default surface: a bare
        // `<Button>` is text+primary, which is what the confirms' safe answers
        // (`Keep timing` / `Keep match` / `Keep series`) are — teal at 2.95:1 on
        // the dialog panel they always sit on. `tealDark` clears the floor on a
        // panel and not on the canvas (4.29), so this is the ceiling of what the
        // brand can be as ink; a live-path surface needing more leaves the family.
        {
          props: { variant: 'text', color: 'primary' },
          style: { color: colors.brand.tealDark },
        },
        // An outlined alarm is a WORD in a stroke, not a mark: `error.main`
        // writes it at 3.34:1 on the canvas (DNF, FS Lane n). The stop tier
        // carries the same hue at 5.01:1 (§6).
        {
          props: { variant: 'outlined', color: 'error' },
          style: { color: colors.race.stopDim, borderColor: colors.race.stopDim },
        },
      ],
    },

    // The same rule for the alarm chips (§6): a filled one takes the `stopDim`
    // ground its contained siblings do — `error.main` under white is 3.59:1,
    // which left `Not recording` washed out beside the darkened `Recording`
    // chip it shares the header row with — and an outlined one takes its state's
    // text tier rather than the fill hue (`warning.main` as ink is 1.94:1).
    MuiChip: {
      variants: [
        // The brand chip takes the contained button's tier for the contained
        // button's reason: the header's mode mark is `primary.main` under white,
        // 2.95:1. Only the FILL moves — there is deliberately no outlined-primary
        // row, since teal as ink tops out under the floor on the canvas (see the
        // text variant above), which is why the board-format chip left the
        // family for `chosenKey` rather than darkening inside it.
        {
          props: { color: 'primary', variant: 'filled' },
          style: { backgroundColor: colors.brand.tealDark },
        },
        {
          props: { color: 'error', variant: 'filled' },
          style: { backgroundColor: colors.race.stopDim },
        },
        {
          props: { color: 'error', variant: 'outlined' },
          style: { color: colors.race.stopDim, borderColor: colors.race.stopDim },
        },
        {
          props: { color: 'warning', variant: 'outlined' },
          style: { color: colors.race.setText, borderColor: colors.race.setText },
        },
      ],
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: colors.surface.panel,
          backgroundImage: 'none',
          border: `1px solid ${colors.surface.line}`,
          // Soft lift to separate white panels from the off-white canvas.
          boxShadow: `0 1px 2px ${alpha(colors.surface.void, 0.06)}, 0 2px 12px ${alpha(
            colors.surface.void,
            0.05,
          )}`,
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colors.surface.panel,
          backgroundImage: 'none',
          border: `1px solid ${colors.surface.line}`,
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${colors.surface.line}`,
        },
        head: {
          textTransform: 'uppercase',
          fontWeight: 600,
          fontSize: `${typeScale.label}rem`,
          letterSpacing: typeScale.labelLetterSpacing,
          color: colors.ink.mid,
        },
      },
    },

    // §6's locked pair, on the control families MUI would otherwise paint from
    // its own disabled defaults — `action.disabled` is 1.8:1 on a panel and
    // `text.disabled` 1.6:1 on the muted well. Both spend most of a heat locked
    // (the mode toggle while the board holds state, the budget fields while a
    // lane runs), which is the state §2 wants read: "lock grey in place".
    MuiToggleButton: {
      styleOverrides: {
        root: {
          '&.Mui-disabled': {
            color: colors.ink.mid,
            backgroundColor: colors.surface.muted,
            borderColor: colors.surface.line,
          },
          // Which mode is live is the one mark a lock may not take, so it is
          // the same one in both states — `chosenKey` rather than MUI's teal.
          // The compound selector outranks the sibling `.Mui-disabled` above
          // for the pair, and loses to it for the recessive stroke: locked
          // reads on the unchosen key's well and on the step between strokes.
          '&.Mui-selected, &.Mui-selected.Mui-disabled': chosenKey,
          '&.Mui-selected:hover': {
            backgroundColor: colors.surface.lineStrong,
            filter: 'brightness(0.96)',
          },
        },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: colors.surface.muted,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.surface.line,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.surface.lineStrong,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.brand.teal,
            boxShadow: `0 0 0 2px ${alpha(colors.brand.teal, 0.22)}`,
          },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.surface.line,
          },
        },
        // A locked budget is read back mid-run, so it owes the 4.5:1 floor like
        // any live value. MUI paints a disabled one twice and Safari takes the
        // WebKit fill, not `color`, so a half-override still ships the faint one.
        input: {
          '&.Mui-disabled': {
            color: colors.ink.mid,
            WebkitTextFillColor: colors.ink.mid,
          },
        },
      },
    },

    // A locked field's label and why-line stay at §6's sub-line tier.
    MuiInputLabel: {
      styleOverrides: {
        root: { '&.Mui-disabled': { color: colors.ink.mid } },
      },
    },

    MuiFormHelperText: {
      styleOverrides: {
        root: { '&.Mui-disabled': { color: colors.ink.mid } },
      },
    },

    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
  },
});
