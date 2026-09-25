import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QueryStates } from 'app/components/QueryStates';

const query = (over: Partial<Parameters<typeof QueryStates>[0]['query']> = {}) => ({
  isLoading: false,
  isError: false,
  error: null as unknown,
  data: undefined as readonly unknown[] | undefined,
  ...over,
});

describe('QueryStates', () => {
  it('shows a spinner while the primary query loads', () => {
    render(<QueryStates query={query({ isLoading: true })} empty="No rows." />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows a spinner when a secondary query is still loading', () => {
    render(<QueryStates query={query({ data: [] })} alsoLoading empty="No rows." />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the flattened error', () => {
    render(<QueryStates query={query({ isError: true, error: new Error('boom') })} empty="—" />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows the empty state only for an empty result', () => {
    render(<QueryStates query={query({ data: [] })} empty="No times recorded yet." />);
    expect(screen.getByText('No times recorded yet.')).toBeInTheDocument();
  });

  it('renders nothing once data is present', () => {
    const { container } = render(
      <QueryStates query={query({ data: [{ id: 1 }] })} empty="No rows." />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
