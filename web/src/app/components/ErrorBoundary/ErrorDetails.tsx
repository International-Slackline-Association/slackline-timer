import { useState } from 'react';

import { Box, Button, Collapse } from '@mui/material';

import { fonts } from 'app/theme/tokens';

const describe = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);

/** The thrown value behind a "Show details" toggle — collapsed by default so a
 *  crash screen never leads with raw error text. */
export const ErrorDetails = ({ error }: { error: unknown }) => {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Button size="small" color="inherit" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide details' : 'Show details'}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 1,
            p: 1.5,
            maxHeight: '40vh',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: fonts.numerals,
            fontSize: 'caption.fontSize',
            color: 'text.secondary',
            bgcolor: 'action.hover',
            borderRadius: 1,
          }}
        >
          {describe(error)}
        </Box>
      </Collapse>
    </Box>
  );
};
