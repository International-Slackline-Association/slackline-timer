import { Alert, Snackbar } from '@mui/material';
import type { Toast } from 'app/hooks/useRaceRecorder';

interface RecorderToastProps {
  open: boolean;
  message: string;
  severity: Toast['severity'];
  onClose: () => void;
}

/**
 * The confirmation snackbar for the timer recording consoles (Speedline
 * results, Freestyle scores). Presentational only — the recorder hook owns the
 * toast state and dismissal. `open` gates the Alert because Snackbar needs a
 * single element child, so a null toast must render nothing rather than an
 * empty Alert.
 *
 * Top-RIGHT, and neutral: the live column runs down the middle of both boards,
 * so a bottom-centre toast covered the clocks and the lane buttons it was
 * reporting on (audit S22, FREESTYLE_BOARD_UX §4.12), and a filled `go`-green
 * plate beside a running lane is a second state light telling a different story
 * (§6 — the race palette is the timer's). The severity survives as the icon and
 * border mark on a panel ground, where it is a mark rather than a fill.
 *
 * 'clickaway' is ignored: the operator's next tap often RAISES the next toast
 * (stop lane 2 → "time saved" → tap Award → "round awarded"), and that same
 * click bubbling to the ClickAwayListener would clear the confirmation it just
 * set. Only the timeout and the Alert's X dismiss.
 */
export const RecorderToast = ({ open, message, severity, onClose }: RecorderToastProps) => (
  <Snackbar
    open={open}
    autoHideDuration={3000}
    onClose={(_event, reason) => {
      if (reason !== 'clickaway') onClose();
    }}
    anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
  >
    {open ? (
      <Alert
        severity={severity}
        onClose={onClose}
        variant="outlined"
        sx={{ bgcolor: 'background.paper', color: 'text.primary', boxShadow: 3 }}
      >
        {message}
      </Alert>
    ) : undefined}
  </Snackbar>
);
