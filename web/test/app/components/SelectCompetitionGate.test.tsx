import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SelectCompetitionGate } from 'app/components/SelectCompetitionGate';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const renderGate = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  return render(
    <MemoryRouter>
      <SelectedCompetitionProvider>
        <SelectCompetitionGate title="Athletes">
          {(id) => <div>body for {id}</div>}
        </SelectCompetitionGate>
      </SelectedCompetitionProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('SelectCompetitionGate', () => {
  it('prompts with the page title when no competition is selected', () => {
    renderGate(null);
    expect(screen.getByText('Athletes')).toBeInTheDocument();
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Competitions' })).toHaveAttribute(
      'href',
      '/admin/competitions',
    );
    expect(screen.queryByText(/body for/)).not.toBeInTheDocument();
  });

  it('renders the child with the selected compId', () => {
    renderGate('worlds-2026');
    expect(screen.getByText('body for worlds-2026')).toBeInTheDocument();
    expect(screen.queryByText(/select a competition first/i)).not.toBeInTheDocument();
  });
});
