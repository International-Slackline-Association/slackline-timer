import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RankBadge } from 'app/components/RankBadge';

describe('RankBadge', () => {
  it('renders the rank label in the Oswald display face at the given size', () => {
    render(<RankBadge label="=1" fontSize="72px" />);
    const el = screen.getByText('=1');
    const computed = window.getComputedStyle(el);
    expect(computed.fontFamily).toContain('Oswald');
    expect(computed.fontWeight).toBe('500');
    expect(computed.fontSize).toBe('72px');
  });
});
