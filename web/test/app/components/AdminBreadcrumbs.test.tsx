import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AdminBreadcrumbs, adminTrail } from 'app/components/AdminBreadcrumbs';

describe('adminTrail', () => {
  it('has no trail at the Competitions root', () => {
    expect(adminTrail('/admin/competitions')).toBeNull();
  });

  it('roots leaf sections directly under Competitions', () => {
    expect(adminTrail('/admin/athletes')).toEqual([
      { label: 'Competitions', to: '/admin/competitions' },
      { label: 'Athletes' },
    ]);
  });

  it('returns null for non-admin paths', () => {
    expect(adminTrail('/speedline/control')).toBeNull();
  });
});

const renderAt = (pathname: string) =>
  render(
    <MemoryRouter>
      <AdminBreadcrumbs pathname={pathname} />
    </MemoryRouter>,
  );

describe('AdminBreadcrumbs', () => {
  it('renders nothing at the root', () => {
    const { container } = renderAt('/admin/competitions');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a linked trail with the leaf as the current page', () => {
    renderAt('/admin/times');

    expect(screen.getByRole('link', { name: 'Competitions' })).toHaveAttribute(
      'href',
      '/admin/competitions',
    );

    const current = screen.getByText('Times');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.closest('a')).toBeNull();
  });
});
