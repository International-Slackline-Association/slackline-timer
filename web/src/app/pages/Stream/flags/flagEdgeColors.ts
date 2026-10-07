// Hoist/fly edge colour per nation (ISO alpha-2) for the `WideFlag` fallback
// path, which paints the letterbox gaps around a `contain`ed flag. Flag DATA
// colours (sampled national edges), not TELEMETRY tokens. An unmapped nation
// gets the plate white (see WideFlag).
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
