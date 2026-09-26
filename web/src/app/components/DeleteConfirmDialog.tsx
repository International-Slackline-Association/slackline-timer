import type { ReactNode } from 'react';

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

import { apiErrorMessage } from 'app/util/apiError';

/**
 * Shared destructive-confirm dialog for the admin CRUD pages. `children` is
 * the "Delete X? This cannot be undone." description; `error` is the delete
 * mutation's error (null while none — e.g. the 409 for a still-referenced
 * athlete), shown inline so the operator can read it without losing the
 * dialog; `pending` locks the button while the request is in flight.
 */
export const DeleteConfirmDialog = ({
  open,
  title,
  error,
  pending,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  error: unknown;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) => (
  <Dialog open={open} onClose={onCancel}>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{children}</DialogContentText>
      {error != null && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {apiErrorMessage(error)}
        </Alert>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel}>Cancel</Button>
      <Box>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={pending}>
          Delete
        </Button>
      </Box>
    </DialogActions>
  </Dialog>
);
