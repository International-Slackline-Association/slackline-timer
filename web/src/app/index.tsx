import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider } from '@mui/material/styles';

import { telemetryTheme } from 'app/theme/theme';
import 'app/theme/tokens.css';

// Every face in the `fonts` token stack is bundled self-hosted — captured
// /stream/* overlays run with external hosts blocked (and a venue network is
// flaky besides), so a CDN face would silently fall back to a wrong-metric
// system font mid-broadcast. Plain `<weight>.css`, not `<subset>-<weight>.css`:
// athlete names carry diacritics and can be non-Latin.
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/oswald/300.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/saira/400.css';
import '@fontsource/saira/500.css';
import '@fontsource/saira/600.css';
import '@fontsource/saira/700.css';
import '@fontsource/saira-condensed/300.css';
import '@fontsource/saira-condensed/500.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import '@fontsource/saira-condensed/800.css';

import { ControlBoundary, OverlayBoundary, withErrorBoundry } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { AuthGate } from './auth/gate';
import { SpeedlineControlPage } from './pages/Speedline/ControlPage';
import { SpeedlinePreviewPage } from './pages/Speedline/PreviewPage';
import { SpeedlineStreamTimer } from './pages/Speedline/StreamTimer';
import { FreestyleControlPage } from './pages/Freestyle/ControlPage';
import { FreestylePreviewPage } from './pages/Freestyle/PreviewPage';
import { FreestyleStreamTimer } from './pages/Freestyle/StreamTimer';
import { FreestyleVenueAthletes } from './pages/Freestyle/VenueAthletes';
import { StreamAthletesFreestyle } from './pages/Stream/StreamAthletesFreestyle';
import { AdminLiveRefresh } from './pages/Admin/AdminLiveRefresh';
import { CompetitionsPage } from './pages/Admin/CompetitionsPage';
import { NewCompetitionPage } from './pages/Admin/NewCompetitionPage';
import { EditCompetitionPage } from './pages/Admin/EditCompetitionPage';
import { CompetitionManagersPage } from './pages/Admin/CompetitionManagersPage';
import { AthletesPage } from './pages/Admin/AthletesPage';
import { TimesPage } from './pages/Admin/TimesPage';
import { RankingsPage } from './pages/Admin/RankingsPage';
import { MatchesPage } from './pages/Admin/MatchesPage';
import { ScoresPage } from './pages/Admin/ScoresPage';
import { OverlaysPage } from './pages/Admin/OverlaysPage';
import { RankingsOverlay } from './pages/Stream/RankingsOverlay';
import { ScoreCardOverlay } from './pages/Stream/ScoreCardOverlay';
import { VsOverlay } from './pages/Stream/VsOverlay';
import { VsLiveOverlay } from './pages/Stream/VsLiveOverlay';
import { WinnerOverlay } from './pages/Stream/WinnerOverlay';
import { RoundsSummaryOverlay } from './pages/Stream/RoundsSummaryOverlay';
import { SvoOverlay } from './pages/Stream/SvoOverlay';
import { SvoLiveOverlay } from './pages/Stream/SvoLiveOverlay';
import { BracketsOverlay } from './pages/Stream/BracketsOverlay';
import { BridgePage } from './pages/Stream/BridgePage';
import { NotFound } from './pages/NotFound';
import { SelectedCompetitionProvider } from './state/selectedCompetition';

// The manual carries the whole markdown corpus plus its renderer; split out of
// the console/overlay bundles so it is fetched only on /help.
const ManualIndexPage = lazy(() =>
  import('./pages/Help/ManualPage').then((m) => ({ default: m.ManualIndexPage })),
);
const ManualArticlePage = lazy(() =>
  import('./pages/Help/ManualPage').then((m) => ({ default: m.ManualArticlePage })),
);
import { GamepadSelectionProvider } from './state/gamepadSelection';

// Live refresh is the server-side db_update WS message (targeted invalidation),
// not focus/poll heuristics — except the competitions list, which polls because
// db_update cannot reach it (see COMPETITIONS_LIST_POLL_MS).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider theme={telemetryTheme}>
          <CssBaseline />
          <GlobalStyles
            styles={{
              body: {
                fontFamily: 'Saira',
                height: '100vh',
                width: '100%',
              },
            }}
          />
          <AuthGate>
            <SelectedCompetitionProvider>
              <GamepadSelectionProvider>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<Navigate to="/admin/competitions" replace />} />
                    <Route element={<ControlBoundary />}>
                      <Route path="/speedline/control" element={<SpeedlineControlPage />} />
                      <Route path="/freestyle/control" element={<FreestyleControlPage />} />
                    </Route>
                    <Route element={<OverlayBoundary />}>
                      <Route path="/speedline/preview" element={<SpeedlinePreviewPage />} />
                      <Route path="/freestyle/preview" element={<FreestylePreviewPage />} />
                      <Route path="/freestyle/athletes" element={<FreestyleVenueAthletes />} />
                    </Route>
                    {/* Pathless layout: db_update live refresh for every admin page. */}
                    <Route element={<AdminLiveRefresh />}>
                      <Route path="/admin/competitions" element={<CompetitionsPage />} />
                      <Route path="/admin/competitions/new" element={<NewCompetitionPage />} />
                      <Route
                        path="/admin/competitions/:compId/edit"
                        element={<EditCompetitionPage />}
                      />
                      <Route
                        path="/admin/competitions/:compId/managers"
                        element={<CompetitionManagersPage />}
                      />
                      {/* Retired /admin/manage hub: redirect so bookmarked/launcher
                          links survive. */}
                      <Route
                        path="/admin/manage"
                        element={<Navigate to="/admin/competitions" replace />}
                      />
                      <Route path="/admin/athletes" element={<AthletesPage />} />
                      <Route path="/admin/times" element={<TimesPage />} />
                      <Route path="/admin/rankings" element={<RankingsPage />} />
                      <Route path="/admin/matches" element={<MatchesPage />} />
                      <Route path="/admin/scores" element={<ScoresPage />} />
                      <Route path="/admin/overlays" element={<OverlaysPage />} />
                    </Route>
                    {/* The published user manual (doc/user/*.md). Inside the
                        AuthGate like every other route; ManualGate adds the
                        "can view a competition" half. */}
                    <Route
                      path="/help"
                      element={
                        <Suspense fallback={null}>
                          <ManualIndexPage />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/help/:slug"
                      element={
                        <Suspense fallback={null}>
                          <ManualArticlePage />
                        </Suspense>
                      }
                    />
                    <Route element={<OverlayBoundary />}>
                      <Route path="/stream/timer" element={<SpeedlineStreamTimer />} />
                      <Route path="/stream/timer-freestyle" element={<FreestyleStreamTimer />} />
                      <Route
                        path="/stream/athletes-freestyle"
                        element={<StreamAthletesFreestyle />}
                      />
                      <Route path="/stream/rankings/:round/:gender" element={<RankingsOverlay />} />
                      <Route
                        path="/stream/scorecard/:round/:gender"
                        element={<ScoreCardOverlay />}
                      />
                      <Route path="/stream/vs/:round/:gender" element={<VsOverlay />} />
                      <Route path="/stream/vs-live/:gender" element={<VsLiveOverlay />} />
                      <Route path="/stream/winner/:round/:gender" element={<WinnerOverlay />} />
                      <Route
                        path="/stream/rounds-summary/:round/:gender"
                        element={<RoundsSummaryOverlay />}
                      />
                      <Route path="/stream/svo/:athleteId" element={<SvoOverlay />} />
                      <Route path="/stream/svo-live/:side" element={<SvoLiveOverlay />} />
                      <Route path="/stream/brackets/:gender" element={<BracketsOverlay />} />
                      <Route path="/stream/bridge" element={<BridgePage />} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppShell>
              </GamepadSelectionProvider>
            </SelectedCompetitionProvider>
          </AuthGate>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default withErrorBoundry(App);
