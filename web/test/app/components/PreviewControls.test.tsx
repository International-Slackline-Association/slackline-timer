import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PreviewControls } from 'app/components/PreviewControls';

const renderControls = (over: Partial<Parameters<typeof PreviewControls>[0]> = {}) => {
  const props = {
    enabled: true,
    onToggle: vi.fn(),
    links: [{ href: '/speedline/preview?sessionId=laax26', label: 'Preview' }],
    ...over,
  };
  render(<PreviewControls {...props} />);
  return props;
};

const previewSwitch = () => screen.getByRole('switch', { name: 'Preview' });

describe('PreviewControls', () => {
  it('names the switch and speaks its state beside it', () => {
    renderControls({ enabled: false });

    expect(previewSwitch()).not.toBeChecked();
    expect(previewSwitch()).toHaveAccessibleName('Preview');
    expect(screen.getByText('OFF')).toBeInTheDocument();
  });

  it('toggles on a press', () => {
    const { onToggle } = renderControls();

    expect(previewSwitch()).toBeChecked();
    fireEvent.click(previewSwitch());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('opens each projector surface in its own tab', () => {
    renderControls({
      links: [
        { href: '/freestyle/preview?sessionId=laax26', label: 'Preview' },
        { href: '/freestyle/athletes?sessionId=laax26', label: 'Athlete display' },
      ],
    });

    const preview = screen.getByRole('link', { name: 'Preview' });
    expect(preview).toHaveAttribute('href', '/freestyle/preview?sessionId=laax26');
    expect(preview).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Athlete display' })).toHaveAttribute(
      'href',
      '/freestyle/athletes?sessionId=laax26',
    );
  });

  // The ADVANCE guard counts a focused `a[href]` as owning Space (§4.3), and
  // unlike a button a link does NOT activate on Space — so a projector link
  // that kept the focus of the click that opened it would leave the buzzer
  // silently dead.
  it('leaves the keyboard for the buzzer after a projector link is clicked', () => {
    renderControls();
    const link = screen.getByRole('link', { name: 'Preview' });
    link.focus();

    // The press never takes focus, and the click drops focus already held.
    expect(fireEvent.mouseDown(link)).toBe(false);
    fireEvent.click(link);

    expect(document.activeElement).toBe(document.body);
  });

  // The switch owns Space the same way, and its press is guarded at the half a
  // composite control can be: the blur reaches the `SwitchBase` the handler
  // sits on, never the inner input, so the cancelled mouse-down — which is what
  // stops the press taking focus at all — is the assertion with teeth.
  it('does not take the keyboard when the preview switch is pressed', () => {
    renderControls();

    expect(fireEvent.mouseDown(previewSwitch())).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
