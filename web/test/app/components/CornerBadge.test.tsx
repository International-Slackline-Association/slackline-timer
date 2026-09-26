import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CornerBadge } from 'app/components/CornerBadge';

describe('CornerBadge', () => {
  it('renders the label under the given test id with a status role', () => {
    render(<CornerBadge corner="right" tone="error" label="Signal lost" testId="x" />);
    const badge = screen.getByTestId('x');
    expect(badge).toHaveAttribute('role', 'status');
    expect(screen.getByText('Signal lost')).toBeInTheDocument();
  });

  it('pins to the requested corner', () => {
    const { rerender } = render(
      <CornerBadge corner="left" tone="warning" label="Muted" testId="x" />,
    );
    expect(window.getComputedStyle(screen.getByTestId('x')).left).toBe('16px');

    rerender(<CornerBadge corner="right" tone="warning" label="Muted" testId="x" />);
    expect(window.getComputedStyle(screen.getByTestId('x')).right).toBe('16px');
  });
});
