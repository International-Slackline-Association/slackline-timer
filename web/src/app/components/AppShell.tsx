import { ReactNode } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';

import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SpeedIcon from '@mui/icons-material/Speed';
import TimerIcon from '@mui/icons-material/Timer';

import { COMPETITIONS_LIST_POLL_MS, useCompetitions } from 'app/api/competitions';
import { BrandMark } from 'app/components/BrandMark';
import { useSelectedCompetition } from 'app/state/selectedCompetition';
import { useQueryParams } from 'app/hooks/useQueryParams';
import { AdminBreadcrumbs } from 'app/components/AdminBreadcrumbs';

/**
 * The shared authenticated app shell: a persistent AppBar with the selected
 * competition as a context header, active-highlighted section nav, and
 * Speedline/Freestyle quick-launch. Wraps every non-display route so the admin
 * pages and the timer consoles stop being navigation islands.
 *
 * Display surfaces render full-bleed and carry no chrome: the `/stream/*` OBS
 * overlays and the `/…/preview` projector pages (chroma-key output) — see
 * `isChromeless`. The shell decides per-route rather than threading a flag
 * through the router so the route table stays declarative.
 */

interface NavSection {
  label: string;
  to: string;
  /** Extra path prefixes that should also light this tab up. */
  match?: string[];
}

const NAV_SECTIONS: readonly NavSection[] = [
  { label: 'Competitions', to: '/admin/competitions' },
  { label: 'Athletes', to: '/admin/athletes' },
  { label: 'Times', to: '/admin/times' },
  { label: 'Scores', to: '/admin/scores' },
  { label: 'Matches', to: '/admin/matches' },
  { label: 'Rankings', to: '/admin/rankings' },
  { label: 'Overlays', to: '/admin/overlays' },
];

/** Projector / OBS surfaces that must stay full-bleed (no AppBar). */
export const isChromeless = (pathname: string): boolean =>
  pathname.startsWith('/stream/') ||
  pathname.endsWith('/preview') ||
  // The audience-facing Freestyle athlete display (venue twin of
  // /stream/athletes-freestyle) is a full-bleed venue screen like the previews.
  pathname === '/freestyle/athletes';

/** The nav `to` whose section the current path belongs to, or false (no tab). */
const activeSection = (pathname: string): string | false => {
  const hit = NAV_SECTIONS.find(
    (s) => pathname === s.to || pathname.startsWith(`${s.to}/`) || s.match?.includes(pathname),
  );
  return hit?.to ?? false;
};

/** Whether the current path is a timer console (`/…/control`). */
const isControlRoute = (pathname: string): boolean => pathname.endsWith('/control');

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const { compId } = useSelectedCompetition();
  const { sessionId: urlSessionId } = useQueryParams();
  // Share the /admin/competitions list poll so the picker chip never disagrees
  // with the list on what competitions exist (db_update can't reach it — see
  // COMPETITIONS_LIST_POLL_MS). Mount- and visibility-gated by React Query.
  const competitions = useCompetitions({ refetchInterval: COMPETITIONS_LIST_POLL_MS });

  if (isChromeless(pathname)) {
    return <>{children}</>;
  }

  // localStorage selection stays authoritative; only on a launched console
  // (`/…/control`) with nothing selected do we fall back to the URL sessionId
  // the launcher carried — the same guard the ControlPages use — so the chrome
  // names the live comp and both quick-launchers stay enabled.
  const resolvedCompId =
    compId ?? (isControlRoute(pathname) && urlSessionId !== 'default' ? urlSessionId : undefined);

  const selected = competitions.data?.find((c) => c.compId === resolvedCompId);
  const compLabel = selected?.name ?? resolvedCompId;

  // The timer consoles run against the selected competition as the relay
  // sessionId; the quick-launch links carry it so the operator lands on a live
  // session without re-selecting. They open in a dedicated tab (target=_blank)
  // so launching never tears down a console already running in another tab.
  const launchTo = (mode: 'speedline' | 'freestyle') =>
    resolvedCompId
      ? `/${mode}/control?sessionId=${encodeURIComponent(resolvedCompId)}`
      : `/${mode}/control`;

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          backgroundColor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          {/* Mark + wordmark as one link. The mark is decorative — the wordmark
              beside it is the link's accessible name, and nothing else: as the
              `<h6>` its variant defaults to, the shell opened every page in the
              app one level above the page's own `h1`. */}
          <Stack
            direction="row"
            spacing={1.25}
            component={RouterLink}
            to="/admin/competitions"
            sx={{ alignItems: 'center', textDecoration: 'none' }}
          >
            <BrandMark size={28} />
            <Typography
              component="span"
              variant="h6"
              sx={{ color: 'primary.main', fontWeight: 700 }}
            >
              Slackline Timer
            </Typography>
          </Stack>

          {compLabel ? (
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={compLabel}
              component={RouterLink}
              to="/admin/competitions"
              clickable
              aria-label={`Selected competition: ${compLabel}`}
            />
          ) : (
            <Chip
              size="small"
              variant="outlined"
              label="No competition selected"
              component={RouterLink}
              to="/admin/competitions"
              clickable
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={1}>
            <Tooltip title="Manual">
              <Button
                size="small"
                variant="outlined"
                startIcon={<MenuBookIcon />}
                component={RouterLink}
                to="/help"
              >
                Manual
              </Button>
            </Tooltip>
            <Tooltip title={resolvedCompId ? '' : 'Select a competition first'}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  startIcon={<SpeedIcon />}
                  component={RouterLink}
                  to={launchTo('speedline')}
                  target="_blank"
                  rel="noopener"
                  disabled={!resolvedCompId}
                >
                  Speedline
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={resolvedCompId ? '' : 'Select a competition first'}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  startIcon={<TimerIcon />}
                  component={RouterLink}
                  to={launchTo('freestyle')}
                  target="_blank"
                  rel="noopener"
                  disabled={!resolvedCompId}
                >
                  Freestyle
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Toolbar>

        <Tabs
          value={activeSection(pathname)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ px: 1, borderTop: 1, borderColor: 'divider', minHeight: 40 }}
        >
          {NAV_SECTIONS.map((s) => (
            <Tab
              key={s.to}
              label={s.label}
              value={s.to}
              component={RouterLink}
              to={s.to}
              sx={{ minHeight: 40, py: 0 }}
            />
          ))}
        </Tabs>

        <AdminBreadcrumbs pathname={pathname} />
      </AppBar>

      <Container maxWidth={false} disableGutters>
        {children}
      </Container>
    </Box>
  );
};
