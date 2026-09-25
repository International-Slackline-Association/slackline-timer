// Extract the FULL-RESOLUTION emblem artwork out of the vendored flag-icons
// flags (`src/app/flag-icons/flags/4x3/*.svg`, MIT) into a generated module the
// REBUILT wide flags compose (`flags/wide/rebuilt.ts`). No rasterizing, no
// downsampling — the real vector paths ship, because a nation's crest is its
// identity on air and a redrawn or resampled one is a stand-in.
//
// Only the STRIPES are ours: the wide band stretches them to ~9:1, which the
// emblem must not follow. So we drop the flag's own background and keep
// everything else, then `flags/wide/rebuilt.ts` places the emblem, undistorted,
// on its own stretched band.
//
// The size this costs is the point of the exemption in the `WideFlag` test:
// crest entries are allowed past the 32 KB per-entry guard the simple flags hold
// to (Spain's arms alone is ~540 paths).
//
// Re-generate with `node internals/extractVendorEmblems.mjs` after changing
// EMBLEM_NATIONS or updating the vendored flag-icons set.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const FLAGS_DIR = resolve(here, '../src/app/flag-icons/flags/4x3');
const OUT_FILE = resolve(here, '../src/app/pages/Stream/flags/wide/emblems.ts');

// Nations whose hand-drawn wide flag carries an emblem too fine to redraw
// honestly. Stripe-only flags (Poland, Luxembourg, Colombia) and exact
// constructions (the Czech hoist wedge, the Union Jack) need nothing here.
const EMBLEM_NATIONS = [
  'es', // coat of arms — crown, quartered shield, Pillars of Hercules
  'ar', // Sun of May — the face is what separates it from Uruguay's
];

// flag-icons draws a flag's background as full-width axis-aligned rect paths
// (`M0 0h640v480H0z`, `M0 120h640v240H0z`) before any emblem. That exact shape is
// the classifier — matching on it rather than "the first N elements" keeps this
// honest if the vendored artwork is re-ordered.
const BACKGROUND_PATH = /<path[^>]*\bd="M0 \d+(?:\.\d+)?h640v\d+(?:\.\d+)?H0z"[^>]*\/>\s*/g;

// Alpha above which a rendered pixel counts as emblem (not antialias fringe).
const ALPHA_FLOOR = 8;
// Render scale for the bbox probe. 2x the 640x480 canvas resolves the bbox to
// half a flag unit, far finer than the placement needs.
const PROBE_SCALE = 2;

/** Namespace the vendored ids so two inlined copies can't fight over `#ar-a`. */
function namespaceIds(svg, iso) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  let out = svg;
  for (const id of ids) {
    out = out
      .replaceAll(`id="${id}"`, `id="tl-${iso}-${id}"`)
      .replaceAll(`href="#${id}"`, `href="#tl-${iso}-${id}"`);
  }
  // SVG2 `href` is universally supported and drops the xlink namespace dependency
  // that inlining into another document would otherwise carry.
  return out.replace(/\sxlink:href=/g, ' href=');
}

/** Bounding box of the emblem, found from the rendered alpha channel. */
function emblemBox(body) {
  const probe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">${body}</svg>`;
  const { pixels, width, height } = new Resvg(probe, {
    fitTo: { mode: 'zoom', value: PROBE_SCALE },
  }).render();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (pixels[(py * width + px) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (minX === Infinity) throw new Error('no emblem pixels rendered');
  const round = (v) => Math.round(v * 100) / 100;
  return {
    x: round(minX / PROBE_SCALE),
    y: round(minY / PROBE_SCALE),
    w: round((maxX - minX + 1) / PROBE_SCALE),
    h: round((maxY - minY + 1) / PROBE_SCALE),
  };
}

const entries = EMBLEM_NATIONS.map((iso) => {
  const file = resolve(FLAGS_DIR, `${iso}.svg`);
  const svg = readFileSync(file, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const stripped = inner.replace(BACKGROUND_PATH, '');
  if (stripped === inner) throw new Error(`no background paths matched in ${iso}.svg`);
  const body = namespaceIds(stripped, iso).replace(/\s*\n\s*/g, '');
  const box = emblemBox(body);
  console.error(
    `  ${iso}: ${(inner.match(/<(path|circle|use|g|ellipse|polygon)\b/g) ?? []).length} elements` +
      ` → bbox ${box.x},${box.y} ${box.w}x${box.h} (${(box.w / box.h).toFixed(3)}:1), ${body.length} bytes`,
  );
  return { iso, box, body };
});

const body = entries
  .map(
    ({ iso, box, body: art }) =>
      `  ${iso}: {\n` +
      `    viewBox: '${box.x} ${box.y} ${box.w} ${box.h}',\n` +
      `    aspect: ${Math.round((box.w / box.h) * 1000) / 1000},\n` +
      `    art: ${JSON.stringify(art)},\n` +
      `  },`,
  )
  .join('\n');

const out = `// GENERATED by web/internals/extractVendorEmblems.mjs — do not edit by hand.
// Full-resolution emblem artwork lifted out of the vendored flag-icons flags
// (\`app/flag-icons/flags/4x3/*.svg\`, MIT) with the flag's own background stripes
// removed, so \`./rebuilt.ts\` can stretch its band without stretching the
// emblem. \`viewBox\` is the emblem's tight bounding box in the source flag's
// 640x480 space; \`aspect\` is that box's width/height, so the placement rectangle
// can be sized at the emblem's own proportions and the emblem stays undistorted on
// a ~9:1 band.
//
// Re-generate with \`node internals/extractVendorEmblems.mjs\`.

export const VENDOR_EMBLEMS: Record<string, { viewBox: string; aspect: number; art: string }> = {
${body}
};
`;

writeFileSync(OUT_FILE, out, 'utf8');
console.log(`wrote ${entries.length} emblems (${out.length} bytes) → ${OUT_FILE}`);
