import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import GroupIcon from '@mui/icons-material/Group';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import PersonIcon from '@mui/icons-material/Person';
import SpeakerIcon from '@mui/icons-material/Speaker';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { blurOnClickProps } from 'app/components/RaceButton';
import type { PeerState } from 'app/hooks/useControlSession';
import type { LinkPhase } from 'app/hooks/useLinkPhase';
import { chosenKey, liveCaption } from 'app/theme/tokens';

interface ControlHeaderContext {
  mode: string;
  round: string;
  gender?: string;
  boardMode?: string;
}

interface SoundControl {
  on: boolean;
  onToggle: () => void;
}

interface ControlHeaderHealth {
  link: LinkPhase;
  audioBlocked: boolean;
  peer?: PeerState;
  /** This panel came back on its own browser-local copy (ADR 0047) — a solo
   * board with no peer to answer its mirror-on-open ask. */
  recovered?: boolean;
  sound?: SoundControl;
}

interface ControlHeaderRecording {
  active: boolean;
  detail?: string;
}

interface ControlStatusHeaderProps {
  context: ControlHeaderContext;
  health: ControlHeaderHealth;
  recording?: ControlHeaderRecording;
}

const LINK_DETAIL = 'clocks keep running; the preview is not receiving';
const RECOVERED_DETAIL = 'recovered this panel’s last run';

const LINK_STATUS: Record<
  LinkPhase,
  { label: string; icon: typeof LinkIcon; color: 'success.main' | 'warning.main' | 'error.main' }
> = {
  open: { label: 'Connected', icon: LinkIcon, color: 'success.main' },
  connecting: { label: 'Connecting…', icon: LinkIcon, color: 'warning.main' },
  unreachable: { label: 'Not connected', icon: LinkOffIcon, color: 'error.main' },
  reconnecting: { label: 'Reconnecting…', icon: LinkOffIcon, color: 'warning.main' },
  lost: { label: 'Connection lost', icon: LinkOffIcon, color: 'error.main' },
};

/**
 * The widest link label, in characters. The link plate reserves it so the health
 * row's geometry is a function of the VIEWPORT, not of which reading is showing
 * (§4.12: nothing below the header moves on a status change). At the desk widths
 * the four-cell row sits on its wrap threshold, so without the reserve a longer
 * alarm label ("Connection lost" over "Connecting…") took the few px the
 * `AUDIO LOCKED` plate beside it needed, tipped it into a second line and pushed
 * the whole desk down a row — exactly when the operator is reading an alarm.
 * `ch`, not a pixel width: it tracks the type scale, and the desk grid keeps its
 * relative tracks (the responsive contract).
 */
const LINK_LABEL_CH = Math.max(...Object.values(LINK_STATUS).map(({ label }) => label.length));

const peerLabel = (peer: PeerState): string => {
  if (peer === 'answered') return 'peer: answered';
  if (peer === 'awaiting') return 'peer: awaiting';
  return 'peer: none';
};

const metaPlateSx = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  px: 0.75,
  py: 0.25,
  bgcolor: 'background.paper',
};

const healthPlateSx = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  px: 0.75,
  py: 0.5,
  bgcolor: 'action.hover',
};

const StatusLine = ({
  icon,
  label,
  color = 'text.secondary',
  reserveCh,
}: {
  icon: ReactNode;
  label: string;
  color?: string;
  /** Characters of width the label holds open whatever it currently reads — see
   * `LINK_LABEL_CH`, the only caller that needs it. */
  reserveCh?: number;
}) => (
  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
    <Box component="span" sx={{ display: 'inline-flex', color, lineHeight: 0 }}>
      {icon}
    </Box>
    <Typography
      variant="body2"
      sx={{ color, ...(reserveCh ? { minWidth: `${reserveCh}ch` } : {}) }}
    >
      {label}
    </Typography>
  </Stack>
);

export const ControlStatusHeader = ({ context, health, recording }: ControlStatusHeaderProps) => {
  const linkStatus = LINK_STATUS[health.link];
  const LinkStatusIcon = linkStatus.icon;
  const soundLabel = health.sound?.on ? 'Sound on this panel' : 'Sound off on this panel';
  // The header's one reserved caption line (see its render comment) carries
  // whichever of the two sentences is owed: a link alarm always outranks the
  // recovery notice: the operator reads the recovery off the restored board
  // itself, while nothing else reports a dead link.
  const linkDetail =
    health.link === 'unreachable' || health.link === 'reconnecting' || health.link === 'lost'
      ? LINK_DETAIL
      : health.recovered
        ? RECOVERED_DETAIL
        : '\u00a0';

  return (
    <Stack data-testid="control-status-header" spacing={0.75} sx={{ width: '100%' }}>
      <Box
        sx={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) auto minmax(0,1fr)' },
          alignItems: 'start',
          gap: 1.5,
        }}
      >
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Box sx={metaPlateSx}>
            <Typography
              variant="caption"
              sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              {context.mode}
            </Typography>
          </Box>
          {context.boardMode && (
            <Box sx={{ ...metaPlateSx, ...chosenKey }}>
              <Typography
                variant="caption"
                sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                {context.boardMode}
              </Typography>
            </Box>
          )}
          <Box sx={metaPlateSx}>
            <Typography variant="caption">{context.round}</Typography>
          </Box>
          {context.gender && (
            <Stack direction="row" spacing={0.5} sx={{ ...metaPlateSx, alignItems: 'center' }}>
              <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption">{context.gender}</Typography>
            </Stack>
          )}
        </Stack>

        <Stack
          data-testid="control-recording"
          spacing={0.5}
          sx={{ alignItems: 'center', justifySelf: { xs: 'start', md: 'center' } }}
        >
          {recording && (
            <StatusLine
              icon={
                recording.active ? (
                  <CheckCircleIcon fontSize="small" />
                ) : (
                  <VolumeOffIcon fontSize="small" />
                )
              }
              label={
                recording.active
                  ? 'Recording'
                  : `Not recording${recording.detail ? ` (${recording.detail})` : ''}`
              }
              color={recording.active ? 'success.main' : 'error.main'}
            />
          )}
        </Stack>

        <Stack
          data-testid="control-health"
          spacing={0.5}
          sx={{
            alignItems: { xs: 'flex-start', md: 'flex-end' },
            justifySelf: { xs: 'start', md: 'end' },
          }}
        >
          {/* ONE row at the desk widths (fsux-desk-fold-budget): the health
              block was a 2x2 plate grid over a full-width sound button, ~125 px
              of chrome above the fold on both consoles. Four cells in a row —
              three readings plus the sound toggle, which needs no words to be
              pressed — and the detail caption under them cost ~47 px, and the
              lane transport comes back onto a 900 px screen.

              The single row starts at `lg`, not `md`: the header splits the
              width three ways, so below ~1200 px the four cells share a third of
              a tablet and the loud AUDIO LOCKED wording folds to four lines
              inside its own plate — taller AND messier than two rows of two.
              The desk itself starts at 1280, so `lg` is where the promise is
              owed. The reading tracks shrink (`minmax(0, auto)`) either way, so
              a long phrase wraps inside its plate instead of widening the
              column. */}
          <Box
            data-testid="control-health-grid"
            sx={{
              display: 'grid',
              gap: 0.5,
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(2, minmax(0, auto))',
                lg: 'repeat(3, minmax(0, auto)) auto',
              },
              justifyContent: { xs: 'stretch', md: 'end' },
              alignItems: 'center',
              width: { xs: '100%', md: 'auto' },
            }}
          >
            {/* Named like the detail line under it: the link phase is the one
                reading checked before every run, and it is the reading an
                off-screen probe has to be able to take without also reading the
                audio and peer rows sharing this row. */}
            <Box data-testid="control-link-status" sx={healthPlateSx}>
              <StatusLine
                icon={<LinkStatusIcon fontSize="small" />}
                label={linkStatus.label}
                color={linkStatus.color}
                reserveCh={LINK_LABEL_CH}
              />
            </Box>
            <Box sx={healthPlateSx}>
              <StatusLine
                icon={
                  health.audioBlocked ? (
                    <VolumeOffIcon fontSize="small" />
                  ) : (
                    <VolumeUpIcon fontSize="small" />
                  )
                }
                label={health.audioBlocked ? 'AUDIO LOCKED — click anywhere' : 'Audio armed'}
                color={health.audioBlocked ? 'error.main' : 'text.secondary'}
              />
            </Box>
            {health.peer && (
              <Box sx={healthPlateSx}>
                <StatusLine icon={<GroupIcon fontSize="small" />} label={peerLabel(health.peer)} />
              </Box>
            )}
            {health.sound && (
              // Icon-only, and the state IS the icon (speaker vs muted) — the
              // words move to the accessible name and the Tooltip, so the
              // toggle costs a cell instead of a row. `aria-label` +
              // `aria-pressed` are unchanged: the button reads the same to a
              // screen reader and to the driver as it did with its label.
              <Tooltip title={soundLabel} disableInteractive>
                <Button
                  size="small"
                  variant="outlined"
                  aria-label={soundLabel}
                  aria-pressed={health.sound.on}
                  // Its track is as wide as the reading beside it; the toggle is
                  // an icon and must not stretch to fill one.
                  sx={{ minWidth: 44, minHeight: 32, px: 0.5, justifySelf: 'end' }}
                  {...blurOnClickProps<HTMLButtonElement>({ onClick: health.sound.onToggle })}
                >
                  {health.sound.on ? (
                    <SpeakerIcon fontSize="small" />
                  ) : (
                    <VolumeOffIcon fontSize="small" />
                  )}
                </Button>
              </Tooltip>
            )}
          </Box>
          {/* ONE row, reserved and never exceeded. The row is the fold budget
              the health block won back above, so a sentence too long for the column is
              clipped rather than given a second line — which is what made the
              health slot 59.2 px on one reading and 77.3 px on the next and
              moved the whole desk on a link change (`control-health-slot-height`).
              Clipped, not lost: the full sentence is on the caption itself.

              And it contributes NO intrinsic width (`width: 0` + a percentage
              floor, resolved only once the column is sized): the health Stack
              shrinks to fit, so an alarm sentence longer than the plates above
              it used to widen the column and re-lay the row inside it — the
              slot measured 77.3 px on one sentence and 57.3 px on a longer one
              at 1440x720 (`ftt-followup-speedline-desk-fold-2`). The geometry
              is the viewport's now, never the reading's. */}
          <Typography
            data-testid="control-link-detail"
            variant="caption"
            noWrap
            title={linkDetail.trim() ? linkDetail : undefined}
            sx={{
              ...liveCaption,
              minHeight: '1.2em',
              width: 0,
              minWidth: '100%',
              textAlign: { xs: 'left', md: 'right' },
              color: 'text.secondary',
            }}
          >
            {linkDetail}
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
};

export default ControlStatusHeader;
