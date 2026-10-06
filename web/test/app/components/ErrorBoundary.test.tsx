import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlBoundary, OverlayBoundary, withErrorBoundry } from 'app/components/ErrorBoundary';
import { RETRY_DELAYS_MS } from 'app/components/ErrorBoundary/retryLadder';
import { applyOverlayBodyStyle, CHROMA_GROUND_CLASS } from 'app/pages/Stream/overlayBg';

const crash = { on: true };
let mounts = 0;

/** Paints its `?bg=` ground like a real overlay, then throws while `crash.on`. */
const Surface = ({ search }: { search: string }) => {
  useEffect(() => {
    mounts += 1;
  }, []);
  useEffect(() => applyOverlayBodyStyle(search), [search]);
  if (crash.on) throw new Error('secret internals');
  return <div>surface ok</div>;
};

/** Mounts healthy, then crashes on the next render. */
const LateCrash = ({ search }: { search: string }) => {
  useEffect(() => {
    crash.on = true;
  }, []);
  return <Surface search={search} />;
};

beforeEach(() => {
  crash.on = false;
  mounts = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.style.background = '';
  document.body.className = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OverlayBoundary', () => {
  const search = '?bg=green';
  const overlay = (child: ReactElement) => (
    <MemoryRouter initialEntries={[`/stream/timer${search}`]}>
      <Routes>
        <Route element={<OverlayBoundary />}>
          <Route path="/stream/timer" element={child} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

  it('blanks the surface but keeps its ?bg= ground', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(overlay(<LateCrash search={search} />));
    const ground = document.body.style.background;
    expect(ground).not.toBe('');

    rerender(overlay(<LateCrash search={search} />));

    expect(container.textContent).toBe('');
    expect(document.body.style.background).toBe(ground);
  });

  it('retries on its own along the backoff ladder', () => {
    vi.useFakeTimers();
    crash.on = true;
    const { container } = render(overlay(<Surface search={search} />));
    expect(container.textContent).toBe('');

    const [first, second] = RETRY_DELAYS_MS;
    act(() => vi.advanceTimersByTime(first));
    expect(container.textContent).toBe('');

    crash.on = false;
    act(() => vi.advanceTimersByTime(second - 1));
    expect(container.textContent).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('surface ok')).toBeInTheDocument();
  });
});

describe('ControlBoundary', () => {
  const renderControl = () =>
    render(
      <MemoryRouter initialEntries={['/speedline/control']}>
        <Routes>
          <Route element={<ControlBoundary />}>
            <Route path="/speedline/control" element={<Surface search="" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  it('shows the operator panel without the raw error text', () => {
    crash.on = true;
    renderControl();
    expect(screen.getByText('The control panel stopped')).toBeInTheDocument();
    expect(screen.queryByText(/secret internals/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText(/secret internals/)).toBeInTheDocument();
  });

  it('remounts the panel on Reload panel', () => {
    crash.on = true;
    renderControl();
    crash.on = false;
    const before = mounts;
    fireEvent.click(screen.getByRole('button', { name: 'Reload panel' }));
    expect(screen.getByText('surface ok')).toBeInTheDocument();
    expect(mounts).toBe(before + 1);
  });
});

describe('root boundary', () => {
  const Boom = () => {
    if (crash.on) throw new Error('secret internals');
    return <div>app ok</div>;
  };
  const Root = withErrorBoundry(Boom);

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('renders nothing on a /stream path', () => {
    crash.on = true;
    window.history.replaceState(null, '', '/stream/timer?token=t');
    const { container } = render(<Root />);
    expect(container.textContent).toBe('');
  });

  it('holds a display route on its own ground', () => {
    crash.on = true;
    window.history.replaceState(null, '', '/speedline/preview');
    render(<Root />);
    expect(document.body.classList).toContain(CHROMA_GROUND_CLASS);
  });

  it('retries a display surface along the backoff ladder', () => {
    vi.useFakeTimers();
    crash.on = true;
    window.history.replaceState(null, '', '/stream/timer?token=t');
    const { container } = render(<Root />);

    const [first, second] = RETRY_DELAYS_MS;
    act(() => vi.advanceTimersByTime(first));
    expect(container.textContent).toBe('');

    crash.on = false;
    act(() => vi.advanceTimersByTime(second - 1));
    expect(container.textContent).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('app ok')).toBeInTheDocument();
  });

  it('shows generic text, not the error message, elsewhere', () => {
    crash.on = true;
    window.history.replaceState(null, '', '/admin/athletes');
    render(<Root />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText(/secret internals/)).toBeNull();
  });

  it('leaves an operator page to its Try again button', () => {
    vi.useFakeTimers();
    crash.on = true;
    window.history.replaceState(null, '', '/admin/athletes');
    render(<Root />);
    crash.on = false;
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS.at(-1)! * 2));
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
