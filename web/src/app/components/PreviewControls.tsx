import { Link, Stack, Switch, Typography } from '@mui/material';
import { useId } from 'react';

import { blurOnClickProps } from 'app/components/RaceButton';
import { liveCaption } from 'app/theme/tokens';

export interface ProjectorLink {
  href: string;
  label: string;
}

interface Props {
  enabled: boolean;
  onToggle: () => void;
  /** The projector surfaces this console feeds (Freestyle adds the athlete
   * display to the preview). */
  links: readonly ProjectorLink[];
}

/**
 * The preview toggle and its projector links, for both control consoles
 * (FREESTYLE_BOARD_UX §4.4 — `Preview ON · links`). The boards place it
 * differently (the Freestyle setup rail, the Speedline live column) but must
 * not paint it differently: the ON/OFF word, the switch's accessible name and
 * the blur rule are the contract, and Speedline had lost all three writing its
 * own — an unlabelled switch beside an `Enabled`/`Disabled` caption, both
 * keeping the focus of the click that pressed them.
 *
 * Space is the buzzer and a focused control owns it (§4.3), so every press here
 * leaves the keyboard where it found it: a clicked link cannot activate on
 * Space at all, so one kept focus is a silently dead handset.
 */
export const PreviewControls = ({ enabled, onToggle, links }: Props) => {
  // The switch takes its name from the visible word beside it, so the label the
  // operator reads and the one a screen reader speaks cannot drift; the ON/OFF
  // stays the state, which the switch already reports itself.
  const labelId = useId();

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Switch
          checked={enabled}
          onChange={onToggle}
          slotProps={{ input: { 'aria-labelledby': labelId } }}
          {...blurOnClickProps<HTMLElement>()}
        />
        <Typography variant="caption" sx={liveCaption}>
          <span id={labelId}>Preview</span> {enabled ? 'ON' : 'OFF'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {links.map(({ href, label }) => (
          <Link key={href} href={href} target="_blank" {...blurOnClickProps<HTMLAnchorElement>()}>
            {label}
          </Link>
        ))}
      </Stack>
    </Stack>
  );
};
