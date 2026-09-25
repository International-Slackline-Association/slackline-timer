import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FreestyleSetupPanel } from 'app/pages/Freestyle/FreestyleSetupPanel';
import type { WarmupChannel } from 'app/hooks/useWarmupChannel';

/** The warm-up channel as the strip reads it: two fields and one setter. */
const warmupStub = (over: Partial<WarmupChannel> = {}): WarmupChannel =>
  ({
    running: false,
    defaultSeconds: 60,
    setDefaultSeconds: vi.fn(),
    ...over,
  }) as WarmupChannel;

const renderPanel = (over: Partial<Parameters<typeof FreestyleSetupPanel>[0]> = {}) => {
  const props = {
    sessionId: 'c1',
    mode: 'quali' as const,
    onModeChange: vi.fn(),
    runSeconds: 120,
    onRunSecondsChange: vi.fn(),
    onApplyRunBudget: vi.fn(),
    holdsState: false,
    blocker: null,
    liveBlocker: null,
    runningLane: null,
    warmup: warmupStub(),
    enabledPreview: true,
    onTogglePreview: vi.fn(),
    ...over,
  };
  render(<FreestyleSetupPanel {...props} />);
};

const setBothLanes = () =>
  screen.getByRole('button', { name: 'Set both lanes to 120 s' }) as HTMLButtonElement;
const modeButton = (name: 'Quali' | 'Battle') =>
  screen.getByRole('button', { name }) as HTMLButtonElement;
const previewSwitch = () => screen.getByRole('switch', { name: 'Preview' });
const setupDetails = () =>
  screen.getByRole('button', { name: 'Setup details' }) as HTMLButtonElement;

describe('FreestyleSetupPanel', () => {
  it('keeps mode visible and moves the longer setup controls behind Setup details', () => {
    renderPanel();

    expect(modeButton('Quali')).toBeInTheDocument();
    expect(setupDetails()).toBeInTheDocument();
    expect(screen.queryByLabelText('Run (s)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set both lanes/ })).not.toBeInTheDocument();
    expect(screen.getByText('Run 120 s · Warm-up 60 s · Preview ON')).toBeInTheDocument();
  });

  it('reports a mode pick, and never re-reports the mode already shown', () => {
    const onModeChange = vi.fn();
    renderPanel({ mode: 'quali', onModeChange });

    fireEvent.click(modeButton('Battle'));
    expect(onModeChange).toHaveBeenCalledWith('battle');

    onModeChange.mockClear();
    fireEvent.click(modeButton('Quali'));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('edits the Run (s) draft in Setup details without applying it — Set both lanes does that', () => {
    const onRunSecondsChange = vi.fn();
    const onApplyRunBudget = vi.fn();
    renderPanel({ onRunSecondsChange, onApplyRunBudget });

    fireEvent.click(setupDetails());
    fireEvent.change(screen.getByLabelText('Run (s)'), { target: { value: '90' } });
    expect(onRunSecondsChange).toHaveBeenCalledWith(90);
    expect(onApplyRunBudget).not.toHaveBeenCalled();

    fireEvent.click(setBothLanes());
    expect(onApplyRunBudget).toHaveBeenCalledOnce();
  });

  it('locks both format controls while the board holds state, and names the blocker', async () => {
    renderPanel({ holdsState: true, blocker: 'locked while Athlete 1 runs' });

    expect(modeButton('Battle').disabled).toBe(true);
    fireEvent.click(setupDetails());
    expect(setBothLanes().disabled).toBe(true);
    expect(screen.getAllByText('why: locked while Athlete 1 runs')).toHaveLength(2);

    fireEvent.mouseOver(setBothLanes().parentElement as HTMLElement);
    expect((await screen.findByRole('tooltip')).textContent).toBe('locked while Athlete 1 runs');
  });

  it('keeps the why-lines reserved and empty while nothing holds the board', () => {
    renderPanel();

    expect(screen.getAllByTestId('why-line')).toHaveLength(1);
    expect(screen.queryByText(/^why: /)).not.toBeInTheDocument();
  });

  it('locks the Run (s) field while a lane is running, and says which lane', () => {
    renderPanel();
    fireEvent.click(setupDetails());
    expect((screen.getByLabelText('Run (s)') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('applies with Set both lanes')).toBeInTheDocument();

    cleanup();
    renderPanel({ runningLane: 2 });
    fireEvent.click(setupDetails());
    expect((screen.getByLabelText('Run (s)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('locked while Athlete 2 runs')).toBeInTheDocument();
  });

  it('locks the Warm-up (s) field during the warm-up, and says so', () => {
    renderPanel({ warmup: warmupStub({ running: true }) });

    fireEvent.click(setupDetails());
    expect((screen.getByLabelText('Warm-up (s)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('locked during the warm-up')).toBeInTheDocument();
  });

  it('locks both second fields on anything live, and prints that one reason', () => {
    // §4.5: the two drafts are inert whenever a clock is ticking, not only on
    // their own channel — a quali break, the changeover and an open try all hold
    // them too. The line under each is the LIVE blocker, never the wider
    // `boardHoldsState` one, so a field that is still editable (a held lane)
    // cannot print "Reset Athlete 1 first" under itself.
    renderPanel({
      holdsState: true,
      blocker: 'locked while Athlete 1 is on break',
      liveBlocker: 'locked while Athlete 1 is on break',
    });
    fireEvent.click(setupDetails());

    expect((screen.getByLabelText('Run (s)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Warm-up (s)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText('locked while Athlete 1 is on break')).toHaveLength(2);
  });

  it('leaves the second fields editable when the hold is merely destroyable', () => {
    // A held or spent lane locks Mode and Set both lanes (`holdsState`) but
    // nothing is ticking, so the drafts stay live — and say what they always say.
    renderPanel({
      holdsState: true,
      blocker: 'locked once Athlete 1 ran — Reset Athlete 1 first',
      liveBlocker: null,
    });
    fireEvent.click(setupDetails());

    expect((screen.getByLabelText('Run (s)') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Warm-up (s)') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('applies with Set both lanes')).toBeInTheDocument();
    // The two format controls still say it (prefixed `why: `); no helper line does.
    expect(screen.queryByText('locked once Athlete 1 ran — Reset Athlete 1 first')).toBeNull();
    expect(
      screen.getAllByText('why: locked once Athlete 1 ran — Reset Athlete 1 first'),
    ).toHaveLength(2);
  });

  it('drives the warm-up default through the channel, and the preview toggle out', () => {
    const warmup = warmupStub();
    const onTogglePreview = vi.fn();
    renderPanel({ warmup, onTogglePreview });

    fireEvent.click(setupDetails());
    fireEvent.change(screen.getByLabelText('Warm-up (s)'), { target: { value: '45' } });
    expect(warmup.setDefaultSeconds).toHaveBeenCalledWith(45);

    fireEvent.click(previewSwitch());
    expect(onTogglePreview).toHaveBeenCalledOnce();
  });

  it('names the mode group and the preview switch, and speaks the preview state', () => {
    renderPanel({ enabledPreview: false });

    expect(screen.getByRole('group', { name: 'Board mode' })).toContainElement(modeButton('Quali'));
    fireEvent.click(setupDetails());
    expect(previewSwitch()).not.toBeChecked();

    cleanup();
    renderPanel({ enabledPreview: true });
    fireEvent.click(setupDetails());
    expect(previewSwitch()).toBeChecked();
  });

  it('links the preview surfaces of this session', () => {
    renderPanel({ sessionId: 'laax26' });
    fireEvent.click(setupDetails());

    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute(
      'href',
      '/freestyle/preview?sessionId=laax26',
    );
    expect(screen.getByRole('link', { name: 'Athlete display' })).toHaveAttribute(
      'href',
      '/freestyle/athletes?sessionId=laax26',
    );
  });
});
