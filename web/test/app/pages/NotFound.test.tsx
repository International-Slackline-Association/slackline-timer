import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { NotFound } from 'app/pages/NotFound';

describe('NotFound', () => {
  it('renders an explicit 404 with a recovery link to Competitions', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /go to competitions/i });
    expect(link).toHaveAttribute('href', '/admin/competitions');
  });
});
