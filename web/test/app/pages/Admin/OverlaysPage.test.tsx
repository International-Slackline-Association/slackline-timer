import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { ApiError } from 'app/api/client';
import { OverlaysPage } from 'app/pages/Admin/OverlaysPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

/**
 * The page now also runs the rankings/matches queries (for the off-air status
 * panel), so the mock must answer those GETs with arrays — only the read-token
 * POST returns the token object. `tokenResult` lets a test inject a token or an
 * error for the mint/revoke path while the status queries stay well-formed.
 */
const mockApi = (
  tokenResult: unknown | (() => Promise<unknown>),
  data: { rankings?: unknown[]; matches?: unknown[]; athletes?: unknown[] } = {},
) =>
  apiFetchMock.mockImplementation((path: string) => {
    if (path.includes('/rankings')) return Promise.resolve(data.rankings ?? []);
    if (path.includes('/athletes')) return Promise.resolve(data.athletes ?? []);
    if (path.includes('/matches')) return Promise.resolve(data.matches ?? []);
    return typeof tokenResult === 'function'
      ? (tokenResult as () => Promise<unknown>)()
      : Promise.resolve(tokenResult);
  });

const renderPage = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedCompetitionProvider>
          <OverlaysPage />
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('OverlaysPage', () => {
  it('prompts to select a competition when none is selected', () => {
    renderPage(null);
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('mints a token and builds overlay URLs carrying it', async () => {
    mockApi({ token: 'tok-123', expiresAt: 1_900_000_000_000 });
    renderPage(COMP);

    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/read-tokens`, {
        method: 'POST',
      }),
    );

    // The Speed rankings link embeds the comp + token and carries no discipline
    // param (speed is the overlay default); default round/gender = final/male.
    const speedRankings = (await screen.findByDisplayValue(
      /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123$/,
    )) as HTMLInputElement;
    expect(speedRankings.value).toContain(`compId=${COMP}`);
    expect(speedRankings.value).toContain('token=tok-123');
    expect(screen.getByDisplayValue(/\/stream\/timer\?sessionId=/)).toBeInTheDocument();

    // The rankings overlay is minted in both LAAX layouts: the name plates
    // (no &variant) and the top-4 profile-card cut (&variant=profile).
    expect(
      screen.getByDisplayValue(
        /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123&variant=profile$/,
      ),
    ).toBeInTheDocument();

    // A Freestyle section repeats the links with &discipline=freestyle appended.
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.getByText('Freestyle')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/\/stream\/rankings\/final\/male.*&discipline=freestyle$/),
    ).toBeInTheDocument();
    // The bracket is minted in both LAAX layouts: the default photo `profile`
    // tree (no &variant) and the name-only tree (&variant=name), so operators
    // pick the layout in-UI instead of hand-editing the URL. The photo-free
    // compact leg retired with its variant (ADR 0041).
    expect(
      screen.getByDisplayValue(/\/stream\/brackets\/male\?compId=worlds-2026&token=tok-123$/),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        /\/stream\/brackets\/male\?compId=worlds-2026&token=tok-123&variant=name$/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/variant=compact/)).not.toBeInTheDocument();
    // The full-screen athlete display is freestyle-only: exactly one link,
    // minted in the Freestyle set (getBy* would throw on a speed duplicate).
    expect(
      screen.getByDisplayValue(
        /\/stream\/athletes-freestyle\?compId=worlds-2026&token=tok-123&discipline=freestyle$/,
      ),
    ).toBeInTheDocument();
    // The board-driven SVO (live) links are minted per side, per discipline.
    expect(
      screen.getByDisplayValue(/\/stream\/svo-live\/1\?compId=worlds-2026&token=tok-123$/),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/\/stream\/svo-live\/2\?compId=worlds-2026&token=tok-123$/),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/\/stream\/svo-live\/1.*&discipline=freestyle$/),
    ).toBeInTheDocument();
  });

  const seedCachedToken = (token: string, storedAt: number, expiresAt: number) =>
    window.localStorage.setItem(
      `speedline.overlayReadToken.${COMP}`,
      JSON.stringify({ token, expiresAt, storedAt }),
    );

  it('restores a cached token and shows the links without minting', async () => {
    mockApi({ token: 'should-not-be-used', expiresAt: 1_900_000_000_000 });
    // Fresh cache (just stored, far-future expiry) → inside the first half.
    seedCachedToken('tok-cached', Date.now(), Date.now() + 10 * 24 * 3_600_000);
    renderPage(COMP);

    // The links appear straight away, carrying the cached token — no click.
    expect(
      await screen.findByDisplayValue(
        /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-cached$/,
      ),
    ).toBeInTheDocument();
    // …and no read-token POST was fired to mint a new one.
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      `/competitions/${COMP}/read-tokens`,
      expect.anything(),
    );
    // The generate button relabels to "Regenerate" once a token is present.
    expect(screen.getByRole('button', { name: /regenerate overlay links/i })).toBeInTheDocument();
  });

  describe('copied marker', () => {
    const renderLinks = async () => {
      mockApi({ token: 'unused', expiresAt: 1_900_000_000_000 });
      seedCachedToken('tok-cached', Date.now(), Date.now() + 10 * 24 * 3_600_000);
      renderPage(COMP);
      await screen.findByDisplayValue(/\/stream\/rankings\/final\/male\?.*token=tok-cached$/);
    };
    const clickCopy = (name: string, index = 0) =>
      act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name })[index]);
      });
    const copyRankings = () => clickCopy('Copy Rankings link');
    const copiedMarkers = () => screen.queryAllByText(/copied!/);
    // jsdom ships no Clipboard API, which is also what an insecure (plain-http) origin looks like.
    const stubClipboard = (writeText: (text: string) => Promise<void>) =>
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    beforeEach(() => stubClipboard(vi.fn().mockResolvedValue(undefined)));
    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('marks the link copied only once the clipboard write resolves', async () => {
      await renderLinks();
      let resolveWrite = () => {};
      const writeText = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );
      stubClipboard(writeText);

      await copyRankings();
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/token=tok-cached$/));
      expect(copiedMarkers()).toHaveLength(0);

      await act(async () => resolveWrite());
      expect(copiedMarkers()).not.toHaveLength(0);
    });

    describe('when the copy fails', () => {
      const failedField = () =>
        screen.getAllByLabelText(/^Rankings — copy failed, press Ctrl\+C$/)[0] as HTMLInputElement;
      const expectSelected = (input: HTMLInputElement) => {
        expect(input).toHaveFocus();
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(input.value.length);
      };

      it('selects the link for Ctrl+C when the write is rejected', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
          await renderLinks();
          stubClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));

          await copyRankings();
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(copiedMarkers()).toHaveLength(0);
          expectSelected(failedField());
          expect(unhandled).not.toHaveBeenCalled();
        } finally {
          process.off('unhandledRejection', unhandled);
        }
      });

      it('selects the link for Ctrl+C when the origin exposes no clipboard', async () => {
        Reflect.deleteProperty(navigator, 'clipboard');
        await renderLinks();

        await copyRankings();

        expect(copiedMarkers()).toHaveLength(0);
        expectSelected(failedField());
      });
    });

    it('drops the marker when the pickers rebuild the copied URL', async () => {
      await renderLinks();
      await copyRankings();
      expect(copiedMarkers()).not.toHaveLength(0);

      fireEvent.change(screen.getByLabelText(/^round$/i), { target: { value: 'half' } });
      await screen.findByDisplayValue(
        /\/stream\/rankings\/half\/male\?compId=worlds-2026&token=tok-cached$/,
      );
      expect(copiedMarkers()).toHaveLength(0);
    });

    it('drops every marker when the background changes', async () => {
      await renderLinks();
      await copyRankings();
      await clickCopy('Copy Final standings link', 1);
      expect(copiedMarkers()).not.toHaveLength(0);

      fireEvent.change(screen.getByLabelText(/background/i), { target: { value: '&bg=key' } });
      await screen.findByDisplayValue(
        /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-cached&bg=key$/,
      );
      expect(copiedMarkers()).toHaveLength(0);
    });

    it('fades the marker back to the plain label within 3s', async () => {
      await renderLinks();
      vi.useFakeTimers();
      await copyRankings();
      expect(copiedMarkers()).not.toHaveLength(0);

      act(() => vi.advanceTimersByTime(3_000));
      expect(copiedMarkers()).toHaveLength(0);
    });
  });

  it('ignores a cached token past half its lifetime', () => {
    mockApi({ token: 'tok-new', expiresAt: 1_900_000_000_000 });
    // storedAt in the distant past, expiry barely ahead → midpoint long gone.
    seedCachedToken('tok-stale', 0, Date.now() + 1000);
    renderPage(COMP);

    // No links yet: the stale cache is treated as absent, awaiting a fresh mint.
    expect(screen.queryByDisplayValue(/token=tok-stale/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^generate overlay links/i })).toBeInTheDocument();
  });

  it('persists a freshly minted token to localStorage', async () => {
    mockApi({ token: 'tok-123', expiresAt: 1_900_000_000_000 });
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    await screen.findByDisplayValue(
      /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123$/,
    );
    const cached = JSON.parse(
      window.localStorage.getItem(`speedline.overlayReadToken.${COMP}`) ?? '{}',
    );
    expect(cached.token).toBe('tok-123');
  });

  it('clears the cached token when links are revoked', async () => {
    // A cached token renders the full links UI (incl. the per-match VS section),
    // so the GET queries must resolve to arrays; only the revoke POST returns.
    mockApi({ revoked: true });
    seedCachedToken('tok-cached', Date.now(), Date.now() + 10 * 24 * 3_600_000);
    renderPage(COMP);

    // The cached links are showing; revoking must drop the now-dead token.
    await screen.findAllByDisplayValue(/token=tok-cached/);
    fireEvent.click(screen.getByRole('button', { name: /revoke all links/i }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /revoke all links/i }),
    );

    await waitFor(() =>
      expect(window.localStorage.getItem(`speedline.overlayReadToken.${COMP}`)).toBeNull(),
    );
    expect(screen.queryAllByDisplayValue(/token=tok-cached/)).toHaveLength(0);
  });

  it('mints exactly the pinned URL set for the default picker state', async () => {
    mockApi(
      { token: 'tok-123', expiresAt: 1_900_000_000_000 },
      { matches: [{ matchId: 'm1', compId: COMP, round: 'final', gender: 'male', position: 0 }] },
    );
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));
    await screen.findByDisplayValue(/&match=m1$/);

    const s = `?compId=${COMP}&token=tok-123`;
    const f = `${s}&discipline=freestyle`;
    const minted = screen
      .getAllByRole('textbox')
      .map((el) => (el as HTMLInputElement).value.replace(window.location.origin, ''));
    expect(minted.sort()).toEqual(
      [
        `/stream/timer?sessionId=${COMP}&token=tok-123`,
        `/stream/timer-freestyle?sessionId=${COMP}&token=tok-123`,
        ...[s, f].flatMap((q) => [
          `/stream/rankings/final/male${q}`,
          `/stream/rankings/final/male${q}&variant=profile`,
          `/stream/rankings/overall/male${q}`,
          `/stream/vs/final/male${q}`,
          `/stream/vs-live/male${q}`,
          `/stream/winner/final/male${q}`,
          `/stream/svo-live/1${q}`,
          `/stream/svo-live/2${q}`,
          `/stream/brackets/male${q}`,
          `/stream/brackets/male${q}&variant=name`,
          `/stream/vs/final/male${q}&match=m1`,
        ]),
        `/stream/rounds-summary/final/male${s}`,
        `/stream/athletes-freestyle${f}`,
        `/stream/scorecard/final/male${f}`,
        `/stream/rankings/combined/male${s}`,
        `/stream/rankings/combined/female${s}`,
        `/stream/bridge${s}`,
      ].sort(),
    );
  });

  it('mints a combined-ranking link per gender in a shared section', async () => {
    mockApi({ token: 'tok-123', expiresAt: 1_900_000_000_000 });
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    // One link per gender, cross-discipline (no &discipline=), round-independent.
    expect(
      await screen.findByDisplayValue(
        /\/stream\/rankings\/combined\/male\?compId=worlds-2026&token=tok-123$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        /\/stream\/rankings\/combined\/female\?compId=worlds-2026&token=tok-123$/,
      ),
    ).toBeInTheDocument();
  });

  it('mints an SVO identity link for the picked athlete', async () => {
    mockApi(
      { token: 'tok-123', expiresAt: 1_900_000_000_000 },
      {
        athletes: [
          { athleteId: 'a1', compId: COMP, shortName: 'Sato', name: 'Ken Sato' },
          { athleteId: 'a2', compId: COMP, shortName: 'Bianchi', name: 'Luca Bianchi' },
        ],
      },
    );
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    await screen.findByRole('option', { name: 'Ken Sato' });
    const athleteSelect = screen.getByLabelText(/^Athlete$/i);
    fireEvent.change(athleteSelect, { target: { value: 'a1' } });

    // The identity link carries the athleteId + comp + token, no discipline param.
    expect(
      await screen.findByDisplayValue(/\/stream\/svo\/a1\?compId=worlds-2026&token=tok-123$/),
    ).toBeInTheDocument();
  });

  it('rebuilds the URLs when round/gender change', async () => {
    mockApi({ token: 'tok-123', expiresAt: 1_900_000_000_000 });
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));
    await screen.findByDisplayValue(
      /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123$/,
    );

    fireEvent.change(screen.getByLabelText(/^gender$/i), { target: { value: 'female' } });
    expect(
      await screen.findByDisplayValue(
        /\/stream\/rankings\/final\/female\?compId=worlds-2026&token=tok-123$/,
      ),
    ).toBeInTheDocument();
  });

  it('defaults to a transparent background (no bg param) and appends &bg=key when chroma is selected', async () => {
    mockApi({ token: 'tok-123', expiresAt: 1_900_000_000_000 });
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    // Default: the minted rankings + race-timer links carry no bg param.
    await screen.findByDisplayValue(
      /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123$/,
    );
    expect(
      screen.getByDisplayValue(/\/stream\/timer\?sessionId=worlds-2026&token=tok-123$/),
    ).toBeInTheDocument();

    // Selecting chroma key appends &bg=key to every minted URL.
    fireEvent.change(screen.getByLabelText(/background/i), { target: { value: '&bg=key' } });
    expect(
      await screen.findByDisplayValue(
        /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123&bg=key$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/\/stream\/timer\?sessionId=worlds-2026&token=tok-123&bg=key$/),
    ).toBeInTheDocument();
    // The freestyle discipline link keeps bg after the discipline param.
    expect(
      screen.getByDisplayValue(/\/stream\/rankings\/final\/male.*&discipline=freestyle&bg=key$/),
    ).toBeInTheDocument();

    // The third mode — the colour adaptation for the H2R keyed chain —
    // appends &bg=h2r to every minted URL.
    fireEvent.change(screen.getByLabelText(/background/i), { target: { value: '&bg=h2r' } });
    expect(
      await screen.findByDisplayValue(
        /\/stream\/rankings\/final\/male\?compId=worlds-2026&token=tok-123&bg=h2r$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/\/stream\/timer\?sessionId=worlds-2026&token=tok-123&bg=h2r$/),
    ).toBeInTheDocument();
  });

  const revokeCalls = () =>
    apiFetchMock.mock.calls.filter(([path]) => path === `/competitions/${COMP}/revoke-read-tokens`);

  it('asks before revoking and sends nothing until confirmed', async () => {
    apiFetchMock.mockResolvedValue({ revoked: true });
    renderPage(COMP);

    // Links minted on another machine still need revoking, so the button is
    // live with no token cached here.
    const revoke = screen.getByRole('button', { name: /revoke all links/i });
    expect(revoke).toBeEnabled();
    fireEvent.click(revoke);

    const dialog = screen.getByRole('dialog', { name: /revoke all overlay links/i });
    expect(dialog).toHaveTextContent(/stops working immediately/i);
    expect(revokeCalls()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: /keep links/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(revokeCalls()).toHaveLength(0);
  });

  it('revokes all links once confirmed', async () => {
    apiFetchMock.mockResolvedValue({ revoked: true });
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /revoke all links/i }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /revoke all links/i }),
    );

    expect(await screen.findByText(/all overlay links revoked/i)).toBeInTheDocument();
    expect(revokeCalls()).toEqual([
      [`/competitions/${COMP}/revoke-read-tokens`, { method: 'POST' }],
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('groups each discipline into Live then Round-pinned links', async () => {
    mockApi(
      { token: 'tok-123', expiresAt: 1_900_000_000_000 },
      { matches: [{ matchId: 'm1', compId: COMP, round: 'final', gender: 'male', position: 0 }] },
    );
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));
    await screen.findByDisplayValue(/&match=m1$/);

    // The pickers say which links they drive.
    expect(screen.getByText(/round and gender set the round-pinned links/i)).toBeInTheDocument();

    for (const [name, q, timer, timerLabel] of [
      ['Speed', '', 'timer', 'Race timer (Speed)'],
      ['Freestyle', '&discipline=freestyle', 'timer-freestyle', 'Run clock (Freestyle)'],
    ] as const) {
      const section = screen.getByRole('region', { name });
      const [live, pinned, ...rest] = within(section).getAllByRole('region');
      expect(rest).toHaveLength(0);
      expect(live).toHaveAccessibleName(/^live/i);
      expect(pinned).toHaveAccessibleName(/^round-pinned/i);
      // The lg subgrid aligns the two columns' rows only over the section's
      // direct children: heading, Live, Round-pinned — nothing wrapped between.
      expect([...section.children]).toEqual([
        within(section).getByRole('heading', { name }),
        live,
        pinned,
      ]);
      expect(within(live).getByLabelText(timerLabel)).toHaveValue(
        `${window.location.origin}/stream/${timer}?sessionId=${COMP}&token=tok-123`,
      );

      const values = (group: HTMLElement) =>
        within(group)
          .getAllByRole('textbox')
          .map((el) => (el as HTMLInputElement).value.replace(window.location.origin, ''));
      const s = `?compId=${COMP}&token=tok-123${q}`;
      // Board-following links in Live, picker-built ones (per-match VS too)
      // in Round-pinned.
      expect(values(live)).toEqual(
        expect.arrayContaining([
          `/stream/${timer}?sessionId=${COMP}&token=tok-123`,
          `/stream/svo-live/1${s}`,
          `/stream/svo-live/2${s}`,
          `/stream/vs-live/male${s}`,
        ]),
      );
      expect(values(live).some((v) => /\/(rankings|brackets|winner)\//.test(v))).toBe(false);
      expect(values(pinned)).toEqual(
        expect.arrayContaining([
          `/stream/rankings/final/male${s}`,
          `/stream/brackets/male${s}`,
          `/stream/vs/final/male${s}&match=m1`,
        ]),
      );
      expect(values(pinned).some((v) => /svo-live|vs-live|\/timer/.test(v))).toBe(false);
    }
  });

  it('surfaces a mint error', async () => {
    mockApi(() => Promise.reject(new ApiError(503, 'read tokens are not configured')));
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));
    expect(await screen.findByText(/read tokens are not configured/i)).toBeInTheDocument();
  });

  it('mints a per-match VS link for each seeded match in the round', async () => {
    mockApi(
      { token: 'tok-123', expiresAt: 1_900_000_000_000 },
      {
        matches: [
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
        ],
        athletes: [
          { athleteId: 'a1', compId: COMP, shortName: 'Sato', name: 'Ken Sato' },
          { athleteId: 'a2', compId: COMP, shortName: 'Bianchi', name: 'Luca Bianchi' },
        ],
      },
    );
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    // The per-match link carries &match=<id> and is labelled with the names.
    const link = (await screen.findByDisplayValue(
      /\/stream\/vs\/final\/male\?compId=worlds-2026&token=tok-123&match=m1$/,
    )) as HTMLInputElement;
    expect(link).toBeInTheDocument();
    // The label resolves the athlete names from the loaded athletes.
    expect(screen.getAllByLabelText(/Sato vs Bianchi/).length).toBeGreaterThan(0);
    // Minted per discipline: the Freestyle section repeats it with the param.
    expect(
      screen.getByDisplayValue(
        /\/stream\/vs\/final\/male\?compId=worlds-2026&token=tok-123&discipline=freestyle&match=m1$/,
      ),
    ).toBeInTheDocument();
  });

  it('labels an unseeded VS slot TBD when the athlete is missing', async () => {
    mockApi(
      { token: 'tok-123', expiresAt: 1_900_000_000_000 },
      {
        matches: [
          {
            matchId: 'm1',
            compId: COMP,
            discipline: 'speed',
            round: 'final',
            gender: 'male',
            position: 0,
            athlete1Id: 'a1',
          },
        ],
        athletes: [{ athleteId: 'a1', compId: COMP, shortName: 'Sato', name: 'Ken Sato' }],
      },
    );
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    await screen.findByDisplayValue(
      /\/stream\/vs\/final\/male\?compId=worlds-2026&token=tok-123&match=m1$/,
    );
    expect(screen.getAllByLabelText(/Sato vs TBD/).length).toBeGreaterThan(0);
  });

  it('shows the off-air feed status once links are generated', async () => {
    mockApi(
      { token: 'tok-123', expiresAt: 1_900_000_000_000 },
      {
        // Speed has a ranked athlete + a final match → "has content"; Freestyle
        // is empty → "no data yet (intentional)".
        rankings: [{ athlete: { athleteId: 'a1' }, bestTimeMs: 1 }],
        matches: [{ matchId: 'm1', round: 'final' }],
      },
    );
    renderPage(COMP);
    fireEvent.click(screen.getByRole('button', { name: /generate overlay links/i }));

    expect(await screen.findByText(/live feed status/i)).toBeInTheDocument();
    // The status vocabulary surfaces the intentional-empty vs has-content split.
    expect(await screen.findAllByText(/has content/i)).not.toHaveLength(0);
  });
});
