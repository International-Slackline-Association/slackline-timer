import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { useState } from 'react';

import { blurOnClickProps } from 'app/components/RaceButton';
import { useGamepadSelection } from 'app/state/gamepadSelection';
import {
  buzzButton,
  buzzSwatch,
  HANDSET_COLOUR_NOTE,
  isBuzzController,
  type BuzzerMappingRow,
} from 'app/util/buzzer';

interface Props {
  /** Dialog heading, e.g. "Speedline". */
  title: string;
  /** The page's button → action map, listed in the order to display. */
  rows: BuzzerMappingRow[];
  /** Trigger label; the handset card uses a quieter one. */
  triggerLabel?: string;
}

/**
 * A per-control-page reference for the Sony "Buzz!" buzzers, opened from its
 * trigger button. Each control page passes its own `rows`, so the modal always
 * shows the mapping specific to that page (Speedline vs Freestyle). The handset
 * + colour of each row are derived from the button index
 * (`doc/dev/buzzer-hardware.md`).
 *
 * It opens only when asked (owner call, 2026-09-19). It used to pop itself the
 * moment a Buzz! appeared — and a sheet owns the board while it stands, so the
 * one gesture that proves the handsets are alive was also the one that made
 * them inert. The card behind it now carries that proof inline instead.
 *
 * The trigger carries the blur rule (FREESTYLE_BOARD_UX §4.4): Space is the
 * buzzer, and MUI restores focus on close to whatever was focused when the
 * sheet opened — so a trigger that took the opening mouse press would own every
 * press after it.
 */
export const BuzzerMappingDialog = ({ title, rows, triggerLabel = 'Buzzer buttons' }: Props) => {
  const { connectedPads } = useGamepadSelection();
  const buzzConnected = connectedPads.some((p) => isBuzzController(p.id));
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="small"
        variant="text"
        color="inherit"
        startIcon={<SportsEsportsIcon />}
        {...blurOnClickProps<HTMLButtonElement>({ onClick: () => setOpen(true) })}
      >
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="buzzer-mapping-title">
        <DialogTitle id="buzzer-mapping-title">Buzzer buttons — {title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {buzzConnected
              ? 'A Buzz! buzzer is connected. Each handset has one red button and four colours (yellow, green, orange, blue).'
              : 'Use this reference to check the button map before the event; it stays available even before a Buzz! buzzer is connected.'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {HANDSET_COLOUR_NOTE}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Handset</TableCell>
                <TableCell>Button</TableCell>
                <TableCell>Does</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ button, action }) => {
                const { handset, color } = buzzButton(button);
                return (
                  <TableRow key={button}>
                    <TableCell>{handset}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            bgcolor: buzzSwatch[color],
                            border: '1px solid rgba(0,0,0,0.3)',
                            flexShrink: 0,
                          }}
                        />
                        {color}
                      </Box>
                    </TableCell>
                    <TableCell>{action}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} autoFocus>
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
