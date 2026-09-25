import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AudioMutedBadge } from 'app/components/AudioMutedBadge';

describe('AudioMutedBadge', () => {
  it('shows the click-to-enable prompt while audio is blocked', () => {
    render(<AudioMutedBadge blocked />);

    expect(screen.getByTestId('audio-muted')).toBeInTheDocument();
    expect(screen.getByText(/click to enable/i)).toBeInTheDocument();
  });

  it('renders nothing once audio is unlocked', () => {
    render(<AudioMutedBadge blocked={false} />);

    expect(screen.queryByTestId('audio-muted')).toBeNull();
  });
});
