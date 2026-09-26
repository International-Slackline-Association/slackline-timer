// Hoist/fly edge colour per nation, keyed by ISO alpha-2. Used only by the
// `WideFlag` FALLBACK path (nations without bespoke card art): the real flag is
// rendered `contain` — whole, undistorted — and the side gaps are painted this
// colour so the letterboxed flag reads full-bleed across the wide band instead
// of sitting in an empty gap. These are flag DATA colours (the sampled edge of
// each national flag), not TELEMETRY design tokens — the same reason the bespoke
// flag SVGs carry their own palette hex.
//
// An unmapped nation defaults to the plate white the band sits on (see WideFlag),
// so a contained flag on the white foot simply reads as a centred flag — never a
// broken gap. Extend as needed.
export const FLAG_EDGE_COLORS: Record<string, string> = {
  mx: '#006847', // Mexico — green hoist
  kr: '#ffffff', // South Korea — white field
  jp: '#ffffff', // Japan — white field
  gb: '#012169', // United Kingdom — blue field
  es: '#aa151b', // Spain — red edge
  nl: '#ae1c28', // Netherlands — red top/edge
  at: '#ed2939', // Austria — red edge
  au: '#00247d', // Australia — blue field
  nz: '#00247d', // New Zealand — blue field
  no: '#ba0c2f', // Norway — red field
  se: '#006aa7', // Sweden — blue field
  fi: '#ffffff', // Finland — white field
  dk: '#c8102e', // Denmark — red field
  pl: '#ffffff', // Poland — white top/edge
  cz: '#11457e', // Czechia — blue hoist wedge
  gr: '#0d5eaf', // Greece — blue edge
  pt: '#046a38', // Portugal — green hoist
  ru: '#ffffff', // Russia — white top/edge
  ua: '#0057b7', // Ukraine — blue top/edge
  ar: '#74acdf', // Argentina — light-blue edge
  co: '#fcd116', // Colombia — yellow top/edge
  za: '#007749', // South Africa — green edge
  in: '#ff9933', // India — saffron top/edge
  tr: '#e30a17', // Turkey — red field
  il: '#ffffff', // Israel — white field
};
