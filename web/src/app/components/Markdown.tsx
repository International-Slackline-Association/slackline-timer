import type { ComponentProps, ReactNode } from 'react';

import {
  Alert,
  Box,
  Divider,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { fonts } from 'app/theme/tokens';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown → MUI renderer for the published manual (`app/manual`). Every element
 * maps onto a themed MUI surface rather than raw HTML, so the manual inherits
 * TELEMETRY typography and palette instead of browser defaults.
 *
 * Kept generic (it takes markdown + a link resolver) rather than manual-specific,
 * but it is deliberately NOT a general-purpose renderer: the input is repo-authored
 * markdown reviewed like source, never user input, which is why raw HTML stays
 * disabled (react-markdown's default) and no sanitizer is wired in.
 */

/** GitHub-compatible heading slug, so `[…](./page.md#some-heading)` resolves. */
const slugify = (children: ReactNode): string =>
  String(children)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const heading =
  (variant: 'h4' | 'h5' | 'h6', sx?: object) =>
  ({ children }: { children?: ReactNode }) => (
    <Typography
      variant={variant}
      id={slugify(children)}
      gutterBottom
      sx={{ mt: variant === 'h4' ? 0 : 4, scrollMarginTop: 140, ...sx }}
    >
      {children}
    </Typography>
  );

export const Markdown = ({
  children,
  resolveHref = (href) => href,
}: {
  children: string;
  /** Maps a markdown link target onto an app route. Identity by default. */
  resolveHref?: (href: string) => string;
}) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      h1: heading('h4'),
      h2: heading('h5'),
      h3: heading('h6'),
      p: ({ children }) => (
        <Typography variant="body1" sx={{ mb: 2, lineHeight: 1.7 }}>
          {children}
        </Typography>
      ),
      a: ({ href = '', children }) => {
        const to = resolveHref(href);
        // Internal targets route client-side; anything else (external doc,
        // in-page anchor) stays a plain anchor.
        return to.startsWith('/') ? (
          <Link component={RouterLink} to={to}>
            {children}
          </Link>
        ) : (
          <Link href={to} target={to.startsWith('#') ? undefined : '_blank'} rel="noopener">
            {children}
          </Link>
        );
      },
      ul: ({ children }) => (
        <Box component="ul" sx={{ pl: 3, mb: 2, '& li': { mb: 0.75 } }}>
          {children}
        </Box>
      ),
      ol: ({ children }) => (
        <Box component="ol" sx={{ pl: 3, mb: 2, '& li': { mb: 0.75 } }}>
          {children}
        </Box>
      ),
      li: ({ children }) => (
        <Typography component="li" variant="body1" sx={{ lineHeight: 1.7 }}>
          {children}
        </Typography>
      ),
      // GFM task-list checkboxes are the manual's pre-event checklists — render
      // them, but never let a reader think their tick is saved anywhere.
      input: (props: ComponentProps<'input'>) => <input {...props} disabled readOnly />,
      blockquote: ({ children }) => (
        <Alert severity="info" variant="outlined" sx={{ mb: 2, '& p:last-child': { mb: 0 } }}>
          {children}
        </Alert>
      ),
      code: ({ children }) => (
        <Box
          component="code"
          sx={{
            fontFamily: fonts.numerals,
            fontSize: '0.9em',
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            backgroundColor: 'action.hover',
          }}
        >
          {children}
        </Box>
      ),
      hr: () => <Divider sx={{ my: 4 }} />,
      // Manual tables are wide (button maps, overlay lists) — scroll the table,
      // never the page.
      table: ({ children }) => (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
          <Table size="small">{children}</Table>
        </TableContainer>
      ),
      thead: ({ children }) => <TableHead>{children}</TableHead>,
      tbody: ({ children }) => <TableBody>{children}</TableBody>,
      tr: ({ children }) => <TableRow>{children}</TableRow>,
      th: ({ children }) => <TableCell sx={{ fontWeight: 700 }}>{children}</TableCell>,
      td: ({ children }) => <TableCell>{children}</TableCell>,
    }}
  >
    {children}
  </ReactMarkdown>
);
