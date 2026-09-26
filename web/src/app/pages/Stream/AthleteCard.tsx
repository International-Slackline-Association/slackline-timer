import { Box, Stack, Typography } from '@mui/material';

import { Numeral } from 'app/components/Numeral';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { WideFlag } from 'app/pages/Stream/flags/WideFlag';
import { Plate } from 'app/pages/Stream/Plate';
import { UnknownAthlete } from 'app/pages/Stream/UnknownAthlete';
import { useFitToBox } from 'app/pages/Stream/useFitToBox';
import { type Athlete } from 'app/types';
import { colors, fonts, overlayArt, overlayMarkHalo, overlayTypeFloor } from 'app/theme/tokens';

/**
 * The LAAX athlete-card art (`Profiles_W_*.png` is a provenance label for the
 * client-delivered LAAX 2026 masters, not a file in this repo; the surviving
 * measurement record is `doc/dev/design-system/design-system.md` §7 "Athlete
 * card & name strip"), shared by the VS / SVO overlays (via `Competitor`) and
 * the bracket `profile`-variant photo boxes so the broadcast look is identical
 * everywhere:
 *
 * - a **black & white** portrait filling the upper card (`photoUrl` over a
 *   translucent plate, `grayscale` so any colour source reads as the B&W art).
 *   When the athlete has no `photoUrl`, the portrait region flips to a SOLID
 *   OPAQUE initials plate (`overlay.plateFilled`) instead of the translucent
 *   base — otherwise the empty plate keys out to a void on a chroma/transparent
 *   broadcast bg. The `athlete === undefined` (TBD) slot is a separate path;
 * - a **white plate** (`overlay.plateFilled`) under the lower third, its top
 *   edge a shallow **concave-upward arc** (a radial-gradient mask) — deepest at
 *   the centre, rising to the sides — the signature LAAX cut;
 * - the name in condensed caps — **bold given name over a light family name**
 *   (ADR 0016), sized to a near-equal cap-height ratio — in `overlay.nameInk`;
 * - the national **flag** at the very foot: a single nationality fills the full
 *   card width; two nationalities fall back to native-ratio contained blocks.
 *
 * The card fills its container and scales every element in container-query units
 * (`cqh`/`cqw`), so one component serves both the fixed-size `Competitor` frame
 * and the percentage-sized bracket boxes (tiny quarters → large final). The name
 * block lives in its OWN container-query box (the plate's clear region, below the
 * arc and above the flag), so its `cqh` resolves against the plate rather than
 * the whole card — otherwise the type, sized in card-cqh, rides up under the
 * arc and shears long names. Within it, name + result + caption ride ONE
 * measured wrapper that **shrinks to fit** the band in BOTH axes (`useFitToBox`)
 * — a long family name never ellipsizes, and a card carrying a result never
 * yields the name's height to it (the whole stack scales together, so the
 * given/family cap ratio and the numeral stay proportional).
 * The winner edge goes `race.go` green. An optional
 * `result` numeral renders below the name in the monospace face (best time /
 * judged overall).
 *
 * `narrow` is for the tiny profile quarter/semi boxes (`PBOX_W ≈ 5.2%` canvas),
 * where a full uppercase first+last name shears to a single letter + ellipsis.
 * It renders ONE meaningful fragment — the `shortName → lastName → firstName`
 * display fallback (ADR 0016) — on a single bold line instead of the two-weight
 * split, so the on-air text stays legible. The wide VS `Competitor` and the
 * large centre FINALS box keep the full bold-first/light-last treatment.
 */

/** Foot flag-strip height (card %). The masters put the flag band across the
 *  foot from y≈235→251 of the 250-tall card — 6%. The white plate stops above
 *  it and the name block bottoms out at it, so the flag never sits under either. */
const FLAG_STRIP_H = '6%';

/** Thickness of the near-black divider rule the masters draw at y=234.67 (93.9%),
 *  between the white plate foot and the flag band. Proportional (cqh) so it scales
 *  with the card; ~2px on the 250-tall master. */
const DIVIDER_H = '0.8cqh';

/** Concave-upward arc for the plate's top edge (radial-gradient mask): a top-
 *  centred ellipse (rx = half the box → zero cut at the sides) removes a downward
 *  bulge from the plate, so its top edge sits flush at the band top (~54% of the
 *  card, the master's side depth) and sags to ~58% at the centre (ry = 10% of the
 *  40%-tall band). Black/transparent here are the mask stencil (alpha), not
 *  palette colours. */
const ARC_MASK = 'radial-gradient(50% 10% at 50% 0%, transparent 99.5%, black 100%)';

/** The broadcast type floor, read through an override channel rather than off
 *  the token directly: a canvas that does NOT track the viewport (the
 *  `/admin/matches` bracket preview, capped by its Container) declares
 *  `--overlay-type-floor` off its own measured width, so its cards scale
 *  proportionally instead of starting every narrow name at the full viewport
 *  floor. Not a `--tl-*` name — a computed layout value, not a token (ADR 0034
 *  §1) — and the token stays the fallback everywhere else. */
const TYPE_FLOOR = `var(--overlay-type-floor, ${overlayTypeFloor})`;

/** The card's text is dark ink on a white plate, so cancel the StreamLayout
 *  footage drop-shadow — it would read as a dark double-image rather than the
 *  flat plate text the LAAX refs show. */
const PLATE_TEXT_FLAT = { textShadow: 'none' } as const;

export const AthleteCard = ({
  athlete,
  result,
  resultUnit,
  sourceTag,
  isWinner = false,
  winnerTag = false,
  narrow = false,
  edgeWidth = '0.4cqh',
  winnerRing = 'outset',
}: {
  athlete?: Athlete;
  result?: string;
  /** Freestyle top-card only: the points unit microlabel riding the result, so a
   *  bare judged overall reads as points here as it does on the names cut. */
  resultUnit?: string;
  /** Standings-only (rule G3): the round that placed this athlete, rendered as a
   *  subordinate caption under the result so a slower time above a faster one
   *  reads as a bracket outcome — the profile-cut analogue of the names-cut tag. */
  sourceTag?: string;
  isWinner?: boolean;
  /** Paint a "WINNER" word on the green frame. Opt-in (default off) so it fires
   *  only where the frame alone is ambiguous — the VS lower-third. Homes that
   *  already caption the win in their own layout (`WinnerOverlay`'s banner, the
   *  bracket boxes) keep the bare green edge. */
  winnerTag?: boolean;
  narrow?: boolean;
  /** Frame stroke width. Every home passes its own edge off the v2 art (ADR
   *  0029) — the heavier 10px lower-third frame on the VS/winner cards
   *  (`Competitor`), the light 6px shared stroke in the bracket, cqh in the
   *  `AthleteForm` preview — so the proportional default is only a fallback. */
  edgeWidth?: string;
  /** Winner-edge treatment (see `Plate`). Defaults to the `outset` bold rim the
   *  big VS/winner lower-third cards want; the dense bracket boxes pass `flat`
   *  so the champion's green edge never outweighs its white-edged neighbours. */
  winnerRing?: 'outset' | 'flat';
}) => {
  const { slotRef, nameRef, fit } = useFitToBox();
  const initials =
    athlete && !athlete.photoUrl
      ? `${athlete.firstName[0] ?? ''}${athlete.lastName[0] ?? ''}`.toUpperCase()
      : '';
  return (
    <Plate
      fill={colors.overlay.plate}
      strokeWidth={edgeWidth}
      winner={isWinner}
      ring={winnerRing}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        containerType: 'size',
        fontFamily: fonts.display,
      }}
    >
      {/* B&W portrait — fills the card; the name band overlaps its foot. A BOUND
          photoless athlete gets a solid opaque initials plate (not a keyed-out
          hole) so the card still reads as an intentional name/flag plate; an
          unbound (TBD) slot stays transparent so the Plate's translucent
          overlay.plate fill shows through as the reference's empty grey slot. */}
      <Box
        data-testid="athlete-card-photo"
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: athlete && !athlete.photoUrl ? colors.overlay.plateFilled : undefined,
          backgroundImage: athlete?.photoUrl ? `url(${athlete.photoUrl})` : undefined,
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
              letterSpacing: '0.02em',
              lineHeight: 1,
              fontSize: '34cqh',
              ...PLATE_TEXT_FLAT,
            }}
          >
            {initials}
          </Typography>
        )}
        {/* Unbound (TBD) slot: the question-mark placeholder, centred over the
            translucent plate, so an undecided box reads as an intentional "to be
            decided" card rather than an empty keyed-out hole. The white name band,
            flag and divider are all suppressed for this case (see below), so the
            card is just the empty plate + mark — the reference's translucent grey
            slot. White (overlay.stroke language) at the empty-plate alpha. */}
        {!athlete && (
          <UnknownAthlete
            testId="athlete-card-unknown"
            sx={{
              height: '50cqh',
              color: colors.overlay.stroke,
              opacity: 0.65,
              // Broadcast protection halo so the white mark survives bright
              // footage over the translucent plate (§7).
              filter: overlayMarkHalo,
            }}
          />
        )}
      </Box>

      {/* WINNER word on the green frame, in the same green display caps
          WinnerOverlay's banner uses, so the winner reads as won rather than as
          a chroma accident. Keeps the footage drop-shadow (no PLATE_TEXT_FLAT)
          for legibility over the B&W portrait. */}
      {winnerTag && (
        <Typography
          data-testid="athlete-card-winner-tag"
          sx={{
            position: 'absolute',
            top: '-14%',
            left: 0,
            right: 0,
            textAlign: 'center',
            zIndex: 1,
            color: colors.race.go,
            fontFamily: fonts.display,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: '7cqh',
            lineHeight: 1,
          }}
        >
          Winner
        </Typography>
      )}

      {/* White plate with the arc'd LAAX top edge (see ARC_MASK); bottom raised
          by the strip height so it never paints over the flag (FLAG_STRIP_H).
          Suppressed for an unbound (TBD) slot so the card stays the reference's
          bare translucent plate under the question mark, not an empty white bar. */}
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

      {/* Name block, scoped to the band's clear rectangular region (below the
          18% slant, above the flag-strip foot). Its own `containerType:size`
          re-anchors `cqh` to THIS box, so the type sizes against the band — not
          the whole card — and stays clear of the slant and flag at every box
          size (fixed Competitor + percentage bracket boxes alike). */}
      <Stack
        data-testid="athlete-card-name"
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          // Sit below the slant's deepest point; leave the bottom for the flag.
          top: '68%',
          bottom: FLAG_STRIP_H,
          containerType: 'size',
          justifyContent: 'center',
          alignItems: 'center',
          px: '6%',
          overflow: 'hidden',
        }}
      >
        {/* Shrink-to-fit slot. The cqh lines size against the band HEIGHT, so a
            long family name overruns the card width and a result numeral under
            it overruns the band. `flexShrink:0` keeps the slot from yielding its
            height (which sheared the family-name glyphs); the measured node
            holds its NATURAL box — `max-content` width, unshrunk height, so the
            inner `noWrap` lines aren't clipped away from the measurement — and
            one uniform scale fits both axes, cap ratio and numeral intact. */}
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
                    letterSpacing: '0.01em',
                    // ≥1 keeps an uppercase accent inside the line box, off the
                    // overflow:hidden band edge on the tiny quarter box (overlay-
                    // typography-polish).
                    lineHeight: 1.1,
                    // 30cqh resolves against the ~26%-tall name band; the floor
                    // keeps the ~171px quarter box off the ~13px sub-floor,
                    // while larger boxes keep the proportional cqh size.
                    fontSize: `max(30cqh, ${TYPE_FLOOR})`,
                    ...PLATE_TEXT_FLAT,
                  }}
                >
                  {athlete.shortName || athlete.lastName || athlete.firstName}
                </Typography>
              ) : (
                // The bold-first / light-last split lives in AthleteName; the card
                // uses its cqh cap-height default (34 : 27.2cqh = the masters' 1.25
                // ratio) + the winner accent. The opaque white plate keeps flat shadow.
                <AthleteName
                  athlete={athlete}
                  sizing="cqh"
                  accent={isWinner ? colors.race.goDim : undefined}
                />
              ))}
            {result !== undefined && (
              // The gap is `cqh`, never `%`: a percentage vertical margin
              // resolves against the containing block's WIDTH, so on these
              // shrink-wrapped cards it tracked the wrong axis entirely.
              <Stack
                direction="row"
                sx={{ mt: '3cqh', alignItems: 'baseline', columnGap: '0.4em' }}
              >
                <Numeral
                  fontWeight={700}
                  // Floored like the name: on the smallest profile-ranking card the
                  // 22cqh result numeral fell to the ~13px sub-floor.
                  fontSize={`max(22cqh, ${TYPE_FLOOR})`}
                  color={isWinner ? colors.race.goDim : colors.overlay.nameInk}
                  textShadow="none"
                >
                  {result}
                </Numeral>
                {/* Points unit riding the result — the profile-cut analogue of
                    the names cut's subordinate display-caps unit, so a bare
                    judged overall reads as points here too (freestyle only). */}
                {resultUnit !== undefined && (
                  <Box
                    component="span"
                    data-testid="athlete-card-result-unit"
                    sx={{
                      color: isWinner ? colors.race.goDim : colors.overlay.nameInk,
                      fontFamily: fonts.display,
                      fontWeight: 500,
                      letterSpacing: overlayArt.headingTracking,
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      opacity: 0.6,
                      fontSize: `max(11cqh, ${TYPE_FLOOR})`,
                      ...PLATE_TEXT_FLAT,
                    }}
                  >
                    {resultUnit}
                  </Box>
                )}
              </Stack>
            )}
            {/* Placing-round caption under the result — the same subordinate
                display-caps treatment the names cut rides beside its result, so
                the profile board disambiguates a bracket order identically.
                `cqh` gap for the same reason as the result row above. */}
            {sourceTag !== undefined && (
              <Typography
                data-testid="athlete-card-source-tag"
                sx={{
                  mt: '1.5cqh',
                  color: isWinner ? colors.race.goDim : colors.overlay.nameInk,
                  fontFamily: fonts.display,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: overlayArt.headingTracking,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  opacity: 0.6,
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

      {/* The 2px near-black divider rule the masters draw at 93.9%, between the
          white plate foot and the flag band (sits on the flag strip's top edge). */}
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

      {/* National flag across the very foot. `WideFlag` renders the client's own
          card art for the nation (stretched edge-to-edge, no crop) or, for an
          uncovered nation, the flag-icons flag contained on its edge colour. Two
          nationalities abut as two blocks. The white plate backs both, so an
          unknown code still reads as an intentional foot. */}
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
          {/* Hairline keyline framing the flag band. A low-contrast flag whose
              field matches the white plate foot (e.g. Japan's white ground) is
              otherwise indistinguishable from the plate; the near-black frame —
              the same ink as the divider above — gives every flag a crisp edge
              on the foot (overlay-typography-polish). An inset shadow on an
              overlay layer, not a border, so it paints OVER the edge-to-edge art
              without shrinking it. */}
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
