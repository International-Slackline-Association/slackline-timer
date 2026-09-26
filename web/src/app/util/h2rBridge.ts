import type { Athlete, Discipline } from 'app/types';

/**
 * The pure field → H2R-variable mapping for the `/stream/bridge` page. The bridge
 * follows the control board's live selection, resolves each side to display
 * fields (name / country / result / signed photoUrl — the same join the SVO
 * overlays do) plus the board's current discipline, and POSTs them into H2R
 * Graphics' local API on `:4001`.
 *
 * H2R is **push-only** (see doc/dev/broadcast-overlays.md): we set its text-variable
 * slots and feed its HTTP-listener data source — H2R never pulls from us. This
 * module is the documented fixed mapping (no server change, no new protocol); a
 * producer points their H2R project's variables/data-source ids at these names.
 */

/** A resolved competitor on one board side, ready to map onto H2R slots. */
export interface BridgeSide {
  athlete: Athlete;
  /** Display result for the board's round (best time / judged overall / DNF), or '' if none. */
  result: string;
}

/** The two board sides, each present or null (empty lane / no selection yet). */
export type BridgeSides = { 1: BridgeSide | null; 2: BridgeSide | null };

/** The H2R slot ids one side maps onto. Operators point their H2R project at these. */
export interface SideSlots {
  /** Text-variable id for the full name. */
  name: string;
  /** Text-variable id for the country code(s). */
  country: string;
  /** Text-variable id for the result (time / overall / DNF). */
  result: string;
  /** HTTP-listener data-source id carrying the portrait. */
  photo: string;
}

/**
 * The default, documented slot ids per side. A producer either renames their H2R
 * variables/data-sources to match, or retunes this map. Side 1/2 mirror the
 * control board's two lanes/players (`updateSelection.athlete{1,2}Id`).
 */
export const H2R_VARIABLE_MAP: Record<1 | 2, SideSlots> = {
  1: { name: 'name_1', country: 'country_1', result: 'result_1', photo: 'photo_1' },
  2: { name: 'name_2', country: 'country_2', result: 'result_2', photo: 'photo_2' },
};

/**
 * The text-variable slot for the board's current discipline (`speed`/`freestyle`).
 * Session-level, not per-side — the board runs one discipline at a time — so it
 * is a single slot rather than part of the per-side map. A producer binds their
 * H2R project's discipline variable (or template switch) to this id.
 */
export const H2R_DISCIPLINE_SLOT = 'discipline';

/** One H2R text-variable POST: `POST :4001/updateVariableText/<id>` with `{ text }`. */
interface TextPost {
  kind: 'text';
  path: string;
  body: { text: string };
}

/** One social-message in the H2R HTTP-listener array; H2R fetches profileImageUrl itself. */
interface H2rDataMessage {
  snippet: { displayMessage: string };
  authorDetails: { displayName: string; profileImageUrl: string };
  platform: { name: string };
}

/** One H2R data-source POST: `POST :4001/data/<id>` with the listener array. */
interface DataPost {
  kind: 'data';
  path: string;
  body: H2rDataMessage[];
}

export type H2rPost = TextPost | DataPost;

const countryText = (athlete: Athlete): string =>
  athlete.country2 ? `${athlete.country} / ${athlete.country2}` : athlete.country;

const text = (slot: string, value: string): TextPost => ({
  kind: 'text',
  path: `/updateVariableText/${slot}`,
  body: { text: value },
});

const photoData = (slot: string, side: BridgeSide | null): DataPost => ({
  kind: 'data',
  path: `/data/${slot}`,
  // Empty array clears the data source; a present photo becomes one listener message.
  body:
    side?.athlete.photoUrl == null
      ? []
      : [
          {
            snippet: { displayMessage: side.athlete.name },
            authorDetails: {
              displayName: side.athlete.name,
              profileImageUrl: side.athlete.photoUrl,
            },
            platform: { name: 'speedline' },
          },
        ],
});

/**
 * Build every H2R POST descriptor for the current board state. **Both** sides are
 * always emitted — an empty side pushes empty values so a stale competitor never
 * lingers on air after the board clears a lane (fail-safe, like the overlays).
 * `discipline` is the board's current discipline (`selection.discipline`), pushed
 * once to `H2R_DISCIPLINE_SLOT`; `null`/undefined (no live selection) clears it,
 * same fail-safe as the side slots. The caller (`h2rClient`) fires these at the
 * operator's `:4001` target.
 */
export const buildH2rPosts = (
  sides: BridgeSides,
  map: Record<1 | 2, SideSlots>,
  discipline?: Discipline | null,
): H2rPost[] => {
  const posts: H2rPost[] = [];
  for (const n of [1, 2] as const) {
    const side = sides[n];
    const slots = map[n];
    posts.push(text(slots.name, side ? side.athlete.name : ''));
    posts.push(text(slots.country, side ? countryText(side.athlete) : ''));
    posts.push(text(slots.result, side?.result ?? ''));
    posts.push(photoData(slots.photo, side));
  }
  posts.push(text(H2R_DISCIPLINE_SLOT, discipline ?? ''));
  return posts;
};
