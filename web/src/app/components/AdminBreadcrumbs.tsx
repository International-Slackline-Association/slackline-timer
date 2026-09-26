import { Breadcrumbs, Link, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { Link as RouterLink } from 'react-router-dom';

/**
 * The breadcrumb trail for the admin section: an "up to Competitions" affordance
 * plus a location label for the current leaf, complementing the shell's section
 * tabs (the sibling nav, which can scroll the active tab out of view).
 *
 * Rendered by `AppShell` for admin routes. Returns `null` at the Competitions
 * root (it is the trail head — no crumb needed).
 */

interface Crumb {
  label: string;
  /** Link target; omitted on the current (leaf) crumb, which renders as plain text. */
  to?: string;
}

const ROOT: Crumb = { label: 'Competitions', to: '/admin/competitions' };

/** Leaf sections that hang off the Competitions root, keyed by their route path. */
const LEAF_LABELS: Readonly<Record<string, string>> = {
  '/admin/athletes': 'Athletes',
  '/admin/times': 'Times',
  '/admin/scores': 'Scores',
  '/admin/matches': 'Matches',
  '/admin/rankings': 'Rankings',
  '/admin/overlays': 'Overlays',
};

export const adminTrail = (pathname: string): Crumb[] | null => {
  if (pathname === '/admin/competitions') return null;
  if (pathname === '/admin/competitions/new') {
    return [ROOT, { label: 'New competition' }];
  }
  const leaf = LEAF_LABELS[pathname];
  if (leaf) return [ROOT, { label: leaf }];
  return null;
};

export const AdminBreadcrumbs = ({ pathname }: { pathname: string }) => {
  const trail = adminTrail(pathname);
  if (!trail) return null;

  return (
    <Breadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      aria-label="breadcrumb"
      sx={{ px: 2, py: 0.5, borderTop: 1, borderColor: 'divider' }}
    >
      {trail.map((crumb) =>
        crumb.to ? (
          <Link
            key={crumb.label}
            component={RouterLink}
            to={crumb.to}
            underline="hover"
            color="inherit"
            variant="body2"
          >
            {crumb.label}
          </Link>
        ) : (
          <Typography key={crumb.label} color="text.primary" variant="body2" aria-current="page">
            {crumb.label}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
};
