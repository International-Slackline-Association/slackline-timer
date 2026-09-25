import { Box } from '@mui/system';
import { Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';

import { AudioMutedBadge } from 'app/components/AudioMutedBadge';
import { ConnectingBadge } from 'app/components/ConnectingBadge';
import { ConnectionLostBadge } from 'app/components/ConnectionLostBadge';
import { useAthletes } from 'app/api/athletes';
import { useLinkPhase } from 'app/hooks/useLinkPhase';
import { colors, fonts, radii } from 'app/theme/tokens';
import { applyOverlayBodyStyle } from 'app/pages/Stream/overlayBg';
import { laneName } from 'app/util/raceNames';
import { remainingFrom } from 'app/util/time';
import { Countdown } from './Countdown';
import { BestTrickHero, WarmupHero } from './FreestyleHeroes';
import { useFreestyleTimerFeed, type RecoveredLane } from './useFreestyleTimerFeed';

/** A recovered lane that has spent its whole budget counts as expired — the
 * control board always snapshots lanes 1/2 with their armed budget, so a zeroed,
 * non-running lane can only be one that ran out (feeds Battle Over recovery). A
 * RUNNING row is read off its anchor rather than assumed live: the rows are now
 * refreshed from every live message (`nextRecovery`), so this predicate sees a
 * lane whose window has already elapsed — the same crossing the mounted clock
 * reports through `onExpire` — before the control's stop lands. */
const recoveredExpired = (lane: RecoveredLane | undefined, at: number): boolean => {
  if (!lane) return false;
  return lane.isRunning
    ? remainingFrom(lane.remainingMs, lane.startedAt ?? at, at) <= 0
    : lane.remainingMs <= 0;
};

/**
 * Full-screen, audience-facing Freestyle athlete display (the reference tool's
 * `Quali.html`/`Battle.html`, restyled in TELEMETRY). Mounted behind two thin
 * routes:
 *  - `venue` (/freestyle/athletes, Cognito-gated): a directly-watched venue
 *    screen, so it defaults to the solid TELEMETRY dark ground (surface.void).
 *  - `stream` (/stream/athletes-freestyle, read-token): defaults transparent for
 *    browser-source compositing, like every other /stream/* overlay.
 * `?bg=` overrides either default per the shared convention.
 *
 * The display switches layouts on the board's relayed explicit mode
 * (`LiveSelection.freestyleMode`, ADR 0036 §5): `quali` renders one centred hero
 * (lane 1 — name, viewport-height clock, the advisory break counter);
 * `battle` / absent renders the two stacked lane regions plus a "Battle Over"
 * band once both budgets are spent, and an on-deck arrow (▶) on the clock of
 * the player who goes next during the changeover pause (off the board's
 * relayed `nextUp` hint — ADR 0037).
 * Quali has no idle clock to mark, so the same arrow carries the operator-named
 * next athlete's name under the hero instead (`qualiNextUp`).
 * Still NOT ported: the battle between-turns pause count-UP (judge-facing,
 * control-local, never relayed — ADR 0036). Per-state region backgrounds are also
 * out: a state color only
 * expresses its state (DESIGN_SYSTEM §2) and painted grounds would break the
 * `?bg=` contract.
 *
 * Warm-up is the display's OPENING view, but only once the room has said so: until the first message or snapshot
 * arrives the surface is `unseeded` and renders nothing at all
 * (fsux-preview-warmup-seed). From there the feed holds the warm-up until it
 * finishes or a competition action (lane run / best-trick try) takes over.
 *
 * All data comes from the shared feed (`useFreestyleTimerFeed`) — the same WS
 * consumption behind the broadcast band, so the two surfaces cannot drift.
 */
export const FreestyleAthleteDisplay = ({ variant }: { variant: 'venue' | 'stream' }) => {
  const location = useLocation();
  const {
    sessionId,
    readToken,
    readyState,
    isPreviewEnabled,
    warmupSurface,
    endWarmup,
    laneNames,
    bestTrick,
    freestyleMode,
    nextUp,
    qualiNextUp,
    recovery,
    countdownMessage,
    audioElement,
    playAudio,
    audioBlocked,
  } = useFreestyleTimerFeed();

  const link = useLinkPhase(readyState);

  // The quali next-up athlete arrives as an id (the board relays ids, not
  // names), so resolve it the way `updateLaneNames` resolves the performing
  // one — same rule, same query (React Query dedupes it with the band's).
  const athletes = useAthletes(sessionId, { readToken });
  const qualiNextUpName = laneName(qualiNextUp ?? '', athletes.data ?? []);

  const defaultBg = variant === 'venue' ? colors.surface.void : 'transparent';

  useEffect(() => applyOverlayBodyStyle(location.search, defaultBg), [defaultBg, location.search]);

  // "Battle Over" is derived from the two lanes' expiries — no relayed
  // battle-over message exists. Each lane's Countdown reports its own run-zero
  // via onExpire (the seam the warm-up hero already uses) — the surface's clocks
  // are unmounted in warm-up and best trick, so the rows below are the other
  // half: a recovered snapshot re-derives the band for a late joiner, and the
  // live message refresh re-arms it (a start/reset row is not spent).
  const [laneDone, setLaneDone] = useState<{ 1: boolean; 2: boolean }>({ 1: false, 2: false });

  useEffect(() => {
    if (!recovery[1] && !recovery[2]) {
      return;
    }
    const at = Date.now();
    setLaneDone((d) => {
      const next = { 1: recoveredExpired(recovery[1], at), 2: recoveredExpired(recovery[2], at) };
      return next[1] === d[1] && next[2] === d[2] ? d : next;
    });
  }, [recovery]);

  const isReadyToDisplay = readyState === ReadyState.OPEN && isPreviewEnabled;
  const warmupHero = warmupSurface === 'warmup' && !bestTrick;
  // The lane layouts show only once the session has actually SAID something
  // (fsux-preview-warmup-seed): an unseeded display draws no clock at all
  // rather than a hero fabricated from the defaults — a broadcast surface with
  // the wrong number on it is worse than one with none.
  const laneLayout = warmupSurface === 'lanes' && !bestTrick;
  const battleOver = freestyleMode !== 'quali' && laneDone[1] && laneDone[2];
  // Which lane goes next during the changeover pause, off the board's relayed
  // `nextUp` hint (battle-only, null while a lane runs — ADR 0037). Marks that
  // lane's clock with an on-deck arrow; suppressed once the battle is over (no
  // "next" once both budgets are spent). The arrow only paints when the lane's
  // name is present, so an un-named / not-yet-arrived lane naturally shows none.
  const nextUpLane = battleOver ? null : nextUp;

  const laneExpire = (lane: 1 | 2) => () => {
    playAudio('long');
    setLaneDone((d) => ({ ...d, [lane]: true }));
  };

  return (
    <Box sx={{ height: '100vh', position: 'relative' }}>
      {audioElement}
      <ConnectingBadge link={link} defaultBg={defaultBg} />
      <ConnectionLostBadge link={link} defaultBg={defaultBg} />
      {/* The venue screen's beeps feed the room (like the projector preview); the
          stream twin composites over live video where tab audio is irrelevant. */}
      {variant === 'venue' && <AudioMutedBadge blocked={audioBlocked} />}
      {/* The shared full-screen hero phases: best trick over stale warm-up, both
          over the lane layouts (all are centred, unlike the bottom-anchored
          broadcast band, so at most one surface shows at a time). */}
      {isReadyToDisplay && bestTrick && (
        <BestTrickHero
          isReady={isReadyToDisplay}
          bestTrick={bestTrick}
          laneNames={laneNames}
          countdownMessage={countdownMessage}
          recovery={recovery[3]}
          // Per-channel tone, the same one the control board plays (§4.2).
          onExpire={() => playAudio('short')}
        />
      )}
      {isReadyToDisplay && warmupHero && (
        <WarmupHero
          isReady={isReadyToDisplay}
          countdownMessage={countdownMessage}
          recovery={recovery[0]}
          onExpire={() => {
            playAudio('alert');
            endWarmup();
          }}
        />
      )}
      {laneLayout &&
        (freestyleMode === 'quali' ? (
          // Quali (Quali.html): one athlete at a time — name, one giant clock,
          // the advisory break counter/status via the shared Countdown break UI.
          // A single clock owns the screen (like warm-up), so it takes the
          // `heroSolo` scale — far larger than the two-up battle `hero`; its
          // reserved break rows (name-size) still clear 1080p below the numeral.
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Countdown
              isReady={isReadyToDisplay}
              timerId={1}
              mode="feed"
              message={countdownMessage}
              recovery={recovery[1]}
              name={laneNames.lane1}
              nextUpName={qualiNextUpName || undefined}
              size="heroSolo"
              onExpire={laneExpire(1)}
              onBreakExpire={() => playAudio('alert2')}
              reserveBreakRows
              reserveCaptionRow
            />
          </Box>
        ) : (
          // Battle (Battle.html): two stacked per-player regions. No break UI and
          // no audience pause clock (see the class doc); the on-deck arrow on a
          // lane's clock marks who goes next during the changeover.
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-evenly',
              pointerEvents: 'none',
            }}
          >
            <Countdown
              isReady={isReadyToDisplay}
              timerId={1}
              mode="feed"
              message={countdownMessage}
              recovery={recovery[1]}
              name={laneNames.lane1}
              isNext={nextUpLane === 1}
              size="hero"
              onExpire={laneExpire(1)}
            />
            <Countdown
              isReady={isReadyToDisplay}
              timerId={2}
              mode="feed"
              message={countdownMessage}
              recovery={recovery[2]}
              name={laneNames.lane2}
              isNext={nextUpLane === 2}
              size="hero"
              onExpire={laneExpire(2)}
            />
            {isReadyToDisplay && battleOver && (
              <Typography
                component="div"
                sx={{
                  // OUT of the column's flex flow (battle-marker-layout): as a
                  // third `space-evenly` child the banner re-divided the screen
                  // the instant a battle ended and shoved both hero clocks — the
                  // one moment the audience is reading them. (At 1920x1080 the two
                  // lane regions are 508 px each, so a third child also overflowed
                  // the 1080 px column and squeezed them.) A reserved slot is the
                  // other way out and is worse: it would move the signed-off idle
                  // geometry for the whole match to serve its last two seconds.
                  //
                  // It rests its BOTTOM edge on the seam between the two regions
                  // (`space-evenly` over two equal children puts that seam at
                  // exactly 50%), which is where the free band is: lane 1's plate
                  // has ~40 px of padding below its numeral and lane 2's name
                  // starts at the region's top edge. Hence the smaller type than a
                  // full-width band would carry — it is a badge pinned in a 60 px
                  // seam, and it must not cover a name or a digit.
                  position: 'absolute',
                  left: '50%',
                  bottom: '50%',
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  fontFamily: fonts.display,
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontSize: 'clamp(1rem, 2.4vw, 2.25rem)',
                  // The §2 DNF-badge language scaled up — solid stop fill with
                  // white caps (state as a block, not colored text), matching
                  // the Countdown's on-dark frames: it reads from across a
                  // venue where stop-colored text on slate would not. On a
                  // solid fill the halo is grime (the plate rule) — none.
                  color: colors.ink.onBrand,
                  backgroundColor: colors.race.stop,
                  borderRadius: `${radii.pill}px`,
                  px: '0.6em',
                  lineHeight: 1.3,
                }}
              >
                Battle Over
              </Typography>
            )}
          </Box>
        ))}
    </Box>
  );
};
