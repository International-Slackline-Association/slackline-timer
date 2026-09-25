import { type CSSProperties } from 'react';

import { Box, Typography } from '@mui/material';

import { useElementWidth } from 'app/hooks/useElementWidth';
import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { AthleteName } from 'app/pages/Stream/AthleteName';
import { FlagRow } from 'app/pages/Stream/FlagBlock';
import { Plate } from 'app/pages/Stream/Plate';
import { STREAM_INSET_X_PX } from 'app/pages/Stream/StreamLayout';
import { UnknownAthlete } from 'app/pages/Stream/UnknownAthlete';
import { useFitToWidth } from 'app/pages/Stream/useFitToBox';
import type { Athlete, Match } from 'app/types';
import {
  colors,
  fonts,
  overlayArt,
  overlayMarkHalo,
  OVERLAY_TYPE_FLOOR_PX,
} from 'app/theme/tokens';
import { refVh } from 'app/util/overlayScale';
import {
  BRACKET_SLOTS,
  type NameLabel,
  nameTreeLayout,
  profileTreeLayout,
  resolveBracketSlots,
  resolveNameWinners,
} from 'app/util/bracket';

/** A bracket section label at its layout centre. Both tree arts set them in
 *  PlacardNext-Medium → Oswald 500 with the tight art tracking; the profile
 *  art stacks SEMI FINALS on two lines (`\n` in the text) at its 0.95 line
 *  spacing, hence `pre` + centered. */
const SectionLabel = ({ label }: { label: NameLabel }) => (
  <Typography
    data-testid={`bracket-label-${label.text.replace('\n', ' ')}`}
    sx={{
      position: 'absolute',
      left: `${label.xPct}%`,
      top: `${label.yPct}%`,
      transform: `translate(-50%, -50%) rotate(${label.rotate ?? 0}deg)`,
      transformOrigin: 'center',
      fontFamily: fonts.display,
      fontWeight: 500,
      letterSpacing: overlayArt.headingTracking,
      lineHeight: 0.95,
      whiteSpace: 'pre',
      textAlign: 'center',
      fontSize: `${label.sizePct * 100}cqh`,
      color: 'common.white',
    }}
  >
    {label.text}
  </Typography>
);

/** The bracket canvas width when an overlay is captured at 1920x1080: the
 *  title-safe content box, which the 16:9 canvas exactly fills. */
const CAPTURE_CANVAS_W = 1920 - 2 * STREAM_INSET_X_PX;

/**
 * Key the broadcast type floor to the canvas the cards actually render at.
 * `overlayTypeFloor` tracks the VIEWPORT — right for the fixed lower-thirds,
 * wrong here: `/admin/matches` caps its preview canvas at ~1152px (`Container
 * maxWidth="lg"`) at every window width, so a 1080p-tall admin window handed the
 * small cards the full floor and a name-size spread the broadcast never shows.
 * At the capture canvas the ratio is 1, so the on-air render is untouched;
 * unmeasured (no ResizeObserver, pre-layout), the token stands.
 */
const typeFloorStyle = (canvasWidth: number): CSSProperties | undefined =>
  canvasWidth
    ? ({
        '--overlay-type-floor': `${((OVERLAY_TYPE_FLOOR_PX * canvasWidth) / CAPTURE_CANVAS_W).toFixed(2)}px`,
      } as CSSProperties)
    : undefined;

export type BracketVariant = 'profile' | 'name';

/**
 * The playoff8 broadcast bracket in the LAAX reference variants, all drawn in
 * JSX over a transparent overlay (no background art). The master art is the
 * client's and is not in this repo; the surviving measurement record for both
 * trees is `doc/dev/design-system/design-system.md` §7 (the `bracket.ts` layout
 * functions carry the numbers):
 *
 * - **`profile`** (default): the mirrored two-sided photo tree — quarter-final
 *   PORTRAIT boxes on both outer edges, semis inward, a large centered FINALS
 *   box, a SMALL FINALS pair at bottom-center.
 *   Each box is the shared LAAX `AthleteCard` art (B&W portrait, white diagonal
 *   band, bold-first/light-last name, flag-strip foot); vertical `QUARTER
 *   FINALS` labels on both edges.
 * - **`name`**: a single-direction left→right name tree — section labels,
 *   white-bordered translucent name plates, white connector elbows.
 *
 * Either way a fixed 8-athlete single-elimination tree. `transparent` for the
 * OBS overlay; the dark backdrop is for the admin page so the white strokes are
 * visible. The winner box's edge recolors flat `race.go` green at the shared edge
 * width (no widening ring — see `Plate` `flat`); winner TEXT on a white plate
 * takes `race.goDim` instead, which clears contrast there.
 */
export const PlayoffBracket = ({
  matches,
  athleteById,
  transparent = false,
  variant = 'profile',
}: {
  matches: Match[];
  athleteById: (id?: string) => Athlete | undefined;
  transparent?: boolean;
  variant?: BracketVariant;
}) => {
  if (variant === 'name') {
    return <NameBracket matches={matches} athleteById={athleteById} transparent={transparent} />;
  }
  return <ProfileBracket matches={matches} athleteById={athleteById} transparent={transparent} />;
};

/**
 * Mirrored two-sided "profile" bracket: LAAX athlete-card boxes + section labels
 * + white connector elbows drawn in JSX over a transparent canvas. Geometry
 * comes from `profileTreeLayout`; the center box is the champion (winner).
 */
const ProfileBracket = ({
  matches,
  athleteById,
  transparent,
}: {
  matches: Match[];
  athleteById: (id?: string) => Athlete | undefined;
  transparent: boolean;
}) => {
  const { boxes, labels, connectors } = profileTreeLayout();
  const resolved = resolveBracketSlots(matches);
  const bySlotId = new Map(resolved.map((s) => [s.boxId, s]));
  const winners = resolveNameWinners(matches);
  const [canvasRef, canvasWidth] = useElementWidth<HTMLDivElement>();

  const boxData = (boxId: string): { athleteId?: string; isWinner: boolean } => {
    // Green means RESOLVED: the champion box only lights once the final is
    // decided (a green empty TBD box on air would contradict the brief's flat
    // green winner-edges rule). The per-match advancing greens below are already
    // gated by resolveBracketSlots' winnerId check.
    if (boxId === 'winner') return { athleteId: winners.winner, isWinner: winners.winner != null };
    const slot = bySlotId.get(boxId);
    return { athleteId: slot?.athleteId, isWinner: slot?.isWinner ?? false };
  };

  return (
    <Box
      ref={canvasRef}
      data-testid="playoff-bracket"
      style={typeFloorStyle(canvasWidth)}
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        backgroundColor: transparent ? 'transparent' : colors.surface.void,
        color: 'common.white',
        fontFamily: fonts.display,
        containerType: 'size',
      }}
    >
      {/* White connector elbows, behind the boxes. */}
      <Box
        component="svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {connectors.map((points, i) => (
          <polyline
            key={i}
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={colors.overlay.stroke}
            // Device px (non-scaling-stroke) at the shared overlay stroke (6px —
            // 9px clotted the dense bracket boxes, ADR 0029 amend), same weight
            // as the box edges so the tree reads as one line system at 1080p.
            strokeWidth={parseFloat(overlayArt.strokeWidth)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>

      {labels.map((label) => (
        <SectionLabel key={`${label.text}-${label.xPct}`} label={label} />
      ))}

      {boxes.map((box) => {
        const { athleteId, isWinner } = boxData(box.boxId);
        const athlete = athleteById(athleteId);
        return (
          <Box
            key={box.boxId}
            data-testid={`slot-${box.boxId}`}
            sx={{
              position: 'absolute',
              left: `${box.leftPct}%`,
              top: `${box.topPct}%`,
              width: `${box.widthPct}%`,
              height: `${box.heightPct}%`,
            }}
          >
            {/* Every box but the large centre FINALS is too narrow for a full
                first+last name — render the condensed fragment there. Boxes take
                the shared overlay stroke (6px, ADR 0029 amend), not the g2 default. */}
            <AthleteCard
              athlete={athlete}
              isWinner={isWinner}
              narrow={!box.isFinal}
              edgeWidth={overlayArt.strokeWidth}
              // Flat green edge (same width as the white edges), not the VS/winner
              // cards' outset rim — a doubled-width ring read far too heavy on the
              // small quarter/semi boxes and outweighed their white neighbours.
              winnerRing="flat"
            />
          </Box>
        );
      })}
    </Box>
  );
};

/** Name-tree stroke weights measured off the master: the plates' inset border
 *  paths, and the connector elbows one step under them (the art's 4-under-5
 *  hierarchy). Reference px on the 1920×1080 capture frame — `refVh` carries
 *  them to any capture size. See design-system §7 "Name bracket". */
const PLATE_STROKE_PX = 5;
const CONNECTOR_STROKE_PX = 4;

/** Name caps as a share of the plate height — the ranking plates' ratio
 *  (`RankingsOverlay` `plateHeight * 0.55`), so the two filled-plate families
 *  read at one size beside each other on air. */
const NAME_CAP_SIZE = '55cqh';

/**
 * Single-direction "name" bracket: section labels + name plates + connector
 * elbows drawn in JSX over a transparent canvas. No background art — geometry
 * comes from `nameTreeLayout`.
 */
const NameBracket = ({
  matches,
  athleteById,
  transparent,
}: {
  matches: Match[];
  athleteById: (id?: string) => Athlete | undefined;
  transparent: boolean;
}) => {
  const { plates, labels, connectors } = nameTreeLayout();
  const resolved = resolveBracketSlots(matches);
  const bySlotId = new Map(resolved.map((s) => [s.boxId, s]));
  const winners = resolveNameWinners(matches);

  const plateData = (boxId: string): { athleteId?: string; isWinner: boolean } => {
    // Green means RESOLVED: gate the champion ring on a decided final so an
    // empty TBD plate never carries the winner green on air.
    if (boxId === 'winner') return { athleteId: winners.winner, isWinner: winners.winner != null };
    if (boxId === 'small_winner') return { athleteId: winners.small_winner, isWinner: false };
    const slot = bySlotId.get(boxId);
    return { athleteId: slot?.athleteId, isWinner: slot?.isWinner ?? false };
  };

  return (
    <Box
      data-testid="playoff-bracket"
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        backgroundColor: transparent ? 'transparent' : colors.surface.void,
        color: 'common.white',
        fontFamily: fonts.display,
        containerType: 'size',
      }}
    >
      {/* White connector elbows, drawn behind the plates. */}
      <Box
        component="svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {connectors.map((points, i) => (
          <polyline
            key={i}
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={colors.overlay.stroke}
            // Frame-relative like the plate edges, as a CSS stroke-width so the
            // vh unit applies; `non-scaling-stroke` then draws it in device px
            // instead of the canvas's anisotropic viewBox scale. One step under
            // the plates (see `CONNECTOR_STROKE_PX`).
            style={{ strokeWidth: refVh(CONNECTOR_STROKE_PX) }}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>

      {labels.map((label) => (
        <SectionLabel key={`${label.text}-${label.xPct}`} label={label} />
      ))}

      {plates.map((plate) => {
        const { athleteId, isWinner } = plateData(plate.boxId);
        const athlete = athleteById(athleteId);
        // A FILLED plate flips to the solid white fill + dark name ink (the refs'
        // white name bars); an EMPTY (TBD) plate keeps the translucent white fill —
        // the names-language 35% alpha, not the profile boxes' 30% (`plateName`).
        const filled = Boolean(athlete);
        return (
          <Plate
            key={plate.boxId}
            data-testid={`slot-${plate.boxId}`}
            // Filled plate → solid white; empty (TBD) → the 35% name-language fill.
            // The winner carries the flat `race.go` inset ring (the refs show no
            // outer glow, which would fringe/key over the magenta chroma bg).
            fill={filled ? colors.overlay.plateFilled : colors.overlay.plateName}
            strokeWidth={refVh(PLATE_STROKE_PX)}
            winner={isWinner}
            ring="inset"
            sx={{
              position: 'absolute',
              left: `${plate.leftPct}%`,
              top: `${plate.topPct}%`,
              width: `${plate.widthPct}%`,
              height: `${plate.heightPct}%`,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              overflow: 'hidden',
              // Each plate is its OWN size container, so its flag and caps size
              // off the BAR (the ranking plates' rule) rather than off the canvas
              // or a device-px clamp that froze the cap at 24px on any capture.
              containerType: 'size',
            }}
          >
            {athlete ? (
              <NamePlateBody athlete={athlete} isWinner={isWinner} />
            ) : (
              // Undecided slot: the shared question-mark mark, centred in the
              // bar — the same "to be decided" placeholder the profile cards
              // carry, so both bracket variants speak one unknown-athlete
              // language. White (overlay.stroke — the structural-mark colour, as
              // the plate stroke/connectors and the former TBD text), sized to
              // the bar height so the plate column stays uniform.
              <UnknownAthlete
                testId={`slot-unknown-${plate.boxId}`}
                sx={{
                  m: 'auto',
                  height: '64%',
                  color: colors.overlay.stroke,
                  opacity: 0.9,
                  // Broadcast protection halo so the white mark survives bright
                  // footage over the translucent plate (§7).
                  filter: overlayMarkHalo,
                }}
              />
            )}
          </Plate>
        );
      })}
    </Box>
  );
};

/**
 * A filled name plate's contents: the square full-height flag flush to the plate
 * edge and the two-weight name beside it — the populated `RankingsOverlay` plate
 * recipe, so both name-plate families speak one language. The name sizes off the
 * plate box (`NAME_CAP_SIZE`) and SHRINKS to fit it (`useFitToWidth`, one hook
 * per plate — hence a component rather than inline JSX), so a long name scales
 * down whole instead of being clipped mid-letter at the plate edge.
 */
const NamePlateBody = ({ athlete, isWinner }: { athlete: Athlete; isWinner: boolean }) => {
  const { slotRef, nameRef, fit } = useFitToWidth();
  return (
    <>
      <FlagRow
        athlete={athlete}
        testId="name-plate-flag-strip"
        square
        sx={{ height: '100%', flexShrink: 0 }}
        // cqh = the plate's own height, so the block stays square; an explicit
        // width is required because `width:100%` collapses it in a flex row.
        itemSx={{ height: '100%', width: '100cqh', flexShrink: 0 }}
      />
      <Box
        ref={slotRef}
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
          px: '0.4em',
          fontSize: NAME_CAP_SIZE,
        }}
      >
        <Box
          ref={nameRef}
          data-testid="name-plate-fit"
          sx={{
            width: 'max-content',
            maxWidth: 'none',
            transform: `scale(${fit})`,
            transformOrigin: 'left center',
          }}
        >
          <AthleteName
            athlete={athlete}
            // Dark ink on the white plate; the winner's given name takes the
            // DIMMED green (`race.go` is ~2.3:1 on solid white) — the call
            // `AthleteCard` already makes. The plate's inset ring stays
            // `race.go`: it sits on the stroke, not the white fill.
            accent={isWinner ? colors.race.goDim : undefined}
            sx={{ color: colors.overlay.nameInk, letterSpacing: '0.02em', lineHeight: 1 }}
          />
        </Box>
      </Box>
    </>
  );
};

/** Re-export for callers that want the slot list (e.g. tests). */
export { BRACKET_SLOTS };
