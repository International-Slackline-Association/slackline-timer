/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, Match, MatchRound, RankedAthlete, Score, Time } from 'app/types';

// Overlays open a read-token WS for live refresh — stub it so no socket opens.
// `wsState.lastJsonMessage` lets a test feed an `updateSelection` (the board's
// live selection) without a real socket; default null = nothing pushed yet.
const { wsState, sendWSMessageMock } = vi.hoisted(() => ({
  wsState: { lastJsonMessage: null as unknown },
  sendWSMessageMock: vi.fn(),
}));
vi.mock('app/hooks/useWebSocket', () => ({
  // readyState 1 = OPEN, so the ConnectionLostBadge stays quiet in these tests.
  // `sendWSMessage` absorbs the on-OPEN `request_state` catch-up send — one
  // STABLE fn (it sits in useStreamRefresh's effect deps; a per-render identity
  // would re-fire the on-OPEN invalidation every render).
  useWS: () => ({
    lastJsonMessage: wsState.lastJsonMessage,
    readyState: 1,
    sendWSMessage: sendWSMessageMock,
  }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { AthleteCard } from 'app/pages/Stream/AthleteCard';
import { BracketsOverlay } from 'app/pages/Stream/BracketsOverlay';
import { RankingsOverlay } from 'app/pages/Stream/RankingsOverlay';
import { ScoreCardOverlay } from 'app/pages/Stream/ScoreCardOverlay';
import { VsOverlay, matchSideOrder, pickMatch, pickLiveMatch } from 'app/pages/Stream/VsOverlay';
import { VsLiveOverlay } from 'app/pages/Stream/VsLiveOverlay';
import { WinnerOverlay } from 'app/pages/Stream/WinnerOverlay';
import { RoundsSummaryOverlay } from 'app/pages/Stream/RoundsSummaryOverlay';
import { SvoOverlay } from 'app/pages/Stream/SvoOverlay';
import { SvoLiveOverlay } from 'app/pages/Stream/SvoLiveOverlay';
import { OVERLAY_LANE } from 'app/pages/Stream/TimerLaneBlock';
import { STREAM_INSET_X_PX } from 'app/pages/Stream/StreamLayout';
import { colors, overlayArt, overlayTypeFloor, OVERLAY_TYPE_FLOOR_PX } from 'app/theme/tokens';
import { refVh, refVw } from 'app/util/overlayScale';

import { emPx, pinViewport, px, vhPx, vwPx } from '../../../util/computedUnits';

const COMP = 'worlds-2026';

const athlete = (athleteId: string, name: string): Athlete => ({
  athleteId,
  compId: COMP,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'male',
});

const renderOverlay = (path: string, routePattern: string, element: React.ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePattern} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  apiFetchMock.mockReset();
  sendWSMessageMock.mockReset();
  wsState.lastJsonMessage = null;
});

const selectionMessage = (data: {
  discipline: 'speed' | 'freestyle';
  round: string;
  athlete1Id: string | null;
  athlete2Id: string | null;
}) => ({
  type: 'updateSelection',
  data: { gender: 'male', matchId: null, ...data },
});

describe('RankingsOverlay', () => {
  it('renders the ranking for the URL round/gender and passes the read token', async () => {
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    // The plate carries the LAAX name split: bold given / light family spans.
    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.getByText('1:23.45')).toBeInTheDocument();

    // A plain round ranking places by result, so no row carries a source tag —
    // and no row reserves a tag column either.
    expect(screen.queryByTestId('ranking-source-tag-col')).not.toBeInTheDocument();

    const [path, opts] = apiFetchMock.mock.calls[0];
    expect(path).toContain(`/competitions/${COMP}/rankings/final`);
    // No discipline in the URL → the overlay defaults to speed.
    expect(path).toContain('discipline=speed');
    expect(opts).toMatchObject({ readToken: 'tok-1' });
  });

  it('renders the freestyle overall and passes discipline=freestyle from the URL', async () => {
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 0, overall: 27.5 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 0, overall: 21 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('27.50')).toBeInTheDocument();
    expect(screen.getByText('21.00')).toBeInTheDocument();

    const [path] = apiFetchMock.mock.calls[0];
    expect(path).toContain('discipline=freestyle');
  });

  it('labels the freestyle points unit (PTS) on the top row only', async () => {
    // Bare judged overalls ("31.0") read as points, not a time — a "PTS"
    // microlabel names the column once, on row 1 (rankings-result-legend).
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 0, overall: 31 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 0, overall: 27 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/qualification/female?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    const units = screen.getAllByTestId('ranking-result-unit');
    expect(units).toHaveLength(1);
    expect(units[0].textContent).toBe('PTS');
    // Judged components must not leak onto the broadcast — overall only.
    expect(screen.queryByText(/difficulty|combo|control/i)).not.toBeInTheDocument();
  });

  it('labels the freestyle points unit (PTS) on the top profile card only', async () => {
    // The profile cut must name the points column the same way the names cut
    // does: a bare judged overall on the portrait card reads as points, so the
    // top card (row 0) carries the "PTS" microlabel next to its result.
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 0, overall: 31 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 0, overall: 27 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/qualification/female?compId=${COMP}&token=tok-1&discipline=freestyle&variant=profile`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    const units = screen.getAllByTestId('athlete-card-result-unit');
    expect(units).toHaveLength(1);
    expect(units[0].textContent).toBe('PTS');
  });

  it('shows no result unit on a speed profile board (times are self-evident)', async () => {
    const ranked: RankedAthlete[] = [{ athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 }];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1&variant=profile`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    expect(screen.queryByTestId('athlete-card-result-unit')).not.toBeInTheDocument();
  });

  it('shows no result unit on a speed board (times are self-evident)', async () => {
    const ranked: RankedAthlete[] = [{ athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 }];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    expect(screen.queryByTestId('ranking-result-unit')).not.toBeInTheDocument();
  });

  it('renders the rank numeral in the display face and the value in the monospace face', async () => {
    const ranked: RankedAthlete[] = [{ athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 }];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    // The v2 Names art sets rank numerals in PlacardNext-Medium → Oswald 500.
    // MUI `sx` emits an emotion class, not an inline style, so assert computed.
    const rank = window.getComputedStyle(screen.getByText('1'));
    expect(rank.fontFamily).toContain('Oswald');
    expect(rank.fontWeight).toBe('500');

    const value = window.getComputedStyle(screen.getByText('1:23.45'));
    expect(value.fontFamily).toContain('JetBrains Mono');
    expect(value.fontVariantNumeric).toBe('tabular-nums');
  });

  it('shrinks a long name to fit and pins the result so it stays inside the plate (rankings-name-result-clip)', async () => {
    // Regression: a long family name overran the tapered plate and pushed the
    // right-aligned result past the edge, where Plate's overflow:hidden clipped it.
    // The name now shrinks-to-fit (measured uniform down-scale) rather than
    // ellipsizing, so the whole name stays legible.
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Taylor St. Germain-Villaseñor'), bestTimeMs: 83_450 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    // The name renders inside the shrink-to-fit wrapper (a `transform: scale()`
    // measured node), not an ellipsizing box.
    await screen.findByText('Taylor');
    const fit = screen.getByTestId('ranking-name-fit');
    expect(fit).toContainElement(screen.getByText('Taylor'));
    expect(window.getComputedStyle(fit).transform).toContain('scale');

    // The old ellipsis clip is gone — no rankings row still carries it.
    const nameBox = screen.getByText('Taylor').parentElement as HTMLElement;
    expect(window.getComputedStyle(nameBox).textOverflow).not.toBe('ellipsis');

    // The result is pinned (never shrinks), so it can't be pushed under the clip.
    const resultWrap = screen.getByTestId('ranking-result').parentElement as HTMLElement;
    expect(window.getComputedStyle(resultWrap).flexShrink).toBe('0');
  });

  it('renders a titleless field of tapering name plates', async () => {
    const ranked: RankedAthlete[] = [
      { athlete: { ...athlete('a1', 'Jane Doe'), gender: 'female' }, bestTimeMs: 83_450 },
      { athlete: { ...athlete('a2', 'Mary Roe'), gender: 'female' }, bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/female?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    // Titleless like the LAAX masters — no gender/discipline heading and no
    // round sub-line on the board.
    expect(screen.queryByText(/WOMEN.S SPEED/)).not.toBeInTheDocument();
    expect(screen.queryByText('FINAL')).not.toBeInTheDocument();

    // Rank-1 plate is wider than the rank-2 plate (tapering signature).
    const [first, second] = screen.getAllByTestId('ranking-plate');
    expect(parseFloat(window.getComputedStyle(first).width)).toBeGreaterThan(
      parseFloat(window.getComputedStyle(second).width),
    );
  });

  it('renders the LAAX v2 names art geometry off the 1080p reference (top-4 cut)', async () => {
    // ≤ 4 rows → the top-4 frame: rank-1 plate 828.48×105.9, rows scaled ~0.944
    // per step, 72.68px numerals, the 5px plate stroke.
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    await screen.findByText('Jane');

    const [first, second] = screen.getAllByTestId('ranking-plate');
    const fs = window.getComputedStyle(first);
    expect(px(fs.width)).toBeCloseTo(vwPx('43.15vw'), 2); // 828.48px @1920
    expect(px(fs.borderTopWidth)).toBeCloseTo(vhPx('0.463vh'), 2); // 5px @1080
    expect(px(window.getComputedStyle(first.parentElement as HTMLElement).height)) // 105.9px @1080
      .toBeCloseTo(vhPx('9.806vh'), 2);
    expect(px(window.getComputedStyle(second).width)).toBeCloseTo(vwPx('40.751vw'), 2); // 828.48 × 0.9444

    const rank = window.getComputedStyle(screen.getByText('1'));
    expect(px(rank.fontSize)).toBeCloseTo(vhPx('6.73vh'), 2); // 72.68px @1080
  });

  it('scales the whole composition down for more than four rows (top-8 cut)', async () => {
    // > 4 rows → the top-8 frame: the same recipe × 626.93/828.48, with rows
    // past the fifth holding the row-5 size (the art's flat tail).
    const ranked: RankedAthlete[] = [50, 51, 52, 53, 54, 55].map((s, i) => ({
      athlete: athlete(`a${i + 1}`, `Racer R${i + 1}`),
      bestTimeMs: s * 1000,
    }));
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    await screen.findByText('R1');

    const plates = screen.getAllByTestId('ranking-plate');
    expect(plates).toHaveLength(6);
    const width = (el: HTMLElement) => window.getComputedStyle(el).width;
    // 626.93px @1920 (the art's top-8 rank-1 plate)
    expect(px(width(plates[0]))).toBeCloseTo(vwPx('32.653vw'), 2);
    // Rows 5 and 6 share the flat-tail size.
    expect(width(plates[4])).toBe(width(plates[5]));
    expect(parseFloat(width(plates[3]))).toBeGreaterThan(parseFloat(width(plates[4])));
    // The stroke does not scale between the two cuts.
    expect(px(window.getComputedStyle(plates[0]).borderTopWidth)).toBeCloseTo(vhPx('0.463vh'), 2);
  });

  it('caps the names field at the top 8 athletes', async () => {
    // The `Names top 8` recipe is the largest cut the art defines — a deeper
    // field (12 ranked here) must not spill past 8 rows on camera.
    const ranked: RankedAthlete[] = Array.from({ length: 12 }, (_, i) => ({
      athlete: athlete(`a${i + 1}`, `Racer R${i + 1}`),
      bestTimeMs: (50 + i) * 1000,
    }));
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    await screen.findByText('R1');

    expect(screen.getAllByTestId('ranking-plate')).toHaveLength(8);
    // The 9th-ranked athlete is dropped from the overlay.
    expect(screen.queryByText('R9')).toBeNull();
  });

  it('renders filled row plates solid white with dark name + result (two-tier)', async () => {
    const ranked: RankedAthlete[] = [{ athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 }];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    // A ranked row is a FILLED content plate → solid white fill, not translucent.
    const name = await screen.findByText('Jane');
    const plate = screen.getByTestId('ranking-plate');
    expect(window.getComputedStyle(plate).backgroundColor).toBe('rgb(255, 255, 255)');

    // …so the name must be dark ink, not white-on-white (the bug).
    expect(window.getComputedStyle(name).color).toBe('rgb(35, 31, 32)'); // overlay.nameInk (#231f20)
    // The result numeral on the plate is dark too.
    expect(window.getComputedStyle(screen.getByText('1:23.45')).color).toBe('rgb(35, 31, 32)');

    // The rank numeral sits OUTSIDE the plate on the transparent bg → stays white.
    expect(window.getComputedStyle(screen.getByText('1')).color).toBe('rgb(255, 255, 255)');

    // Dark-ink-on-white-plate text cancels the StreamLayout footage shadow so it
    // reads as flat plate text, not a dark double-image (the leak fix). The
    // declaration sits on the filled plate; the name + result inherit it. jsdom 29
    // reports the inherited (unresolved var()) footage shadow from getComputedStyle
    // rather than honoring the element's own override, so assert the emotion rule.
    const flatCss = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(flatCss).toContain('text-shadow:none');
  });

  it('renders top-4 portrait profile cards when variant=profile', async () => {
    // Five ranked athletes → the profile cut renders only the top four, as
    // AthleteCard portrait boxes (photo region + name band), not name plates.
    const ranked: RankedAthlete[] = [83, 84, 85, 86, 87].map((s, i) => ({
      athlete: athlete(`a${i + 1}`, `Racer R${i + 1}`),
      bestTimeMs: s * 1000,
    }));
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1&variant=profile`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('R1');
    // Four portrait cards; the fifth entry is cut.
    expect(screen.getAllByTestId('athlete-card-photo')).toHaveLength(4);
    expect(screen.getAllByTestId('ranking-profile-slot')).toHaveLength(4);
    expect(screen.queryByText('R5')).not.toBeInTheDocument();
    // No name-plate rows — the variant swaps the row recipe entirely.
    expect(screen.queryAllByTestId('ranking-plate')).toHaveLength(0);
    // Titleless — the shared data path still renders each card's result.
    expect(screen.queryByText(/MEN.S SPEED/)).not.toBeInTheDocument();
    expect(screen.getByText('1:23.00')).toBeInTheDocument();
  });

  it('renders the LAAX v2 profile art geometry off the 1080p reference', async () => {
    // `LAAX 2026_Profile top 4.svg`: rank-1 card 298.81×498.02 (the VS panel
    // size), per-rank uniform taper, constant 9px stroke, numerals 156.12→66px
    // bottom-aligned left of each card.
    const ranked: RankedAthlete[] = [83, 84, 85, 86].map((s, i) => ({
      athlete: athlete(`a${i + 1}`, `Racer R${i + 1}`),
      bestTimeMs: s * 1000,
    }));
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1&variant=profile`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    await screen.findByText('R1');

    const slots = screen.getAllByTestId('ranking-profile-slot');
    const expectSize = (el: HTMLElement, w: string, h: string) => {
      const s = window.getComputedStyle(el);
      expect(px(s.width)).toBeCloseTo(vwPx(w), 2);
      expect(px(s.height)).toBeCloseTo(vhPx(h), 2);
    };
    expectSize(slots[0], '15.563vw', '46.113vh'); // 298.81×498.02 @1920×1080
    expectSize(slots[1], '13.275vw', '39.333vh'); // 254.88×424.8
    expectSize(slots[2], '11.66vw', '34.547vh'); // 223.87×373.11
    expectSize(slots[3], '10.233vw', '30.321vh'); // 196.48×327.47

    // The art's stroke is a constant 9px across all four cards (no taper).
    for (const slot of slots) {
      const card = slot.firstElementChild as HTMLElement;
      expect(px(window.getComputedStyle(card).borderTopWidth)).toBeCloseTo(vhPx('0.833vh'), 2);
    }

    // Rank numerals in the display face at the art's per-rank sizes.
    const numeral = (text: string) => window.getComputedStyle(screen.getByText(text));
    expect(px(numeral('1').fontSize)).toBeCloseTo(vhPx('14.456vh'), 2); // 156.12px @1080
    expect(numeral('1').fontFamily).toContain('Oswald');
    expect(numeral('1').fontWeight).toBe('500');
    expect(px(numeral('2').fontSize)).toBeCloseTo(vhPx('9.907vh'), 2); // 107px
    expect(px(numeral('3').fontSize)).toBeCloseTo(vhPx('7.777vh'), 2); // 83.99px
    expect(px(numeral('4').fontSize)).toBeCloseTo(vhPx('6.111vh'), 2); // 66px
  });

  it('marks tied ranks with a shared "=" numeral and skips the consumed ranks', async () => {
    // Three athletes share the same best time → all rank "=1"; the fourth, slower,
    // resumes at the standard skip rank 4 (1,1,1,4 competition-ranking convention).
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 83_450 },
      { athlete: athlete('a3', 'Mary Moe'), bestTimeMs: 83_450 },
      { athlete: athlete('a4', 'Mark Loe'), bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    // Three "=1" rank cells for the tie, then a plain "4" — no "2" or "3".
    expect(screen.getAllByText('=1')).toHaveLength(3);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('widens the numeral column to the field’s widest rank label, equally on every row', async () => {
    // A `=1` tie label is two glyphs wide. The column is sized ONCE per field to
    // the widest label and applied to every row, so the plates keep one left edge
    // AND the widest numeral still starts inside the 96px title-safe inset
    // (it used to overflow leftward out of a one-digit box).
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 83_450 },
      { athlete: athlete('a3', 'Mark Loe'), bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    const cols = screen.getAllByTestId('ranking-numeral-col');
    expect(cols).toHaveLength(3);
    for (const col of cols) {
      const cs = window.getComputedStyle(col);
      // 2 x 35.79px @1920 — the digit box times the widest label's glyph count.
      expect(px(cs.width)).toBeCloseTo(vwPx('3.728vw'), 2);
      // A fixed width (not min-width:auto) so a row's own glyphs cannot widen it.
      expect(cs.minWidth).toBe('0px');
    }
  });

  it('leaves a tie-free field at the single-digit column geometry', async () => {
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    for (const col of screen.getAllByTestId('ranking-numeral-col')) {
      expect(px(window.getComputedStyle(col).width)).toBeCloseTo(vwPx('1.864vw'), 2);
    }
  });

  it('does not mark a value as tied when the displayed result differs', async () => {
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 90_000 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    // Distinct times → plain incrementing numerals, no "=" prefix anywhere.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('=1')).not.toBeInTheDocument();
  });

  it('renders the overall standings with server ranks — equal results never merge to "=1"', async () => {
    // Final standings (rule G3): rank is a bracket outcome, so two rows with an
    // identical displayed time keep their own numerals (winner over loser).
    const standings = [
      { athlete: athlete('a1', 'Jane Doe'), rank: 1, source: 'final', bestTimeMs: 83_450 },
      { athlete: athlete('a2', 'John Roe'), rank: 2, source: 'final', bestTimeMs: 83_450 },
      // Bracket-placed with no run yet → em dash, not 00:00:00.
      { athlete: athlete('a3', 'Mary Moe'), rank: 3, source: 'small_final', provisional: true },
    ];
    apiFetchMock.mockResolvedValue(standings);

    renderOverlay(
      `/stream/rankings/overall/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    const [path, opts] = apiFetchMock.mock.calls[0];
    expect(path).toContain(`/competitions/${COMP}/rankings/overall`);
    expect(path).toContain('discipline=speed');
    expect(opts).toMatchObject({ readToken: 'tok-1' });

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('=1')).not.toBeInTheDocument();
    expect(screen.getAllByText('1:23.45')).toHaveLength(2);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0:00.00')).not.toBeInTheDocument();
    // Titleless — the overall board carries no self-naming sub-line; the
    // per-row source tags supply the result context instead.
    expect(screen.queryByText('FINAL STANDINGS')).not.toBeInTheDocument();
  });

  it('tags each standings row with the round that placed it (result-context)', async () => {
    // G3 places by bracket outcome, so a slower time can sit above a faster one.
    // The per-row source tag qualifies the result as "best time from the placing
    // round", so the ordering never reads as a broken sort (the demo comp's
    // female speed board: a small-final winner above the loser on a slower time).
    const standings = [
      { athlete: athlete('a1', 'Ida Ace'), rank: 1, source: 'final', bestTimeMs: 84_000 },
      { athlete: athlete('a2', 'Bea Bow'), rank: 2, source: 'final', bestTimeMs: 83_000 },
      { athlete: athlete('a3', 'Mel Cox'), rank: 3, source: 'small_final', bestTimeMs: 7_060 },
      { athlete: athlete('a4', 'Tan Dey'), rank: 4, source: 'small_final', bestTimeMs: 6_570 },
      { athlete: athlete('a5', 'Eve Fox'), rank: 5, source: 'quarter', bestTimeMs: 6_000 },
      { athlete: athlete('a6', 'Gia Hue'), rank: 9, source: 'qualification', bestTimeMs: 5_000 },
    ];
    apiFetchMock.mockResolvedValue(standings);

    renderOverlay(
      `/stream/rankings/overall/female?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Ida');
    // One tag per row, each naming the placing round, top-down.
    const tags = screen.getAllByTestId('ranking-source-tag').map((el) => el.textContent);
    expect(tags).toEqual(['FINAL', 'FINAL', 'SMALL FINAL', 'SMALL FINAL', 'QF', 'QUALI']);

    // Rank 3 shows a SLOWER time than rank 4, both under a SMALL FINAL tag —
    // the placement, not the clock, drove the order.
    const plates = screen.getAllByTestId('ranking-plate');
    expect(within(plates[2]).getByTestId('ranking-source-tag')).toHaveTextContent('SMALL FINAL');
    expect(within(plates[2]).getByTestId('ranking-result').textContent).toBe('0:07.06');
    expect(within(plates[3]).getByTestId('ranking-result').textContent).toBe('0:06.57');
  });

  it('reserves the same source-tag column on every standings row', async () => {
    // 'SMALL FINAL' is far wider than 'QUALI'. Left content-sized it steals name
    // room from its own row only, so `useFitToWidth` scales that name down and
    // the taper reads non-monotonic (rank 4 smaller than rank 5). Every row
    // reserves the width of the WIDEST tag in the field instead — the column is
    // the same box everywhere, so the name fit varies only with the name.
    const standings = [
      { athlete: athlete('a1', 'Ida Ace'), rank: 1, source: 'final', bestTimeMs: 84_000 },
      { athlete: athlete('a2', 'Bea Bow'), rank: 2, source: 'small_final', bestTimeMs: 83_000 },
      { athlete: athlete('a3', 'Mel Cox'), rank: 3, source: 'qualification', bestTimeMs: 7_060 },
    ];
    apiFetchMock.mockResolvedValue(standings);

    renderOverlay(
      `/stream/rankings/overall/female?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Ida');
    const columns = screen.getAllByTestId('ranking-source-tag-col');
    expect(columns).toHaveLength(3);
    // The column's intrinsic width is the widest of the field's candidates, laid
    // out as hidden sizers under the visible tag — identical on every row.
    const sizers = columns.map((column) =>
      within(column)
        .getAllByTestId('ranking-source-tag-sizer')
        .map((el) => el.textContent)
        .sort(),
    );
    expect(sizers[0]).toEqual(['FINAL', 'QUALI', 'SMALL FINAL']);
    expect(sizers[1]).toEqual(sizers[0]);
    expect(sizers[2]).toEqual(sizers[0]);
    // Sizers are laid out but never seen, and the visible tag is right-aligned
    // against the result so the number keeps its column.
    for (const sizer of within(columns[0]).getAllByTestId('ranking-source-tag-sizer')) {
      expect(window.getComputedStyle(sizer).visibility).toBe('hidden');
    }
    expect(window.getComputedStyle(columns[0]).justifyItems).toBe('end');
  });

  it('tags each profile-variant standings card with its placing round', async () => {
    // The profile cut must disambiguate the same way the names cut does (goal
    // g3): a slower time above a faster one is a bracket outcome, so each of the
    // top-4 portrait cards carries the placing-round tag next to its result.
    const standings = [
      { athlete: athlete('a1', 'Ida Ace'), rank: 1, source: 'final', bestTimeMs: 84_000 },
      { athlete: athlete('a2', 'Bea Bow'), rank: 2, source: 'final', bestTimeMs: 83_000 },
      { athlete: athlete('a3', 'Mel Cox'), rank: 3, source: 'small_final', bestTimeMs: 7_060 },
      { athlete: athlete('a4', 'Tan Dey'), rank: 4, source: 'small_final', bestTimeMs: 6_570 },
      { athlete: athlete('a5', 'Eve Fox'), rank: 5, source: 'quarter', bestTimeMs: 6_000 },
    ];
    apiFetchMock.mockResolvedValue(standings);

    renderOverlay(
      `/stream/rankings/overall/female?compId=${COMP}&token=tok-1&variant=profile`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Ida');
    // Top-4 cut → four cards, four tags naming the placing round top-down; the
    // fifth (quarter) is off the profile cut, so no QF tag.
    const tags = screen.getAllByTestId('athlete-card-source-tag');
    expect(tags.map((el) => el.textContent)).toEqual([
      'FINAL',
      'FINAL',
      'SMALL FINAL',
      'SMALL FINAL',
    ]);
    // Subordinate display-caps treatment, same as the names cut's tag.
    expect(px(window.getComputedStyle(tags[0]).letterSpacing)).toBeCloseTo(
      emPx(overlayArt.headingTracking, tags[0]),
      2,
    );
  });

  it('renders the combined ranking with =-prefixed server ranks and the average as result', async () => {
    // Combined (rule G2): the server assigns 1224-style shared ranks over the
    // averaged placements; the client renders `=` on repeats, never re-derives.
    const combined = [
      {
        athlete: athlete('a1', 'Jane Doe'),
        rank: 1,
        combined: 1.5,
        speedRank: 2,
        freestyleRank: 1,
      },
      {
        athlete: athlete('a2', 'John Roe'),
        rank: 1,
        combined: 1.5,
        speedRank: 1,
        freestyleRank: 2,
      },
      { athlete: athlete('a3', 'Mary Moe'), rank: 3, combined: 3, speedRank: 3, freestyleRank: 3 },
    ];
    apiFetchMock.mockResolvedValue(combined);

    renderOverlay(
      `/stream/rankings/combined/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );

    await screen.findByText('Jane');
    const [path, opts] = apiFetchMock.mock.calls[0];
    expect(path).toContain(`/competitions/${COMP}/rankings/combined`);
    // Cross-discipline by definition — no discipline param on the request.
    expect(path).not.toContain('discipline');
    expect(opts).toMatchObject({ readToken: 'tok-1' });

    // The tied pair shares =1; the average renders to one decimal as the result.
    expect(screen.getAllByText('=1')).toHaveLength(2);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('1.5')).toHaveLength(2);
    expect(screen.getByText('3.0')).toBeInTheDocument();
    // The ranked field is titleless like the LAAX masters — no plane heading.
    expect(screen.queryByText('MEN’S COMBINED')).not.toBeInTheDocument();
    // The average is a RANK (lower is better, opposite every other board) —
    // no "PTS" unit that would imply points.
    expect(screen.queryByTestId('ranking-result-unit')).not.toBeInTheDocument();
  });

  it('fails safe (error status, nothing on camera) for an invalid round', () => {
    renderOverlay(
      `/stream/rankings/bogus/male?compId=${COMP}&token=t`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    // No visible "Invalid" text on the broadcast — status is exposed off-air.
    expect(screen.queryByText(/invalid overlay url/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('reports error (not blank) when compId is missing from the URL', () => {
    renderOverlay(
      '/stream/rankings/final/male?token=t',
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('reports empty (not blank) when the round has no ranked athletes', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    const marker = await screen.findByTestId('stream-status');
    await vi.waitFor(() => expect(marker).toHaveAttribute('data-stream-status', 'empty'));
  });

  it('reports ready once content is on air', async () => {
    apiFetchMock.mockResolvedValue([{ athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 83_450 }]);
    renderOverlay(
      `/stream/rankings/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rankings/:round/:gender',
      <RankingsOverlay />,
    );
    await screen.findByText('Jane');
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'ready');
  });
});

describe('ScoreCardOverlay (freestyle judged table)', () => {
  const judgedScore = (athleteId: string, overrides: Partial<Score> = {}): Score => ({
    scoreId: `s-${athleteId}`,
    compId: COMP,
    athleteId,
    round: 'quarter',
    difficulty: 32.5,
    combo: 21,
    style: 18.25,
    bestTrick: 12,
    controlPenalty: 3.5,
    overall: 80.25,
    ...overrides,
  });

  it('renders the component breakdown, pins discipline=freestyle, and passes the read token', async () => {
    const ranked: RankedAthlete[] = [
      {
        athlete: athlete('a1', 'Jane Doe'),
        bestTimeMs: 0,
        overall: 80.25,
        score: judgedScore('a1'),
      },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      // No ?discipline= in the URL — the scorecard is inherently freestyle.
      `/stream/scorecard/quarter/male?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    // Every judged component at the shared 2-dp display precision (ADR 0039).
    expect(screen.getByText('80.25')).toBeInTheDocument(); // TOTAL
    expect(screen.getByText('32.50')).toBeInTheDocument(); // trick difficulty
    expect(screen.getByText('21.00')).toBeInTheDocument(); // combo
    expect(screen.getByText('18.25')).toBeInTheDocument(); // style
    expect(screen.getByText('3.50')).toBeInTheDocument(); // control penalty
    expect(screen.getByText('12.00')).toBeInTheDocument(); // best trick

    const [path, opts] = apiFetchMock.mock.calls[0];
    expect(path).toContain(`/competitions/${COMP}/rankings/quarter`);
    expect(path).toContain('discipline=freestyle');
    expect(opts).toMatchObject({ readToken: 'tok-1' });
  });

  it('renders the art column headers over the value grid', async () => {
    apiFetchMock.mockResolvedValue([
      {
        athlete: athlete('a1', 'Jane Doe'),
        bestTimeMs: 0,
        overall: 80.25,
        score: judgedScore('a1'),
      },
    ] satisfies RankedAthlete[]);

    renderOverlay(
      `/stream/scorecard/half/female?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    await screen.findByText('Jane');
    expect(screen.getByText('TOTAL')).toBeInTheDocument();
    // TRICK stacks twice in the art: TRICK/DIFFICULTY and BEST/TRICK.
    expect(screen.getAllByText('TRICK')).toHaveLength(2);
    for (const line of ['DIFFICULTY', 'COMBO', 'STYLE', 'CONTROL', 'PENALTY', 'BEST']) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it('strikes the whole breakdown on a DNF row', async () => {
    const ranked: RankedAthlete[] = [
      {
        athlete: athlete('a1', 'Jane Doe'),
        bestTimeMs: 0,
        overall: 80.25,
        score: judgedScore('a1'),
      },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 0, dnf: true, score: judgedScore('a2') },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/scorecard/final/male?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    await screen.findByText('John');
    // DNF in the TOTAL box; every component cell an em dash — the stored
    // components are irrelevant once dnf is set (the Score.dnf contract).
    expect(screen.getByText('DNF')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  it('caps the field at the art’s 8 rows', async () => {
    const ranked: RankedAthlete[] = Array.from({ length: 10 }, (_, i) => ({
      athlete: athlete(`a${i}`, `Athlete Number${i}`),
      bestTimeMs: 0,
      overall: 90 - i,
      score: judgedScore(`a${i}`, { overall: 90 - i }),
    }));
    apiFetchMock.mockResolvedValue(ranked);

    renderOverlay(
      `/stream/scorecard/qualification/male?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    await screen.findByText('Number0');
    expect(screen.getAllByTestId('scorecard-name-plate')).toHaveLength(8);
    expect(screen.queryByText('Number8')).not.toBeInTheDocument();
  });

  it('drops the control-penalty and best-trick columns for qualification', async () => {
    apiFetchMock.mockResolvedValue([
      {
        athlete: athlete('a1', 'Jane Doe'),
        bestTimeMs: 0,
        overall: 71.75,
        score: judgedScore('a1', { round: 'qualification' }),
      },
    ] satisfies RankedAthlete[]);

    renderOverlay(
      `/stream/scorecard/qualification/female?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    await screen.findByText('Jane');
    // The three kept components + total.
    expect(screen.getByText('TOTAL')).toBeInTheDocument();
    for (const line of ['DIFFICULTY', 'COMBO', 'STYLE']) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    // TRICK only stacks once now (TRICK/DIFFICULTY); BEST TRICK is gone.
    expect(screen.getAllByText('TRICK')).toHaveLength(1);
    for (const line of ['CONTROL', 'PENALTY', 'BEST']) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('scorecard-cell-controlPenalty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scorecard-cell-bestTrick')).not.toBeInTheDocument();
    // The kept component cells still render.
    expect(screen.getByTestId('scorecard-cell-difficulty')).toBeInTheDocument();
  });

  it('widens the rank column to the field’s widest label, headers included', async () => {
    // Two athletes on the same total tie at `=1` (two glyphs). The card's rank
    // column grows once for the whole field so no numeral paints left of the
    // 96px title-safe inset — and the header spacer grows with it, or the column
    // headers would slide off their value boxes.
    apiFetchMock.mockResolvedValue([
      {
        athlete: athlete('a1', 'Jane Doe'),
        bestTimeMs: 0,
        overall: 80.25,
        score: judgedScore('a1'),
      },
      {
        athlete: athlete('a2', 'John Roe'),
        bestTimeMs: 0,
        overall: 80.25,
        score: judgedScore('a2'),
      },
    ] satisfies RankedAthlete[]);

    renderOverlay(
      `/stream/scorecard/half/female?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    await screen.findByText('Jane');
    expect(screen.getAllByText('=1')).toHaveLength(2);
    for (const col of screen.getAllByTestId('scorecard-rank-col')) {
      // 2 x 20.32px @1920 — the art's digit box times the widest label's glyphs.
      expect(px(window.getComputedStyle(col).width)).toBeCloseTo(vwPx('2.117vw'), 2);
    }
    // Spacer = rank column + rank gap + name plate (40.64 + 14 + 444.26).
    const spacer = screen.getByTestId('scorecard-header-spacer');
    expect(px(window.getComputedStyle(spacer).width)).toBeCloseTo(vwPx('25.984vw'), 2);
  });

  it('draws populated component cells on the filled tier and the penalty solid', async () => {
    apiFetchMock.mockResolvedValue([
      {
        athlete: athlete('a1', 'Jane Doe'),
        bestTimeMs: 0,
        overall: 80.25,
        score: judgedScore('a1'),
      },
    ] satisfies RankedAthlete[]);

    renderOverlay(
      `/stream/scorecard/half/female?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );

    await screen.findByText('Jane');
    // A judged component is a FILLED cell: opaque white with near-black digits
    // and no footage shadow (the two-tier rule, as on the ranking name plates).
    const difficulty = screen.getByTestId('scorecard-cell-difficulty');
    const style = window.getComputedStyle(difficulty);
    expect(style.backgroundColor).toBe('rgb(255, 255, 255)'); // overlay.plateFilled
    // jsdom normalizes a declared `text-shadow: none` to `rgba(0, 0, 0, 0)`; an
    // INHERITED shadow echoes its authored string, so the cell dropping the
    // layout's footage shadow reads as a difference from a cell that keeps it.
    expect(style.textShadow).toBe('rgba(0, 0, 0, 0)');
    expect(style.textShadow).not.toBe(
      window.getComputedStyle(screen.getByTestId('scorecard-rank-col')).textShadow,
    );
    expect(window.getComputedStyle(screen.getByText('32.50')).color).toBe('rgb(35, 31, 32)');
    // The penalty keeps the chromatic exception: solid stop red, white numeral,
    // no 28% wash (which left the digits pale over bright footage).
    const penalty = screen.getByTestId('scorecard-cell-controlPenalty');
    expect(window.getComputedStyle(penalty).backgroundColor).toBe('rgb(240, 78, 52)');
    expect(window.getComputedStyle(screen.getByText('3.50')).color).toBe('rgb(255, 255, 255)');
    // TOTAL is unchanged: the art's near-black box with a white numeral.
    const total = screen.getByTestId('scorecard-cell-total');
    expect(window.getComputedStyle(total).backgroundColor).toBe('rgb(35, 31, 32)');
    expect(window.getComputedStyle(screen.getByText('80.25')).color).toBe('rgb(255, 255, 255)');
  });

  it('fails safe (error status, nothing on camera) for an invalid round', () => {
    renderOverlay(
      `/stream/scorecard/bogus/male?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('VsOverlay', () => {
  it('renders head-to-head cards with best times and the winner', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    const times: Time[] = [
      { timeId: 't1', compId: COMP, athleteId: 'a1', round: 'final', timeMs: 83_450, startTime: 1 },
      { timeId: 't2', compId: COMP, athleteId: 'a2', round: 'final', timeMs: 90_000, startTime: 1 },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve(times);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    // Names and times arrive on separate queries — gate on a time, the later of
    // the two, so the name assertions can't win the race on their own.
    expect(await screen.findByText('1:23.45')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('Roe')).toBeInTheDocument();
    expect(screen.getByText('1:30.00')).toBeInTheDocument();
    // Captionless — the head-to-head no longer names its round/plane.
    expect(screen.queryByText('MEN’S SPEED — FINAL 1')).not.toBeInTheDocument();
  });

  it('renders the LAAX v2 art geometry off the 1080p reference (panels, stroke, VS glyph)', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );
    await screen.findByText('Jane');

    // The VS glyph is the art's PlacardNext-Medium → Oswald 500, tight display
    // tracking, 109.98px on the 1080p frame.
    const vsEl = screen.getByText('VS');
    const vs = window.getComputedStyle(vsEl);
    expect(vs.fontFamily).toContain('Oswald');
    expect(vs.fontWeight).toBe('500');
    expect(px(vs.letterSpacing)).toBeCloseTo(emPx('-0.02em', vsEl), 2);
    expect(px(vs.fontSize)).toBeCloseTo(vhPx('10.183vh'), 2);

    // The context caption is gone — the composition is the captionless master.
    expect(screen.queryByTestId('vs-context-caption')).not.toBeInTheDocument();

    // Two 298.81×498.02 portrait panels on the 1920×1080 reference, derived
    // responsively (vw/vh), with the heavier lower-third frame edge (10px →
    // 0.926vh @1080p; the shared bracket/VS stroke stays 6px — ADR 0029 amend).
    const cards = screen
      .getAllByTestId('athlete-card-photo')
      .map((photo) => photo.parentElement as HTMLElement);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(px(window.getComputedStyle(card).borderTopWidth)).toBeCloseTo(vhPx('0.926vh'), 2);
      const frame = window.getComputedStyle(card.parentElement as HTMLElement);
      expect(px(frame.width)).toBeCloseTo(vwPx('15.563vw'), 2);
      expect(px(frame.height)).toBeCloseTo(vhPx('46.113vh'), 2);
    }
  });

  it('flips the card sides when the board swaps its lanes (ADR 0044)', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });
    // The board swapped its lanes: a2 stands on lane 1 — SVO-B and the lane
    // names already follow this pairing, so the VS card must render John left.
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: 'm1',
        athlete1Id: 'a2',
        athlete2Id: 'a1',
      },
    };

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    await screen.findByText('Jane');
    const text = document.body.textContent ?? '';
    expect(text.indexOf('John')).toBeGreaterThan(-1);
    expect(text.indexOf('John')).toBeLessThan(text.indexOf('Jane'));
  });

  it('renders competitor best times in the monospace numeral face', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    const times: Time[] = [
      { timeId: 't1', compId: COMP, athleteId: 'a1', round: 'final', timeMs: 83_450, startTime: 1 },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve(times);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    // MUI `sx` emits an emotion class, not an inline style, so assert computed.
    const value = window.getComputedStyle(await screen.findByText('1:23.45'));
    expect(value.fontFamily).toContain('JetBrains Mono');
    expect(value.fontVariantNumeric).toBe('tabular-nums');
  });

  it('renders exactly one pair, scoped to the &match in the URL', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'quarter',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
      {
        matchId: 'm2',
        compId: COMP,
        discipline: 'speed',
        round: 'quarter',
        gender: 'male',
        position: 1,
        athlete1Id: 'a3',
        athlete2Id: 'a4',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([
          athlete('a1', 'Jane Doe'),
          athlete('a2', 'John Roe'),
          athlete('a3', 'Mary Moe'),
          athlete('a4', 'Mark Loe'),
        ]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/quarter/male?compId=${COMP}&token=tok-1&match=m2`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    // Only the m2 pair renders; the m1 athletes are absent (not all stacked).
    expect(await screen.findByText('Mary')).toBeInTheDocument();
    expect(screen.getByText('Mark')).toBeInTheDocument();
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
    // Exactly one VS glyph → exactly one matchup on screen.
    expect(screen.getAllByText('VS')).toHaveLength(1);
  });

  it('caps the unscoped default to a single live match (no full stack)', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'quarter',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        // Already decided → not the live one.
        winnerId: 'a1',
      },
      {
        matchId: 'm2',
        compId: COMP,
        discipline: 'speed',
        round: 'quarter',
        gender: 'male',
        position: 1,
        athlete1Id: 'a3',
        athlete2Id: 'a4',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([
          athlete('a1', 'Jane Doe'),
          athlete('a2', 'John Roe'),
          athlete('a3', 'Mary Moe'),
          athlete('a4', 'Mark Loe'),
        ]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/quarter/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    // The live match (m2, no winner) shows; the decided m1 does not — one pair.
    expect(await screen.findByText('Mary')).toBeInTheDocument();
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
    expect(screen.getAllByText('VS')).toHaveLength(1);
  });

  it('shows Score.overall (not times) on the freestyle discipline', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'freestyle',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    const scores: Score[] = [
      {
        scoreId: 's1',
        compId: COMP,
        athleteId: 'a1',
        round: 'final',
        difficulty: 0,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
        overall: 27.5,
      },
      {
        scoreId: 's2',
        compId: COMP,
        athleteId: 'a2',
        round: 'final',
        difficulty: 0,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
        overall: 21,
        dnf: true,
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/scores')) return Promise.resolve(scores);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    // Freestyle overall to two decimals; the DNF competitor renders the label.
    expect(await screen.findByText('27.50')).toBeInTheDocument();
    expect(screen.getByText('DNF')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    // Captionless — the discipline shows only through the result plane below.
    expect(screen.queryByText('MEN’S FREESTYLE — FINAL 1')).not.toBeInTheDocument();

    // The freestyle plane reads scores, never the speed times endpoint.
    const paths = apiFetchMock.mock.calls.map(([p]: string[]) => p);
    expect(paths.some((p) => p.includes('/scores'))).toBe(true);
    expect(paths.some((p) => p.includes('/times'))).toBe(false);
  });

  it('suppresses the result line (no em-dash) when a competitor has no result', async () => {
    // Undecided match, no times recorded yet: both cards must show no numeral at
    // all rather than a bare "—" that reads as a broken render.
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    // Undecided → neither card is tagged.
    expect(screen.queryByTestId('athlete-card-winner-tag')).not.toBeInTheDocument();
  });

  it('tags only the winning card WINNER when the match is decided', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final 1',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    await screen.findByText('Jane');
    // Exactly one WINNER tag, and it sits on the winner (a1 / Jane) card — the
    // photo's parent Plate is the shared card root that holds both name and tag.
    expect(screen.getAllByTestId('athlete-card-winner-tag')).toHaveLength(1);
    const cards = screen
      .getAllByTestId('athlete-card-photo')
      .map((p) => p.parentElement as HTMLElement);
    const janeCard = cards.find((c) => within(c).queryByText('Jane')) as HTMLElement;
    const johnCard = cards.find((c) => within(c).queryByText('John')) as HTMLElement;
    expect(within(janeCard).getByTestId('athlete-card-winner-tag')).toBeInTheDocument();
    expect(within(johnCard).queryByTestId('athlete-card-winner-tag')).not.toBeInTheDocument();
  });

  it('lists each athlete RUN 1/2/3 laps in chronological order, DNF and blanks included', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ];
    // a1 recorded two runs (out of chronological insert order) + a DNF; a2 one run.
    const times: Time[] = [
      {
        timeId: 't2',
        compId: COMP,
        athleteId: 'a1',
        round: 'final',
        timeMs: 81_990,
        startTime: 200,
      },
      {
        timeId: 't1',
        compId: COMP,
        athleteId: 'a1',
        round: 'final',
        timeMs: 83_450,
        startTime: 100,
      },
      // DNF sentinel (app/util/time DNF_SENTINEL) — renders "DNF".
      {
        timeId: 't3',
        compId: COMP,
        athleteId: 'a1',
        round: 'final',
        timeMs: 3_355_550,
        startTime: 300,
      },
      {
        timeId: 't4',
        compId: COMP,
        athleteId: 'a2',
        round: 'final',
        timeMs: 90_000,
        startTime: 150,
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve(times);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    await screen.findByText('Jane');
    const left = screen.getByTestId('vs-stats-left');
    // a1 runs ordered by startTime: 1:23.45 (t100), 1:21.99 (t200), DNF (t300).
    // The laps ride the /times query, which lands after the names the gate above
    // waits for — so the first lap is the real gate for the whole table.
    expect(await within(left).findByText('1:23.45')).toBeInTheDocument();
    expect(within(left).getByText('1:21.99')).toBeInTheDocument();
    expect(within(left).getByText('DNF')).toBeInTheDocument();
    // Three RUN labels per side.
    expect(within(left).getAllByText(/^RUN [123]$/)).toHaveLength(3);

    // a2 has a single run → RUN 1 filled, RUN 2/3 blank (no placeholder zeros).
    const right = screen.getByTestId('vs-stats-right');
    expect(within(right).getByText('1:30.00')).toBeInTheDocument();
    expect(within(right).queryByText('—')).not.toBeInTheDocument();
    expect(within(right).queryByText('00:00:00')).not.toBeInTheDocument();

    // Two-tier rule: a RUN cell holding a time is a filled plate (opaque white,
    // near-black digits, no footage shadow — white-on-35%-white washed out over
    // bright footage); an unrun slot keeps the art's translucent empty box.
    const run1 = within(right).getByTestId('vs-cell-run-1');
    const filled = window.getComputedStyle(run1);
    expect(filled.backgroundColor).toBe('rgb(255, 255, 255)'); // overlay.plateFilled
    expect(window.getComputedStyle(within(right).getByText('1:30.00')).color).toBe(
      'rgb(35, 31, 32)', // overlay.nameInk
    );
    const run2 = within(right).getByTestId('vs-cell-run-2');
    expect(window.getComputedStyle(run2).backgroundColor).toBe(colors.overlay.plateName);
    expect(run2).toBeEmptyDOMElement();
    // jsdom normalizes a declared `text-shadow: none` to `rgba(0, 0, 0, 0)`,
    // while the empty cell still inherits the layout's authored footage shadow.
    expect(filled.textShadow).toBe('rgba(0, 0, 0, 0)');
    expect(filled.textShadow).not.toBe(window.getComputedStyle(run2).textShadow);
  });

  it('shows the freestyle judged breakdown + TOTAL per athlete', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'freestyle',
        round: 'final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ];
    const scores: Score[] = [
      {
        scoreId: 's1',
        compId: COMP,
        athleteId: 'a1',
        round: 'final',
        difficulty: 32.5,
        combo: 20,
        style: 18,
        bestTrick: 15,
        controlPenalty: 3,
        overall: 82.5,
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/scores')) return Promise.resolve(scores);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    await screen.findByText('Jane');
    const left = screen.getByTestId('vs-stats-left');
    // The five components + TOTAL for the scored athlete.
    expect(await within(left).findByText('32.50')).toBeInTheDocument(); // trick difficulty
    expect(within(left).getByText('20.00')).toBeInTheDocument(); // combo
    expect(within(left).getByText('3.00')).toBeInTheDocument(); // control penalty
    expect(within(left).getByText('82.50')).toBeInTheDocument(); // TOTAL
    // Every battle round shows the two battle-only rows.
    expect(within(left).getByText('CONTROL PENALTY')).toBeInTheDocument();
    expect(within(left).getByText('BEST TRICK')).toBeInTheDocument();
    // Freestyle reads scores, never the times endpoint.
    const paths = apiFetchMock.mock.calls.map(([p]: string[]) => p);
    expect(paths.some((p) => p.includes('/times'))).toBe(false);
  });

  it('drops the control-penalty and best-trick rows at qualification (freestyle)', async () => {
    const matches: Match[] = [
      {
        matchId: 'm1',
        compId: COMP,
        discipline: 'freestyle',
        round: 'qualification',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ];
    const scores: Score[] = [
      {
        scoreId: 's1',
        compId: COMP,
        athleteId: 'a1',
        round: 'qualification',
        difficulty: 30,
        combo: 20,
        style: 15,
        bestTrick: 0,
        controlPenalty: 0,
        overall: 65,
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/scores')) return Promise.resolve(scores);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs/qualification/male?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );

    await screen.findByText('Jane');
    const left = screen.getByTestId('vs-stats-left');
    expect(within(left).getByText('TRICK DIFFICULTY')).toBeInTheDocument();
    expect(within(left).getByText('TOTAL')).toBeInTheDocument();
    expect(within(left).queryByText('CONTROL PENALTY')).not.toBeInTheDocument();
    expect(within(left).queryByText('BEST TRICK')).not.toBeInTheDocument();
  });

  it('draws CONTROL PENALTY identically in the VS table and the score card', async () => {
    // Both freestyle surfaces render the shared ScoreCell, so the penalty cell
    // cannot drift back onto two treatments (the card used to wash it at 28%).
    const score: Score = {
      scoreId: 's1',
      compId: COMP,
      athleteId: 'a1',
      round: 'final',
      difficulty: 32.5,
      combo: 20,
      style: 18,
      bestTrick: 15,
      controlPenalty: 3,
      overall: 82.5,
    };
    const chrome = (cell: HTMLElement) => {
      const cs = window.getComputedStyle(cell);
      const numeral = cell.firstElementChild as HTMLElement;
      return {
        backgroundColor: cs.backgroundColor,
        borderTopStyle: cs.borderTopStyle,
        ink: window.getComputedStyle(numeral).color,
        text: numeral.textContent,
      };
    };

    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches'))
        return Promise.resolve([
          {
            matchId: 'm1',
            compId: COMP,
            discipline: 'freestyle',
            round: 'final',
            gender: 'male',
            position: 0,
            athlete1Id: 'a1',
            athlete2Id: 'a2',
          },
        ] satisfies Match[]);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/scores')) return Promise.resolve([score]);
      throw new Error(`unexpected ${path}`);
    });
    const vs = renderOverlay(
      `/stream/vs/final/male?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/vs/:round/:gender',
      <VsOverlay />,
    );
    await screen.findByText('32.50');
    const vsPenalty = chrome(
      within(screen.getByTestId('vs-stats-left')).getByTestId('vs-cell-controlPenalty'),
    );
    vs.unmount();

    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue([
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 0, overall: 82.5, score },
    ] satisfies RankedAthlete[]);
    renderOverlay(
      `/stream/scorecard/final/male?compId=${COMP}&token=tok-1`,
      '/stream/scorecard/:round/:gender',
      <ScoreCardOverlay />,
    );
    await screen.findByText('32.50');

    expect(chrome(screen.getByTestId('scorecard-cell-controlPenalty'))).toEqual(vsPenalty);
    expect(vsPenalty.backgroundColor).toBe('rgb(240, 78, 52)'); // race.stop, solid
    expect(vsPenalty.ink).toBe('rgb(255, 255, 255)');
  });
});

describe('StreamLayout title-safe frame', () => {
  const renderBrackets = () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve([]);
      if (path.includes('/athletes')) return Promise.resolve([athlete('a1', 'Jane Doe')]);
      throw new Error(`unexpected ${path}`);
    });
    return renderOverlay(
      `/stream/brackets/male?compId=${COMP}&token=tok-1`,
      '/stream/brackets/:gender',
      <BracketsOverlay />,
    );
  };

  it('insets every overlay 5% of the capture frame (design-system §7 rule 5)', () => {
    // Was a fixed 48px — only 2.5% wide / 4.4% tall at 1080p, inside the outer
    // 5% a broadcast chain may crop. Frame-relative, so 720p and 4K match.
    const { container } = renderBrackets();
    const style = window.getComputedStyle(container.firstElementChild as HTMLElement);
    expect(px(style.paddingLeft)).toBeCloseTo(vwPx('5vw'), 2); // 96px @1920
    expect(px(style.paddingRight)).toBeCloseTo(vwPx('5vw'), 2);
    expect(px(style.paddingTop)).toBeCloseTo(vhPx('5vh'), 2); // 54px @1080
    expect(px(style.paddingBottom)).toBeCloseTo(vhPx('5vh'), 2);
  });

  it('fits the 16:9 bracket canvas inside the title-safe content box', async () => {
    // At the full content-box WIDTH the 16:9 canvas is 1026px tall against a
    // 972px content box, so the bottom captions spilled past the inset. The
    // canvas takes the largest 16:9 rectangle the padded frame affords.
    // (jsdom can't compute the mixed-unit min()/calc(), so assert the rule.)
    renderBrackets();
    await screen.findByTestId('playoff-bracket');
    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('');
    expect(css).toContain('min(100%, calc((100vh - 2 * 5.000vh) * 16 / 9))');
  });
});

describe('BracketsOverlay', () => {
  it('renders the bracket from matches', async () => {
    const matches: Match[] = [
      {
        matchId: 'f1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/brackets/male?compId=${COMP}&token=tok-1`,
      '/stream/brackets/:gender',
      <BracketsOverlay />,
    );

    const bracket = await screen.findByTestId('playoff-bracket');
    // The final's two athletes land in the final-left/right slots (short names).
    expect(
      within(within(bracket).getByTestId('slot-box_final_l')).getByText('Jane'),
    ).toBeInTheDocument();
    expect(
      within(within(bracket).getByTestId('slot-box_final_r')).getByText('John'),
    ).toBeInTheDocument();

    const matchCall = apiFetchMock.mock.calls.find(([p]: string[]) => p.includes('/matches'));
    // No discipline in the URL → the overlay defaults to the speed bracket.
    expect(matchCall?.[0]).toContain('discipline=speed');

    // Titleless like the LAAX bracket masters — no plane heading on the tree.
    expect(screen.queryByText('MEN’S SPEED')).not.toBeInTheDocument();
  });

  it('falls back to the profile tree on an unknown variant (incl. the retired compact)', async () => {
    // ADR 0041: the photo-less compact variant retired (no SVG master), so a
    // stale `&variant=compact` OBS link renders the default profile tree.
    const matches: Match[] = [
      {
        matchId: 'f1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/brackets/male?compId=${COMP}&token=tok-1&variant=compact`,
      '/stream/brackets/:gender',
      <BracketsOverlay />,
    );

    const bracket = await screen.findByTestId('playoff-bracket');
    const finalL = within(bracket).getByTestId('slot-box_final_l');
    expect(within(finalL).getByText('Jane')).toBeInTheDocument();
    expect(within(finalL).getByTestId('athlete-card-photo')).toBeInTheDocument();
    expect(within(bracket).queryByTestId('compact-card-flag-strip')).not.toBeInTheDocument();
  });

  it('renders name-variant filled plates solid white with dark name, empty plates translucent', async () => {
    // Only the final is seeded → its two plates are filled, every other plate
    // (semis, quarters, small final, winner) stays an empty TBD slot.
    const matches: Match[] = [
      {
        matchId: 'f1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        roundName: 'Final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a1',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/brackets/male?compId=${COMP}&token=tok-1&variant=name`,
      '/stream/brackets/:gender',
      <BracketsOverlay />,
    );

    const bracket = await screen.findByTestId('playoff-bracket');

    // A FILLED plate flips to the solid filled fill (#FFFFFF, opaque white).
    const filled = within(bracket).getByTestId('slot-box_final_r');
    expect(window.getComputedStyle(filled).backgroundColor).toBe('rgb(255, 255, 255)');

    // …and its name is dark ink, not white-on-white (the bug). `John` is the
    // bold given-name span on the non-winner plate, so it carries the plate ink.
    const name = within(filled).getByText('John');
    const nameColor = window.getComputedStyle(name).color;
    expect(nameColor).not.toBe('rgb(255, 255, 255)');
    expect(nameColor).toBe('rgb(35, 31, 32)'); // --tl-overlay-name-ink (#231f20)

    // The winner's given name takes the DIMMED green — race.go is the edge
    // colour and only ~2.3:1 as ink on the solid white plate.
    const winnerName = within(within(bracket).getByTestId('slot-box_final_l')).getByText('Jane');
    expect(window.getComputedStyle(winnerName).color).toBe('rgb(46, 143, 80)'); // race.goDim

    // The filled name plate cancels the StreamLayout footage shadow → flat text.
    // The declaration sits on the AthleteName root span (parent of the name parts).
    // jsdom 29 reports the inherited footage shadow from getComputedStyle rather
    // than the element's own override, so assert the emotion-injected rule.
    const flatNameCss = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(flatNameCss).toContain('text-shadow:none');

    // An EMPTY plate (an unseeded semi slot) keeps the translucent white fill —
    // the names-language 35% white (`Name Brackets.svg` opacity .35), not the
    // profile boxes' 30%.
    const empty = within(bracket).getByTestId('slot-box_q_1_3');
    expect(window.getComputedStyle(empty).backgroundColor).toBe(colors.overlay.plateName);

    // The art's 5px plate stroke, frame-relative like the ranking plates' —
    // the same refVh(5) both name-plate families now carry.
    expect(px(window.getComputedStyle(filled).borderTopWidth)).toBeCloseTo(vhPx(refVh(5)), 2);

    // Section labels are the art's PlacardNext-Medium → Oswald 500 with the
    // tight art tracking, not the g2 pass's 800/spread caps.
    const finalsLabel = within(bracket).getByTestId('bracket-label-FINALS');
    const labelStyle = window.getComputedStyle(finalsLabel);
    expect(labelStyle.fontWeight).toBe('500');
    expect(px(labelStyle.letterSpacing)).toBeCloseTo(
      emPx(overlayArt.headingTracking, finalsLabel),
      2,
    );
  });

  it('renders name-variant undecided slots with the question-mark mark and captions the bronze bar 3RD PLACE', async () => {
    // A decided small final + nothing else: the bronze advancement bar fills
    // while the rest of the tree stays TBD.
    const matches: Match[] = [
      {
        matchId: 'sf1',
        compId: COMP,
        discipline: 'speed',
        round: 'small_final',
        roundName: 'Small final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        winnerId: 'a2',
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/brackets/male?compId=${COMP}&token=tok-1&variant=name`,
      '/stream/brackets/:gender',
      <BracketsOverlay />,
    );

    const bracket = await screen.findByTestId('playoff-bracket');
    // The bronze winner advances into the captioned bar.
    expect(within(bracket).getByTestId('bracket-label-3RD PLACE')).toBeInTheDocument();
    expect(
      within(within(bracket).getByTestId('slot-small_winner')).getByText('John'),
    ).toBeInTheDocument();
    // Undecided plates now carry the shared bold UnknownAthlete mark (the same
    // "to be decided" placeholder as the profile cards) in place of the former
    // "TBD" word — a thin Material "?" once read as unloaded content, but the
    // custom glyph's weight reads as intentional. White (overlay.stroke), the
    // structural-mark colour.
    const empty = within(bracket).getByTestId('slot-box_q_1_3');
    expect(within(empty).getByTestId('slot-unknown-box_q_1_3')).toBeInTheDocument();
    expect(within(empty).queryByText('TBD')).not.toBeInTheDocument();
  });

  it('requests the freestyle bracket when discipline=freestyle is in the URL', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve([]);
      if (path.includes('/athletes')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/brackets/male?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/brackets/:gender',
      <BracketsOverlay />,
    );

    await screen.findByTestId('playoff-bracket');
    const matchCall = apiFetchMock.mock.calls.find(([p]: string[]) => p.includes('/matches'));
    expect(matchCall?.[0]).toContain('discipline=freestyle');
  });
});

describe('pickMatch', () => {
  const m = (matchId: string, position: number, extra: Partial<Match> = {}): Match => ({
    matchId,
    compId: COMP,
    discipline: 'speed',
    round: 'quarter',
    gender: 'male',
    position,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
    ...extra,
  });

  it('prefers an explicit matchId over everything', () => {
    const matches = [m('m1', 0), m('m2', 1)];
    expect(pickMatch(matches, 'm2', { matchId: 'm1' } as never)?.matchId).toBe('m2');
  });

  it('uses the board selection when it names a match in the list', () => {
    const matches = [m('m1', 0, { winnerId: 'a1' }), m('m2', 1)];
    const selection = { matchId: 'm1' } as never;
    // m1 has a winner so the bracket fallback would skip it; the board wins.
    expect(pickMatch(matches, undefined, selection)?.matchId).toBe('m1');
  });

  it('falls back to bracket position when the selection match is not in the list', () => {
    const matches = [m('m1', 0, { winnerId: 'a1' }), m('m2', 1)];
    const selection = { matchId: 'not-here' } as never;
    expect(pickMatch(matches, undefined, selection)?.matchId).toBe('m2');
  });

  it('falls back to the first winner-less match by position with no selection', () => {
    const matches = [m('m2', 1), m('m1', 0, { winnerId: 'a1' })];
    expect(pickMatch(matches, undefined, null)?.matchId).toBe('m2');
  });
});

describe('matchSideOrder (board lane swap → card sides, ADR 0044)', () => {
  const match = {
    matchId: 'm1',
    compId: COMP,
    discipline: 'speed',
    round: 'final',
    gender: 'male',
    position: 0,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
  } as Match;

  const sel = (extra: Partial<import('app/hooks/useWebSocket').LiveSelection>) =>
    ({ discipline: 'speed', gender: 'male', round: 'final', matchId: null, ...extra }) as never;

  it('defaults to the persisted match order', () => {
    expect(matchSideOrder(match, null)).toEqual(['a1', 'a2']);
    // A selection for another match must not re-order this card.
    expect(
      matchSideOrder(match, sel({ matchId: 'other', athlete1Id: 'a2', athlete2Id: 'a1' })),
    ).toEqual(['a1', 'a2']);
  });

  it('mirrors a pure lane swap when the board is on this match', () => {
    expect(
      matchSideOrder(match, sel({ matchId: 'm1', athlete1Id: 'a2', athlete2Id: 'a1' })),
    ).toEqual(['a2', 'a1']);
  });

  it('ignores a non-transposition (hand-edited lanes) — persisted order wins', () => {
    expect(
      matchSideOrder(match, sel({ matchId: 'm1', athlete1Id: 'a9', athlete2Id: 'a1' })),
    ).toEqual(['a1', 'a2']);
    expect(
      matchSideOrder(match, sel({ matchId: 'm1', athlete1Id: 'a1', athlete2Id: 'a2' })),
    ).toEqual(['a1', 'a2']);
  });
});

describe('pickLiveMatch (round-following VS)', () => {
  const m = (
    matchId: string,
    round: MatchRound,
    position: number,
    extra: Partial<Match> = {},
  ): Match => ({
    matchId,
    compId: COMP,
    discipline: 'speed',
    round,
    gender: 'male',
    position,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
    ...extra,
  });

  const sel = (extra: Partial<import('app/hooks/useWebSocket').LiveSelection>) =>
    ({ discipline: 'speed', gender: 'male', matchId: null, ...extra }) as never;

  it('follows the board selection across rounds, ignoring the URL round entirely', () => {
    const matches = [m('q1', 'quarter', 0), m('f1', 'final', 0)];
    // Board sits on a quarter match; the card must jump to it even though a
    // later-round (final) match exists.
    expect(pickLiveMatch(matches, sel({ matchId: 'q1' }), 'male', 'speed')?.matchId).toBe('q1');
  });

  it('ignores a selection for another gender/discipline', () => {
    const matches = [m('q1', 'quarter', 0, { winnerId: 'a1' }), m('h1', 'half', 0)];
    // Female pick → not followed; falls back to the first undecided (h1).
    expect(
      pickLiveMatch(matches, sel({ matchId: 'q1', gender: 'female' }), 'male', 'speed')?.matchId,
    ).toBe('h1');
    // Freestyle pick on a speed card → not followed either.
    expect(
      pickLiveMatch(matches, sel({ matchId: 'q1', discipline: 'freestyle' }), 'male', 'speed')
        ?.matchId,
    ).toBe('h1');
  });

  it('falls back to the first undecided match in bracket (round, then position) order', () => {
    // Deliberately shuffled: a decided final, an undecided quarter, an undecided half.
    const matches = [
      m('f1', 'final', 0, { winnerId: 'a1' }),
      m('h1', 'half', 0),
      m('q1', 'quarter', 0),
    ];
    expect(pickLiveMatch(matches, null, 'male', 'speed')?.matchId).toBe('q1');
  });

  it('falls back to the final (last in bracket order) when every match is decided', () => {
    const matches = [
      m('q1', 'quarter', 0, { winnerId: 'a1' }),
      m('f1', 'final', 0, { winnerId: 'a2' }),
    ];
    expect(pickLiveMatch(matches, null, 'male', 'speed')?.matchId).toBe('f1');
  });
});

describe('VsLiveOverlay (round-following)', () => {
  it('follows the board across rounds and scopes the result to the live match round', async () => {
    const matches: Match[] = [
      {
        matchId: 'q1',
        compId: COMP,
        discipline: 'speed',
        round: 'quarter',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
      {
        matchId: 'f1',
        compId: COMP,
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        position: 0,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    ];
    // The board is live on the FINAL — the card must show the final's times, not
    // the quarter's, even though the URL carries no round at all.
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: 'f1',
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    };
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) {
        // The overlay must have scoped /times to the final (the live match's round).
        expect(path).toContain('round=final');
        return Promise.resolve([
          {
            timeId: 't1',
            compId: COMP,
            athleteId: 'a1',
            round: 'final',
            timeMs: 83_450,
            startTime: 1,
          },
        ] as Time[]);
      }
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/vs-live/male?compId=${COMP}&token=tok-1`,
      '/stream/vs-live/:gender',
      <VsLiveOverlay />,
    );

    expect(await screen.findByText('1:23.45')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });
});

describe('WinnerOverlay', () => {
  const winnerMatch = (extra: Partial<Match> = {}): Match => ({
    matchId: 'm1',
    compId: COMP,
    discipline: 'speed',
    round: 'final',
    roundName: 'Final',
    gender: 'male',
    position: 0,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
    winnerId: 'a1',
    ...extra,
  });

  it('shows the decided match winner card under a WINNER banner', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve([winnerMatch()]);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/winner/final/male?compId=${COMP}&token=tok-1`,
      '/stream/winner/:round/:gender',
      <WinnerOverlay />,
    );

    // CSS uppercases the banner; the DOM text stays "Winner".
    expect(await screen.findByText('Winner')).toBeInTheDocument();
    // Captionless — the card no longer names the title that was won.
    expect(screen.queryByText('MEN’S SPEED — FINAL')).not.toBeInTheDocument();
    // The winner's card (bold first / light last); the loser is not on it.
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
    // No /times or /scores fetch — the card is identity-only (no result numeral).
    const paths = apiFetchMock.mock.calls.map(([p]: string[]) => p);
    expect(paths.some((p) => p.includes('/times'))).toBe(false);
    expect(paths.some((p) => p.includes('/scores'))).toBe(false);

    // The winner card is the shared v2 panel (ADR 0029): the same 298.81×498.02
    // @1080p frame + 10px lower-third edge (0.926vh) as VS, so the card never
    // pops in size when the broadcast cuts between the sibling lower-thirds.
    const card = screen.getByTestId('athlete-card-photo').parentElement as HTMLElement;
    expect(px(window.getComputedStyle(card).borderTopWidth)).toBeCloseTo(vhPx('0.926vh'), 2);
    const frame = window.getComputedStyle(card.parentElement as HTMLElement);
    expect(px(frame.width)).toBeCloseTo(vwPx('15.563vw'), 2);
    expect(px(frame.height)).toBeCloseTo(vhPx('46.113vh'), 2);
  });

  it('follows the board selection to a different decided match', async () => {
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: 'm2',
        athlete1Id: 'a3',
        athlete2Id: 'a4',
      },
    };
    const matches: Match[] = [
      winnerMatch(),
      winnerMatch({
        matchId: 'm2',
        position: 1,
        athlete1Id: 'a3',
        athlete2Id: 'a4',
        winnerId: 'a4',
      }),
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(matches);
      if (path.includes('/athletes'))
        return Promise.resolve([
          athlete('a1', 'Jane Doe'),
          athlete('a2', 'John Roe'),
          athlete('a3', 'Mary Moe'),
          athlete('a4', 'Mark Loe'),
        ]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/winner/final/male?compId=${COMP}&token=tok-1`,
      '/stream/winner/:round/:gender',
      <WinnerOverlay />,
    );

    // The board's match (m2) wins → its winner a4 (Mark) shows, not m1's a1.
    expect(await screen.findByText('Mark')).toBeInTheDocument();
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  it('reports empty (blank on camera) while the match has no winner yet', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve([winnerMatch({ winnerId: undefined })]);
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/winner/final/male?compId=${COMP}&token=tok-1`,
      '/stream/winner/:round/:gender',
      <WinnerOverlay />,
    );

    const marker = await screen.findByTestId('stream-status');
    await vi.waitFor(() => expect(marker).toHaveAttribute('data-stream-status', 'empty'));
    expect(screen.queryByText('Winner')).not.toBeInTheDocument();
  });

  it('fails safe (error) for an invalid round', () => {
    renderOverlay(
      `/stream/winner/bogus/male?compId=${COMP}&token=tok-1`,
      '/stream/winner/:round/:gender',
      <WinnerOverlay />,
    );
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('RoundsSummaryOverlay (best-of-3 series story)', () => {
  const seriesMatch: Match[] = [
    {
      matchId: 'm1',
      compId: COMP,
      discipline: 'speed',
      round: 'final',
      roundName: 'Final',
      gender: 'male',
      position: 0,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    },
  ];
  const roster = () => [athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')];
  const mockComp = () =>
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/matches')) return Promise.resolve(seriesMatch);
      if (path.includes('/athletes')) return Promise.resolve(roster());
      throw new Error(`unexpected ${path}`);
    });

  it('anchors the tally to the athletes, one identity card each', async () => {
    // 2–1: athlete1 won two runs, athlete2 one — three resolved runs so far.
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: 'm1',
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        runWins: { 1: 2, 2: 1 },
      },
    };
    mockComp();

    renderOverlay(
      `/stream/rounds-summary/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rounds-summary/:round/:gender',
      <RoundsSummaryOverlay />,
    );

    // Name-anchored tally, "JANE 2 – 1 JOHN": run order isn't on the wire
    // (ADR 0017), so the digits anchor to the athletes, not a chronology.
    const tally = await screen.findByTestId('series-tally');
    expect(tally.textContent).toBe('Jane2–1John');
    // The "… — BEST OF 3" caption sits one step up from the old 24px
    // (overlay-typography-polish): refVh(32).
    expect(
      px(window.getComputedStyle(screen.getByTestId('rounds-summary-caption')).fontSize),
    ).toBeCloseTo(vhPx('2.963vh'), 2);
    // The leading count is race.go green; the trailing count is overlay-label
    // white — ink.hi is the on-white-plate tier and vanished on keyed footage.
    expect(window.getComputedStyle(screen.getByTestId('series-wins-1')).color).toBe(
      'rgb(101, 188, 123)',
    );
    expect(window.getComputedStyle(screen.getByTestId('series-wins-2')).color).toBe(
      'rgb(255, 255, 255)',
    );
    // ONE card per athlete — duplicate winner cards read as a render glitch.
    expect(screen.getAllByTestId('athlete-card-photo')).toHaveLength(2);
    expect(screen.getAllByText('Doe')).toHaveLength(1);
    // Pure series story — no /times or /scores result fetch.
    const paths = apiFetchMock.mock.calls.map(([p]: string[]) => p);
    expect(paths.some((p) => p.includes('/times'))).toBe(false);
    expect(paths.some((p) => p.includes('/scores'))).toBe(false);
    // Every series card is the shared v2 panel (ADR 0029), same as VS/winner.
    for (const photo of screen.getAllByTestId('athlete-card-photo')) {
      const frame = window.getComputedStyle(photo.parentElement?.parentElement as HTMLElement);
      expect(px(frame.width)).toBeCloseTo(vwPx('15.563vw'), 2);
      expect(px(frame.height)).toBeCloseTo(vhPx('46.113vh'), 2);
    }
  });

  it('reports empty (blank on camera) until the first run resolves', async () => {
    // A board selection with a pristine 0–0 tally: no run decided yet.
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: 'm1',
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        runWins: { 1: 0, 2: 0 },
      },
    };
    mockComp();

    renderOverlay(
      `/stream/rounds-summary/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rounds-summary/:round/:gender',
      <RoundsSummaryOverlay />,
    );

    const marker = await screen.findByTestId('stream-status');
    await vi.waitFor(() => expect(marker).toHaveAttribute('data-stream-status', 'empty'));
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  it('paints nothing until the board pushes a selection', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderOverlay(
      `/stream/rounds-summary/final/male?compId=${COMP}&token=tok-1`,
      '/stream/rounds-summary/:round/:gender',
      <RoundsSummaryOverlay />,
    );
    // No selection (and no match) → empty (transparent), not an on-camera error.
    const marker = await screen.findByTestId('stream-status');
    await vi.waitFor(() => expect(marker).toHaveAttribute('data-stream-status', 'empty'));
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  it('fails safe (error) for an invalid round', () => {
    renderOverlay(
      `/stream/rounds-summary/bogus/male?compId=${COMP}&token=tok-1`,
      '/stream/rounds-summary/:round/:gender',
      <RoundsSummaryOverlay />,
    );
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The x an SVO card's outer edge lands on: its own side margin plus the
 * title-safe inset `StreamLayout` already pays. It must equal the
 * `/stream/timer` lane block's corner inset — the two overlays are composited
 * in the same bottom corner, and `OVERLAY_LANE.inset` is the one owner of it
 * (the producer-facing number the manual documents).
 */
const cardOuterEdgePx = (shell: HTMLElement, side: 'marginLeft' | 'marginRight'): number =>
  px(window.getComputedStyle(shell)[side]) + vwPx(refVw(STREAM_INSET_X_PX));

const timerCornerInsetPx = (): number => vwPx(refVw(OVERLAY_LANE.inset));

describe('SvoOverlay (identity card)', () => {
  it('renders the athlete identity (name + flag) for the URL athleteId', async () => {
    apiFetchMock.mockResolvedValue([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);

    renderOverlay(
      `/stream/svo/a1?compId=${COMP}&token=tok-1`,
      '/stream/svo/:athleteId',
      <SvoOverlay />,
    );

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    // Pure identity — no result numeral, no opponent.
    expect(screen.queryByText('John')).not.toBeInTheDocument();
    const [path, opts] = apiFetchMock.mock.calls[0];
    expect(path).toContain(`/competitions/${COMP}/athletes`);
    expect(opts).toMatchObject({ readToken: 'tok-1' });
  });

  it('reports empty (blank on camera) for an unknown athleteId', async () => {
    apiFetchMock.mockResolvedValue([athlete('a1', 'Jane Doe')]);
    renderOverlay(
      `/stream/svo/ghost?compId=${COMP}&token=tok-1`,
      '/stream/svo/:athleteId',
      <SvoOverlay />,
    );
    const marker = await screen.findByTestId('stream-status');
    await vi.waitFor(() => expect(marker).toHaveAttribute('data-stream-status', 'empty'));
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  it('aligns the card edge with the timer lower-third corner', async () => {
    apiFetchMock.mockResolvedValue([athlete('a1', 'Jane Doe')]);
    renderOverlay(
      `/stream/svo/a1?compId=${COMP}&token=tok-1`,
      '/stream/svo/:athleteId',
      <SvoOverlay />,
    );
    const shell = await screen.findByTestId('svo-card-shell');
    expect(cardOuterEdgePx(shell, 'marginLeft')).toBeCloseTo(timerCornerInsetPx(), 3);
  });
});

describe('SvoLiveOverlay (board-driven card)', () => {
  it('shows the side-1 athlete + best time from the live selection (speed)', async () => {
    wsState.lastJsonMessage = selectionMessage({
      discipline: 'speed',
      round: 'final',
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
    const times: Time[] = [
      { timeId: 't1', compId: COMP, athleteId: 'a1', round: 'final', timeMs: 83_450, startTime: 1 },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve(times);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/svo-live/1?compId=${COMP}&token=tok-1`,
      '/stream/svo-live/:side',
      <SvoLiveOverlay />,
    );

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('1:23.45')).toBeInTheDocument();
    // Side 1 only — the opponent is not on this card.
    expect(screen.queryByText('John')).not.toBeInTheDocument();
    // Speed plane never reads scores.
    const paths = apiFetchMock.mock.calls.map(([p]: string[]) => p);
    expect(paths.some((p) => p.includes('/scores'))).toBe(false);
  });

  it('shows the side-2 athlete + freestyle overall from the live selection', async () => {
    wsState.lastJsonMessage = selectionMessage({
      discipline: 'freestyle',
      round: 'final',
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
    const scores: Score[] = [
      {
        scoreId: 's2',
        compId: COMP,
        athleteId: 'a2',
        round: 'final',
        difficulty: 0,
        combo: 0,
        style: 0,
        bestTrick: 0,
        controlPenalty: 0,
        overall: 27.5,
      },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/scores')) return Promise.resolve(scores);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/svo-live/2?compId=${COMP}&token=tok-1&discipline=freestyle`,
      '/stream/svo-live/:side',
      <SvoLiveOverlay />,
    );

    expect(await screen.findByText('John')).toBeInTheDocument();
    expect(screen.getByText('27.50')).toBeInTheDocument();
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  it('suppresses the result line (no em-dash) when the side has no result yet', async () => {
    wsState.lastJsonMessage = selectionMessage({
      discipline: 'speed',
      round: 'final',
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderOverlay(
      `/stream/svo-live/1?compId=${COMP}&token=tok-1`,
      '/stream/svo-live/:side',
      <SvoLiveOverlay />,
    );

    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('paints nothing until the board pushes a selection', () => {
    apiFetchMock.mockResolvedValue([]);
    renderOverlay(
      `/stream/svo-live/1?compId=${COMP}&token=tok-1`,
      '/stream/svo-live/:side',
      <SvoLiveOverlay />,
    );
    // No selection yet → no athlete query fires; the card is empty (transparent),
    // not an on-camera error — a valid card simply waiting for the first push.
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'empty');
  });

  it('fails safe (error) for an invalid side', () => {
    renderOverlay(
      `/stream/svo-live/3?compId=${COMP}&token=tok-1`,
      '/stream/svo-live/:side',
      <SvoLiveOverlay />,
    );
    expect(screen.getByTestId('stream-status')).toHaveAttribute('data-stream-status', 'error');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('aligns both sides with the timer lower-third corners', async () => {
    const renderSide = (side: 1 | 2) => {
      wsState.lastJsonMessage = selectionMessage({
        discipline: 'speed',
        round: 'final',
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      });
      apiFetchMock.mockImplementation((path: string) =>
        path.includes('/athletes')
          ? Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')])
          : Promise.resolve([]),
      );
      return renderOverlay(
        `/stream/svo-live/${side}?compId=${COMP}&token=tok-1`,
        '/stream/svo-live/:side',
        <SvoLiveOverlay />,
      );
    };

    const { unmount } = renderSide(1);
    expect(
      cardOuterEdgePx(await screen.findByTestId('svo-live-card-shell'), 'marginLeft'),
    ).toBeCloseTo(timerCornerInsetPx(), 3);
    unmount();

    renderSide(2);
    expect(
      cardOuterEdgePx(await screen.findByTestId('svo-live-card-shell'), 'marginRight'),
    ).toBeCloseTo(timerCornerInsetPx(), 3);
  });
});

describe('AthleteCard (photo-less fallback)', () => {
  it('fills the portrait region with an opaque initials plate when photoUrl is absent', () => {
    const a = athlete('a1', 'Jane Doe'); // the test athlete carries no photoUrl
    render(<AthleteCard athlete={a} />);

    const photo = screen.getByTestId('athlete-card-photo');
    // No keyed-out hole: the region is a solid OPAQUE fill (not the translucent
    // overlay.plate that voids on a chroma/transparent broadcast bg) and carries
    // no portrait backgroundImage.
    const style = window.getComputedStyle(photo);
    // No portrait image (jsdom 29 reports the initial backgroundImage as 'none').
    expect(style.backgroundImage).not.toContain('url(');
    expect(style.backgroundColor).toBe('rgb(255, 255, 255)'); // overlay.plateFilled, opaque

    // The initials read as the intentional plate content (first + last initial).
    expect(within(photo).getByText('JD')).toBeInTheDocument();

    // The name + flag foot are unchanged.
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.getByTestId('athlete-card-flag-strip')).toBeInTheDocument();

    // Dark-ink-on-white-plate text cancels the StreamLayout footage shadow so the
    // card reads as flat plate text, not a dark double-image (the leak fix). An
    // explicit text-shadow: none computes to 'rgba(0, 0, 0, 0)' under jsdom 29, so
    // assert the shadow carries no offset rather than matching the literal 'none'.
    expect(window.getComputedStyle(within(photo).getByText('JD')).textShadow).not.toContain('px');
    expect(window.getComputedStyle(screen.getByText('Jane')).textShadow).not.toContain('px');
    expect(window.getComputedStyle(screen.getByText('Doe')).textShadow).not.toContain('px');
  });

  it('cancels the footage shadow on the result numeral', () => {
    render(<AthleteCard athlete={athlete('a1', 'Jane Doe')} result="1:23.45" />);
    expect(window.getComputedStyle(screen.getByText('1:23.45')).textShadow).not.toContain('px');
  });

  it('keeps the portrait backgroundImage when a photoUrl is present', () => {
    const a = { ...athlete('a1', 'Jane Doe'), photoUrl: 'https://cdn/photo.jpg' };
    render(<AthleteCard athlete={a} />);

    const photo = screen.getByTestId('athlete-card-photo');
    expect(window.getComputedStyle(photo).backgroundImage).toContain('https://cdn/photo.jpg');
    // No initials overlay when the portrait is present.
    expect(within(photo).queryByText('JD')).not.toBeInTheDocument();
  });

  it('fills the foot with a single wide flag block (client card art for USA)', () => {
    const a = athlete('a1', 'Jane Doe'); // single country (USA → covered bespoke art)
    render(<AthleteCard athlete={a} />);

    // WideFlag renders one block for a single nationality; USA has delivered card
    // art, so the block is the inline stretched SVG (not a flag-icons background).
    const flag = within(screen.getByTestId('athlete-card-flag-strip')).getByRole('img');
    expect(flag).toHaveAttribute('aria-label', 'us');
    expect(flag.querySelector('svg')).not.toBeNull();
  });

  it('abuts two wide flag blocks for a dual-nationality foot flag', () => {
    const a = { ...athlete('a1', 'Jane Doe'), country2: 'CAN' };
    render(<AthleteCard athlete={a} />);

    // A dual-nationality athlete gets two abutting blocks (USA + CAN, both covered).
    const flags = within(screen.getByTestId('athlete-card-flag-strip')).getAllByRole('img');
    expect(flags).toHaveLength(2);
  });

  it('keeps the diagonal name band clear of the foot flag strip', () => {
    const a = athlete('a1', 'Jane Doe');
    const { container } = render(<AthleteCard athlete={a} />);

    // The white band must stop ABOVE the strip so it never paints over the flag
    // (the second compounding cause of the broken render). Its bottom edge is
    // raised by the strip height rather than anchored to the card foot (bottom:0).
    const band = container.querySelector('[data-band]') as HTMLElement;
    expect(band).not.toBeNull();
    expect(window.getComputedStyle(band).bottom).not.toBe('0px');
  });
});

describe('overlay card metrics (frame-relative rules)', () => {
  it('scales the type floor with the capture frame instead of pinning raw px', () => {
    // The floor is a 1080p legibility metric, so it belongs in the refVh family
    // like every other overlay font size (ADR 0034 §4). As a hard px value it
    // outran the shrink-to-fit wherever the canvas is smaller than the capture
    // frame — on the ~1150px admin bracket preview every narrow name started at
    // the full floor and was scaled back by its own name length, so sibling
    // quarter cards read as a size lottery the broadcast render never shows.
    expect(overlayTypeFloor).toBe(refVh(OVERLAY_TYPE_FLOOR_PX));
  });

  it('lands the type floor on the 20px broadcast text minimum at 1920x1080', () => {
    // 16px sat under the usual 20-24px broadcast minimum and the quarter/semi
    // profile-box names sat exactly on it (overlay-type-floor-broadcast-min).
    const restore = pinViewport(1920, 1080);
    expect(vhPx(overlayTypeFloor)).toBeCloseTo(20, 2);
    restore();
  });

  it('never lays out an overlay card gap as a percentage vertical margin', () => {
    // A `%` margin — top or bottom — resolves against the containing block's
    // WIDTH, so a gap written that way tracks the wrong axis and collapses on a
    // shrink-wrapped card (`athlete-card-gap-units`). The overlay cards are
    // container-query boxes: vertical gaps are `cqh`.
    const dir = resolve(process.cwd(), 'src/app/pages/Stream');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) =>
        /\b(mt|mb|my|marginTop|marginBottom)\s*:\s*['"`][\d.]+%/.test(
          readFileSync(resolve(dir, f), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
