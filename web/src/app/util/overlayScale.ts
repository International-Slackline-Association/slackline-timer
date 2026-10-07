/**
 * Overlay scaling keyed to the 1920×1080 capture frame. OBS captures every
 * `/stream/*` overlay at HD 1920×1080 — exactly the frame the LAAX art metrics
 * are measured on — so widths derive off 1920 (`refVw`) and heights / font sizes
 * off 1080 (`refVh`): a 1080p capture lands pixel-for-pixel on the mock, and
 * every other 16:9 resolution scales cleanly (no hard-pinned canvas). The one
 * overlay scale (ADR 0034 §4).
 *
 * Three decimals keep each emission a plain `vw`/`vh` length that jsdom and
 * `test/util/computedUnits.ts` resolve; a `calc(px * 100vw / 1920)` form would
 * not. The cost is at most one 1/64px layout unit at 1080p (`refVw(16)` =
 * `0.833vw` = 15.994px), below text antialiasing.
 */

/** A reference-pixel width as a viewport-width unit off the 1920px frame. */
export const refVw = (px: number): string => `${((px / 1920) * 100).toFixed(3)}vw`;

/** A reference-pixel height (or font size) as a viewport-height unit off the 1080px frame. */
export const refVh = (px: number): string => `${((px / 1080) * 100).toFixed(3)}vh`;
