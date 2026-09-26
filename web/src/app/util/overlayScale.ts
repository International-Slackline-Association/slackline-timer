/**
 * Overlay scaling keyed to the 1920×1080 capture frame. OBS captures every
 * `/stream/*` overlay at HD 1920×1080 — exactly the frame the LAAX art metrics
 * are measured on — so widths derive off 1920 (`refVw`) and heights / font sizes
 * off 1080 (`refVh`): a 1080p capture lands pixel-for-pixel on the mock, and
 * every other 16:9 resolution scales cleanly (no hard-pinned canvas).
 *
 * The single source for the `refVw`/`refVh` math that was copied verbatim across
 * the overlay files (Competitor, VsOverlay, RankingsOverlay) and that
 * WinnerOverlay/RoundsSummaryOverlay now use in place of fixed `rem`
 * (ADR 0034 §4).
 */

/** A reference-pixel width as a viewport-width unit off the 1920px frame. */
export const refVw = (px: number): string => `${((px / 1920) * 100).toFixed(3)}vw`;

/** A reference-pixel height (or font size) as a viewport-height unit off the 1080px frame. */
export const refVh = (px: number): string => `${((px / 1080) * 100).toFixed(3)}vh`;
