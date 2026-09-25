import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ControlStatusHeader } from 'app/components/ControlStatusHeader';
import type { LinkPhase } from 'app/hooks/useLinkPhase';
import { chosenKey } from 'app/theme/tokens';

import { px } from '../../util/computedUnits';
import { deskMediaValue } from '../../util/deskGeometry';

/** MUI's `md`/`lg` breakpoints — the two widths the health block folds at. */
const MD_MEDIA = '(min-width:900px)';
const LG_MEDIA = '(min-width:1200px)';

/** The sentence the down phases print under the health row. */
const LINK_DETAIL = 'clocks keep running; the preview is not receiving';

type ControlStatusHeaderProps = Parameters<typeof ControlStatusHeader>[0];

const baseProps: ControlStatusHeaderProps = {
  context: {
    mode: 'Freestyle',
    boardMode: 'BATTLE',
    round: 'Final',
    gender: 'Women',
  },
  health: {
    link: 'open',
    audioBlocked: false,
    peer: 'awaiting',
  },
};

describe('ControlStatusHeader', () => {
  it('renders context details and keeps the board mode marker styling', () => {
    render(<ControlStatusHeader {...baseProps} />);

    expect(screen.getByText('Freestyle')).toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByText('Women')).toBeInTheDocument();

    const boardMode = screen.getByText('BATTLE');
    expect(boardMode.parentElement).toHaveStyle({ backgroundColor: chosenKey.backgroundColor });
  });

  it('uses status lines instead of chip rows', () => {
    const { container } = render(<ControlStatusHeader {...baseProps} />);
    const healthGrid = within(screen.getByTestId('control-health')).getByTestId(
      'control-health-grid',
    );

    expect(container.querySelectorAll('.MuiChip-root')).toHaveLength(0);
    expect(within(healthGrid).getByText('Connected')).toBeInTheDocument();
    expect(within(healthGrid).getByText('Audio armed')).toBeInTheDocument();
  });

  it('names the link plate, so the phase reading is addressable on its own', () => {
    // The health rows stopped being MUI Chips ("uses status lines" above), which
    // left the link phase — the one reading an operator checks before every run —
    // with nothing to address it by, while its own detail line under it kept a
    // handle. Off-screen probes (the local puppeteer driver) then read the whole
    // slot and saw the audio/peer rows too.
    const { rerender } = render(<ControlStatusHeader {...baseProps} />);
    expect(screen.getByTestId('control-link-status')).toHaveTextContent('Connected');

    rerender(<ControlStatusHeader {...baseProps} health={{ ...baseProps.health, link: 'lost' }} />);
    expect(screen.getByTestId('control-link-status')).toHaveTextContent('Connection lost');
  });

  it('shows the outage reassurance line only for down link phases', () => {
    const { rerender } = render(
      <ControlStatusHeader
        {...baseProps}
        health={{
          ...baseProps.health,
          link: 'lost',
        }}
      />,
    );

    expect(screen.getByText('Connection lost')).toBeInTheDocument();
    expect(screen.getByTestId('control-link-detail')).toHaveTextContent(
      'clocks keep running; the preview is not receiving',
    );

    rerender(
      <ControlStatusHeader
        {...baseProps}
        health={{
          ...baseProps.health,
          link: 'open',
        }}
      />,
    );

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByTestId('control-link-detail').textContent).toBe('\u00a0');
  });

  it('says the panel recovered its own run, and yields the line to a link alarm', () => {
    // ADR 0047: the solo board's recovery notice rides the one reserved caption
    // row, and a link alarm — the reading nothing else reports — outranks it.
    const { rerender } = render(
      <ControlStatusHeader {...baseProps} health={{ ...baseProps.health, recovered: true }} />,
    );
    expect(screen.getByTestId('control-link-detail')).toHaveTextContent(
      'recovered this panel’s last run',
    );

    rerender(
      <ControlStatusHeader
        {...baseProps}
        health={{ ...baseProps.health, recovered: true, link: 'lost' }}
      />,
    );
    expect(screen.getByTestId('control-link-detail')).toHaveTextContent(
      'clocks keep running; the preview is not receiving',
    );
  });

  // `control-health-slot-height`: the detail caption reserves ONE row
  // (`minHeight: 1.2em`) but was free to wrap, so the down-phase sentence took a
  // second line at the narrower desks — 59.2 px of health slot against 77.3 —
  // and moved both desks under it on a link change. The reserved row is the fold
  // budget `5a69ad8` won, so the line is clipped to it and the full sentence
  // stays readable through the title instead of being given a second row.
  it('holds the detail line to its one reserved row, whatever the reading', () => {
    const phases: LinkPhase[] = ['connecting', 'unreachable', 'open', 'reconnecting', 'lost'];
    const { rerender } = render(<ControlStatusHeader {...baseProps} />);

    for (const link of phases) {
      rerender(<ControlStatusHeader {...baseProps} health={{ ...baseProps.health, link }} />);
      const detail = screen.getByTestId('control-link-detail');
      const style = window.getComputedStyle(detail);
      expect(style.whiteSpace).toBe('nowrap');
      expect(style.overflow).toBe('hidden');
      expect(style.textOverflow).toBe('ellipsis');
      // A clipped line still has to be readable: the down phases hand the whole
      // sentence to the tooltip; the blank rows have nothing to say.
      const detailed = link === 'unreachable' || link === 'reconnecting' || link === 'lost';
      if (detailed) expect(detail).toHaveAttribute('title', LINK_DETAIL);
      else expect(detail).not.toHaveAttribute('title');
    }
  });

  // ftt-followup-speedline-desk-fold-2: the caption is a flex child of the
  // shrink-to-fit health Stack, so its own max-content width helped SIZE the
  // plate row above it — a longer sentence measurably narrowed the row
  // (77.3 → 57.3 px at 1440x720) and re-laid it. `width: 0` + a percentage
  // floor contributes nothing intrinsic and still fills the settled column, so
  // the row's geometry is the viewport's alone.
  it('contributes no intrinsic width to the health column it sits under', () => {
    render(<ControlStatusHeader {...baseProps} health={{ ...baseProps.health, link: 'lost' }} />);

    const style = window.getComputedStyle(screen.getByTestId('control-link-detail'));
    expect(px(style.width)).toBe(0);
    expect(style.minWidth).toBe('100%');
  });

  it('maps peer states to labels and hides the line when no peer state is provided', () => {
    const healthSlot = () => within(screen.getByTestId('control-health'));

    const { rerender } = render(
      <ControlStatusHeader {...baseProps} health={{ ...baseProps.health, peer: 'awaiting' }} />,
    );
    expect(healthSlot().getByText('peer: awaiting')).toBeInTheDocument();

    rerender(
      <ControlStatusHeader {...baseProps} health={{ ...baseProps.health, peer: 'answered' }} />,
    );
    expect(healthSlot().getByText('peer: answered')).toBeInTheDocument();

    rerender(
      <ControlStatusHeader {...baseProps} health={{ ...baseProps.health, peer: 'alone' }} />,
    );
    expect(healthSlot().getByText('peer: none')).toBeInTheDocument();

    rerender(
      <ControlStatusHeader {...baseProps} health={{ ...baseProps.health, peer: undefined }} />,
    );
    expect(healthSlot().queryByText(/^peer:/i)).not.toBeInTheDocument();
  });

  it('renders recording status when provided and keeps it optional', () => {
    const recordingSlot = () => within(screen.getByTestId('control-recording'));

    const { rerender } = render(
      <ControlStatusHeader
        {...baseProps}
        recording={{
          active: true,
        }}
      />,
    );
    expect(recordingSlot().getByText('Recording')).toBeInTheDocument();

    rerender(
      <ControlStatusHeader
        {...baseProps}
        recording={{
          active: false,
          detail: 'permission denied',
        }}
      />,
    );
    expect(recordingSlot().getByText('Not recording (permission denied)')).toBeInTheDocument();

    rerender(<ControlStatusHeader {...baseProps} recording={undefined} />);
    expect(screen.queryByText(/^Recording$/)).not.toBeInTheDocument();
  });

  // fsux-desk-fold-budget: the health block used to be a 2x2 plate grid over a
  // full-width sound button, and the ~125 px it cost is what pushed the lane
  // transport off a 1440x900 desk. jsdom applies no `@media`, so the fold is
  // read off the rule the element carries.
  it('folds the health block into one row of cells at the desk widths', () => {
    render(
      <ControlStatusHeader
        {...baseProps}
        health={{ ...baseProps.health, sound: { on: true, onToggle: vi.fn() } }}
      />,
    );

    const grid = screen.getByTestId('control-health-grid');
    // One row of four from `lg` (the desk starts at 1280); two of two between
    // `md` and there, where the four cells share a third of a tablet.
    expect(deskMediaValue(grid, 'grid-template-columns', LG_MEDIA)).toBe(
      'repeat(3, minmax(0, auto)) auto',
    );
    expect(deskMediaValue(grid, 'grid-template-columns', MD_MEDIA)).toBe(
      'repeat(2, minmax(0, auto))',
    );
    // Link · Audio · peer · sound — four cells, and the sound toggle is one of
    // them rather than the row it used to span.
    expect(grid.children).toHaveLength(4);
    expect(window.getComputedStyle(grid.children[3]).gridColumn).not.toBe('1 / -1');
  });

  // The live desk pass (driver `realtime-recovery`, link-chip leg) read the
  // health slot at two different heights across the five readings at 1440x900:
  // the row sits right on its wrap threshold there, so a longer alarm label
  // ("Connection lost" over "Connecting…") took the few px the AUDIO LOCKED
  // plate beside it needed and tipped it into a second line — pushing the whole
  // desk down a row exactly when the operator is reading an alarm (§4.12, and
  // the responsive contract's above-the-fold promise). Reserving the widest
  // label makes the row's geometry a function of the viewport, not of the phase.
  // Only a real layout can see the height; what jsdom can hold is the reserve.
  it('reserves the widest link label, so the reading cannot reflow the health row', () => {
    const phases: LinkPhase[] = ['connecting', 'unreachable', 'open', 'reconnecting', 'lost'];
    const { rerender } = render(<ControlStatusHeader {...baseProps} />);

    const readings = phases.map((link) => {
      rerender(<ControlStatusHeader {...baseProps} health={{ ...baseProps.health, link }} />);
      const label = within(screen.getByTestId('control-link-status')).getByRole('paragraph');
      return { text: label.textContent ?? '', minWidth: window.getComputedStyle(label).minWidth };
    });

    const reserved = new Set(readings.map((r) => r.minWidth));
    expect(reserved.size).toBe(1);
    // …and it is a real reserve, not `auto`: the source sizes it in `ch` off the
    // label table itself (`LINK_LABEL_CH`), so it tracks the type scale and
    // cannot drift when a phase is reworded. jsdom resolves `ch` to its own
    // fixed char width, so the assertion is the floor the rule implies — one
    // px per character of the widest reading, at minimum.
    const widest = Math.max(...readings.map((r) => r.text.length));
    expect(Number.parseFloat([...reserved][0])).toBeGreaterThanOrEqual(widest);
  });

  it('offers an interactive sound toggle button with the current state label', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    const { rerender } = render(
      <ControlStatusHeader
        {...baseProps}
        health={{
          ...baseProps.health,
          sound: {
            on: true,
            onToggle,
          },
        }}
      />,
    );

    const onButton = screen.getByRole('button', { name: 'Sound on this panel' });
    expect(onButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(onButton);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <ControlStatusHeader
        {...baseProps}
        health={{
          ...baseProps.health,
          sound: {
            on: false,
            onToggle,
          },
        }}
      />,
    );

    const offButton = screen.getByRole('button', { name: 'Sound off on this panel' });
    expect(offButton).toHaveAttribute('aria-pressed', 'false');
  });
});
