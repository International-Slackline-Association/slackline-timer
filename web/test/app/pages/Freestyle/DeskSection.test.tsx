import { ThemeProvider } from '@mui/material';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeskSection } from 'app/pages/Freestyle/DeskSection';
import { telemetryTheme } from 'app/theme/theme';

// The desk never folds (C14), so the current step is marked, not revealed. The
// grey-on-grey ink swap this started as measured ~2:1 and was gone at 25 %
// scale, so the mark is three channels now — weight, ink and a rule — and the
// rule's gutter is reserved on every section, so the caption cannot shift as
// the mark moves down the desk.
const renderDesk = (current: 'setup' | 'run') =>
  render(
    <ThemeProvider theme={telemetryTheme}>
      <DeskSection step="setup" current={current} mode="battle">
        <div>setup panel</div>
      </DeskSection>
      <DeskSection step="run" current={current} mode="battle">
        <div>run panel</div>
      </DeskSection>
    </ThemeProvider>,
  );

const section = (name: string) => within(screen.getByRole('region', { name }));
const captionStyle = (name: string, text: string) =>
  window.getComputedStyle(section(name).getByText(text));
const ruleFill = (name: string) =>
  window.getComputedStyle(section(name).getByTestId('step-rule')).backgroundColor;

const UNPAINTED = 'rgba(0, 0, 0, 0)';

describe('DeskSection', () => {
  it('marks the current step in weight, ink and a painted rule', () => {
    renderDesk('run');

    expect(captionStyle('Run', '4 · Run').fontWeight).toBe('700');
    expect(captionStyle('Setup', '1 · Setup').fontWeight).not.toBe('700');
    expect(captionStyle('Run', '4 · Run').color).not.toBe(captionStyle('Setup', '1 · Setup').color);
    expect(ruleFill('Run')).not.toBe(UNPAINTED);
  });

  it('keeps a quiet step gutter reserved, so the caption cannot shift', () => {
    renderDesk('setup');

    // Rendered unpainted rather than dropped: the caption sits at the same left
    // offset whichever step the board is on.
    expect(ruleFill('Run')).toBe(UNPAINTED);
    expect(ruleFill('Setup')).not.toBe(UNPAINTED);
  });

  // freestyle-compact-run-tab-fold: the tab layout shows ONE section and names
  // it on the tab that opened it, so the printed caption is the same word twice
  // for ~26 px of a 720 px fold budget. The landmark and the step mark are not
  // the caption's to give up.
  it('drops the printed caption without dropping the landmark', () => {
    render(
      <ThemeProvider theme={telemetryTheme}>
        <DeskSection step="run" current="run" mode="battle" showCaption={false}>
          <div>run panel</div>
        </DeskSection>
      </ThemeProvider>,
    );

    expect(screen.queryByText('4 · Run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-rule')).not.toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Run' });
    expect(region).toHaveAttribute('aria-current', 'step');
    expect(within(region).getByText('run panel')).toBeInTheDocument();
  });

  it('marks only the current section for a screen reader', () => {
    renderDesk('run');

    expect(screen.getByRole('region', { name: 'Run' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('region', { name: 'Setup' })).not.toHaveAttribute('aria-current');
  });
});
