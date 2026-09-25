// Regenerates src/app/components/countryAlpha2.ts — the ISO 3166-1
// alpha-3/numeric-3 -> lowercase alpha-2 lookup CountryFlag uses to normalize
// athlete country codes into the alpha-2 form flag-icons keys on.
//
// world-countries is a devDependency used ONLY here (build time); the runtime
// bundle ships the small generated map, not the full dataset.
//
//   node scripts/genCountryAlpha2.mjs   (run from web/)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const countries = require('world-countries');

const map = {};
for (const c of countries) {
  const a2 = String(c.cca2 ?? '').toLowerCase();
  if (!a2) continue;
  if (c.cca3) map[String(c.cca3).toUpperCase()] = a2;
  if (c.ccn3) map[String(c.ccn3)] = a2;
}

const keys = Object.keys(map).sort();
// Match Prettier's object-key quoting (the repo lints generated files too):
// quote only keys that aren't valid identifiers — numeric-3 codes like '004' —
// and single-quote the alpha-2 values.
const quoteKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
const lines = [
  '// AUTO-GENERATED — do not edit by hand.',
  '// Maps ISO 3166-1 alpha-3 (uppercased) and numeric-3 codes to lowercase alpha-2,',
  '// the only form flag-icons keys on. Generated from world-countries via',
  '// scripts/genCountryAlpha2.mjs (cca3/ccn3 -> cca2). Regenerate with that script.',
  'export const ALPHA3_TO_ALPHA2: Readonly<Record<string, string>> = {',
  ...keys.map((k) => `  ${quoteKey(k)}: '${map[k]}',`),
  '};',
  '',
].join('\n');

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'app',
  'components',
  'countryAlpha2.ts',
);
writeFileSync(out, lines);
console.log(`wrote ${keys.length} entries to ${out}`);
