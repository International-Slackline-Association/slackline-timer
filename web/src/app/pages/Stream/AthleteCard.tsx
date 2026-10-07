import { Box, Stack, Typography } from '@mui/material';

import { Numeral } from 'app/components/Numeral';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { WideFlag } from 'app/pages/Stream/flags/WideFlag';
import { Plate } from 'app/pages/Stream/Plate';
import { UnknownAthlete } from 'app/pages/Stream/UnknownAthlete';
import { useFitToBox } from 'app/pages/Stream/useFitToBox';
import { type Athlete } from 'app/types';
import {
  colors,
  fonts,
  OVERLAY_WINNER_GAP_PX,
  OVERLAY_WINNER_WORD_PX,
  overlayArt,
  overlayMarkHalo,
  overlayTypeFloor,
} from 'app/theme/tokens';
import { cssUrl } from 'app/util/cssUrl';
import { refVh } from 'app/util/overlayScale';
import { resultInk } from 'app/util/resultLabel';

/**
 * The LAAX athlete card (measured off the client's `Profiles_W_*.png` masters,
 * not part of this repo; see design-system §7 "Athlete card & name strip"),
 * shared by the VS / SVO / winner overlays (via `Competitor`), the profile
 * rankings and the bracket `profile` boxes:
 *
 * - a **B&W** portrait (`grayscale`) filling the card. A bound athlete with no
 *   `photoUrl` gets a SOLID initials plate — the translucent base would key out
 *   to a void on a chroma/transparent bg. The unbound (TBD) slot is separate;
 * - a **white plate** under the lower third, its top edge a concave-upward arc
 *   (`ARC_MASK`);
 * - the name, **bold given over light family** (ADR 0016), in `overlay.nameInk`;
 * - the national **flag** across the foot (`WideFlag`; two nationalities split
 *   the band).
 *
 * Everything scales in container-query units, so one component serves the fixed
 * `Competitor` frame and the percentage-sized bracket boxes. The name block is
 * its OWN size container (the plate's clear region), so its `cqh` resolves
 * against the plate, not the card — card-cqh type rides up under the arc and
 * shears long names. Name + result + caption shrink to fit that box together in
 * both axes (`useFitToBox`), keeping the cap ratio and numeral proportional.
 * Winner/loser recolour the edge only; the ink stays the plate tier.
 *
 * `narrow` is for the tiny profile quarter/semi boxes, where a full uppercase
 * first+last name shears to one letter: it renders ONE fragment
 * (`shortName → lastName → firstName`, ADR 0016) on a single bold line.
 */

/** Foot flag-strip height (design-system §7). The white plate stops above it and
 *  the name block bottoms out at it, so the flag never sits under either. */
const FLAG_STRIP_H = '6%';

/** The near-black divider rule between the plate foot and the flag band;
 *  card-cqh so it scales with the card. */
const DIVIDER_H = '0.8cqh';

/** Ground between the name block's foot and the divider rule: the fit packs the
 *  stack flush to that foot, so without it the standings caption sits on the rule. */
const NAME_FOOT_CLEARANCE = '1.5cqh';

/** The plate's arc'd top edge: a top-centred ellipse (rx = half the box → zero
 *  cut at the sides, ry = 10% of the 40%-tall band) masked out of the plate.
 *  Black/transparent are the alpha stencil, not palette colours. */
const ARC_MASK = 'radial-gradient(50% 10% at 50% 0%, transparent 99.5%, black 100%)';

/** The broadcast type floor through an override channel: a canvas that does NOT
 *  track the viewport (the `/admin/matches` bracket preview) declares
 *  `--overlay-type-floor` off its own measured width so its cards scale
 *  proportionally. Not a `--tl-*` name — a computed layout value, not a token
 *  (ADR 0034). */
const TYPE_FLOOR = `var(--overlay-type-floor, ${overlayTypeFloor})`;

/** Dark ink on a white plate: cancel the StreamLayout footage drop-shadow, which
 *  reads as a dark double-image here. */
const PLATE_TEXT_FLAT = { textShadow: 'none' } as const;

export const AthleteCard = ({
  athlete,
  result,
  resultUnit,
  resultBorrowed = false,
  sourceTag,
  isWinner = false,
  isLoser = false,
  winnerTag = false,
  narrow = false,
  edgeWidth = '0.4cqh',
  winnerRing = 'outset',
}: {
  athlete?: Athlete;
  result?: string;
  /** Ranking top card only: the unit microlabel (`PTS`/`AVG`) riding a bare-number
   *  result, as it does on the names cut. */
  resultUnit?: string;
  /** Standings-only: the result was borrowed from another round than the one
   *  that placed the athlete (`StandingsEntry.resultSource`), so the numeral
   *  steps down to the subordinate ink — the placing-round caption leads. */
  resultBorrowed?: boolean;
  /** Standings-only (rule G3): the round that placed this athlete, rendered as a
   *  subordinate caption under the result so a slower time above a faster one
   *  reads as a bracket outcome — the profile-cut analogue of the names-cut tag. */
  sourceTag?: string;
  isWinner?: boolean;
  /** Decided-match loser: the frame edge goes `race.stop` (see `Plate`). */
  isLoser?: boolean;
  /** Paint the "WINNER" word above the green frame — the VS lower-third and
   *  `WinnerOverlay`'s banner, which share this one element. It sits outside
   *  the card, so its home reserves the room above (see `WinnerOverlay`).
   *  Opt-in: the bracket boxes keep the bare green edge. */
  winnerTag?: boolean;
  narrow?: boolean;
  /** Frame stroke width. Every home passes its own edge (ADR 0029; values in
   *  design-system §7), so the proportional default is only a fallback. */
  edgeWidth?: string;
  /** Winner-edge treatment (see `Plate`): `outset` for the big lower-third
   *  cards, `flat` for the dense bracket boxes. */
  winnerRing?: 'outset' | 'flat';
}) => {
  const { slotRef, nameRef, fit } = useFitToBox();
  const initials =
    athlete && !athlete.photoUrl
      ? `${athlete.firstName[0] ?? ''}${athlete.lastName[0] ?? ''}`.toUpperCase()
      : '';
  // The tag/unit are words under 24px, so a winner's take the green TEXT tier,
  // not the numeral-only `goDim` the result beside them wears.
  const subordinateInk = isWinner ? colors.race.goText : colors.overlay.nameInkSubordinate;
  return (
    <Plate
      fill={colors.overlay.plate}
      strokeWidth={edgeWidth}
      winner={isWinner}
      loser={isLoser}
      ring={winnerRing}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        containerType: 'size',
        fontFamily: fonts.display,
      }}
    >
      {/* B&W portrait under the name band. An unbound (TBD) slot stays
          transparent so the Plate's translucent fill reads as the reference's
          empty grey slot; a bound photoless athlete gets the solid initials plate. */}
      <Box
        data-testid="athlete-card-photo"
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: athlete && !athlete.photoUrl ? colors.overlay.plateFilled : undefined,
          backgroundImage: cssUrl(athlete?.photoUrl),
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          filter: 'grayscale(1) contrast(1.05)',
        }}
      >
        {initials && (
          <Typography
            sx={{
              // Sit the initials in the photo zone above the name band.
              transform: 'translateY(-22%)',
              color: colors.overlay.nameInk,
              opacity: 0.55,
              textTransform: 'uppercase',
              // Declared, not inherited — a bare Typography takes
              // `theme.typography.body1`'s family over the Plate's (see
              // AthleteName's cqh branch).
              fontFamily: fonts.display,
              fontWeight: 700,
              letterSpacing: overlayArt.nameTracking,
              lineHeight: 1,
              fontSize: '34cqh',
              ...PLATE_TEXT_FLAT,
            }}
          >
            {initials}
          </Typography>
        )}
        {/* Unbound (TBD) slot: the "?" mark over the bare translucent plate —
            band, flag and divider are suppressed below. */}
        {!athlete && (
          <UnknownAthlete
            testId="athlete-card-unknown"
            sx={{
              height: '50cqh',
              color: colors.overlay.stroke,
              opacity: 0.65,
              // Protection halo: the white mark sits on a translucent plate
              // over bright footage (design-system §7).
              filter: overlayMarkHalo,
            }}
          />
        )}
      </Box>

      {/* WINNER word above the green frame, at a frame-relative size (refVh, not
          the card's cqh) so it matches on every home. Anchored off the card's
          OUTER edge: `100%` is the padding box, so the stroke width is added
          back. Keeps the footage drop-shadow (no PLATE_TEXT_FLAT): it sits on
          the footage, not on the white plate. */}
      {winnerTag && (
        <Typography
          data-testid="athlete-card-winner-tag"
          sx={{
            position: 'absolute',
            bottom: `calc(100% + ${edgeWidth} + ${refVh(OVERLAY_WINNER_GAP_PX)})`,
            left: 0,
            right: 0,
            textAlign: 'center',
            zIndex: 1,
            color: colors.race.go,
            fontFamily: fonts.display,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: overlayArt.bannerTracking,
            fontSize: refVh(OVERLAY_WINNER_WORD_PX),
            lineHeight: 1,
          }}
        >
          Winner
        </Typography>
      )}

      {/* White plate (ARC_MASK top edge), raised off the flag strip. */}
      {athlete && (
        <Box
          data-band
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: FLAG_STRIP_H,
            height: '40%',
            backgroundColor: colors.overlay.plateFilled,
            maskImage: ARC_MASK,
            WebkitMaskImage: ARC_MASK,
          }}
        />
      )}

      {/* Name block: the band's clear region below the arc, above the divider
          rule; its own size container re-anchors `cqh` to this box. */}
      <Stack
        data-testid="athlete-card-name"
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          // Below the arc's deepest point; end a clearance above the divider
          // rule, which paints over anything below it.
          top: '68%',
          bottom: `calc(${FLAG_STRIP_H} + ${DIVIDER_H} + ${NAME_FOOT_CLEARANCE})`,
          containerType: 'size',
          justifyContent: 'center',
          alignItems: 'center',
          px: '6%',
          overflow: 'hidden',
        }}
      >
        {/* Shrink-to-fit slot. `flexShrink:0` stops the slot yielding height
            (which shears the family-name glyphs); the measured node holds its
            NATURAL box — `max-content`, unshrunk — so the inner `noWrap` lines
            aren't clipped out of the measurement. */}
        <Box
          ref={slotRef}
          data-testid="athlete-card-name-slot"
          sx={{
            width: '100%',
            height: '100%',
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box
            ref={nameRef}
            data-testid="athlete-card-name-fit"
            sx={{
              width: 'max-content',
              maxWidth: 'none',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transform: `scale(${fit})`,
              transformOrigin: 'center',
            }}
          >
            {athlete &&
              (narrow ? (
                <Typography
                  noWrap
                  sx={{
                    width: '100%',
                    textAlign: 'center',
                    color: isWinner ? colors.race.goDim : colors.overlay.nameInk,
                    textTransform: 'uppercase',
                    fontFamily: fonts.display, // see the initials block above
                    fontWeight: 700,
                    letterSpacing: overlayArt.nameTracking,
                    // ≥1 keeps an uppercase accent inside the line box, off the
                    // overflow:hidden band edge on the tiny quarter box.
                    lineHeight: 1.1,
                    // The floor keeps the ~171px quarter box off a ~13px
                    // sub-floor; larger boxes keep the proportional cqh size.
                    fontSize: `max(30cqh, ${TYPE_FLOOR})`,
                    ...PLATE_TEXT_FLAT,
                  }}
                >
                  {athlete.shortName || athlete.lastName || athlete.firstName}
                </Typography>
              ) : (
                <AthleteName
                  athlete={athlete}
                  sizing="cqh"
                  accent={isWinner ? colors.race.goDim : undefined}
                />
              ))}
            {result !== undefined && (
              // `cqh`, never `%`: a percentage vertical margin resolves against
              // the containing block's WIDTH.
              <Stack
                direction="row"
                sx={{ mt: '3cqh', alignItems: 'baseline', columnGap: '0.4em' }}
              >
                <Numeral
                  fontWeight={700}
                  // Floored like the name, for the smallest profile-ranking card.
                  fontSize={`max(22cqh, ${TYPE_FLOOR})`}
                  color={
                    isWinner
                      ? colors.race.goDim
                      : resultInk(
                          result,
                          resultBorrowed
                            ? colors.overlay.nameInkSubordinate
                            : colors.overlay.nameInk,
                        )
                  }
                  textShadow="none"
                  testId="athlete-card-result"
                >
                  {result}
                </Numeral>
                {/* The names cut's subordinate display-caps unit. */}
                {resultUnit !== undefined && (
                  <Box
                    component="span"
                    data-testid="athlete-card-result-unit"
                    sx={{
                      color: subordinateInk,
                      fontFamily: fonts.display,
                      fontWeight: 500,
                      letterSpacing: overlayArt.headingTracking,
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      fontSize: `max(11cqh, ${TYPE_FLOOR})`,
                      ...PLATE_TEXT_FLAT,
                    }}
                  >
                    {resultUnit}
                  </Box>
                )}
              </Stack>
            )}
            {/* Placing-round caption, in the names cut's subordinate treatment. */}
            {sourceTag !== undefined && (
              <Typography
                data-testid="athlete-card-source-tag"
                sx={{
                  mt: '1.5cqh',
                  color: subordinateInk,
                  fontFamily: fonts.display,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: overlayArt.headingTracking,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  fontSize: `max(13cqh, ${TYPE_FLOOR})`,
                  ...PLATE_TEXT_FLAT,
                }}
              >
                {sourceTag}
              </Typography>
            )}
          </Box>
        </Box>
      </Stack>

      {/* Divider rule on the flag strip's top edge (DIVIDER_H). */}
      {athlete && (
        <Box
          data-testid="athlete-card-divider"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: FLAG_STRIP_H,
            height: DIVIDER_H,
            backgroundColor: colors.overlay.nameInk,
          }}
        />
      )}

      {/* Flag foot (see `WideFlag`). The white backing keeps an unknown code
          an intentional foot. */}
      {athlete && (
        <Box
          data-testid="athlete-card-flag-strip"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: FLAG_STRIP_H,
            backgroundColor: colors.overlay.plateFilled,
            overflow: 'hidden',
          }}
        >
          <WideFlag athlete={athlete} />
          {/* Hairline keyline so a white-field flag (Japan) doesn't merge into the
              plate. An inset shadow on an overlay layer, not a border, so it
              paints OVER the edge-to-edge art without shrinking it. */}
          <Box
            data-testid="athlete-card-flag-keyline"
            sx={{
              position: 'absolute',
              inset: 0,
              boxShadow: `inset 0 0 0 1px ${colors.overlay.nameInk}`,
              pointerEvents: 'none',
            }}
          />
        </Box>
      )}
    </Plate>
  );
};
