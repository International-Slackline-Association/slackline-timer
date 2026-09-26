import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Force the production gate (LOCAL_DEV off) so the bypass under test is the
// /stream/* read-token path, not the local-dev escape hatch.
vi.mock('app/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/constants')>();
  return { ...actual, LOCAL_DEV: false };
});

const { signInWithRedirect, getCurrentUser } = vi.hoisted(() => ({
  signInWithRedirect: vi.fn(),
  getCurrentUser: vi.fn(),
}));
vi.mock('aws-amplify/auth', () => ({ signInWithRedirect, getCurrentUser }));
vi.mock('aws-amplify/utils', () => ({ Hub: { listen: vi.fn(() => vi.fn()) } }));

import { AuthGate } from 'app/auth/gate';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    </MemoryRouter>,
  );

afterEach(() => {
  signInWithRedirect.mockReset();
  getCurrentUser.mockReset();
});

describe('AuthGate', () => {
  it('renders a /stream/* overlay carrying a token without a Cognito sign-in', () => {
    getCurrentUser.mockRejectedValue(new Error('no session'));
    renderAt('/stream/rankings/final/male?compId=c1&token=abc');

    expect(screen.getByText('protected content')).toBeInTheDocument();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it('still gates /stream/* when no token is present', async () => {
    getCurrentUser.mockRejectedValue(new Error('no session'));
    renderAt('/stream/rankings/final/male');

    expect(await screen.findByRole('button', { name: /sign in with isa/i })).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('prompts sign-in on a normal route when signed out', async () => {
    getCurrentUser.mockRejectedValue(new Error('no session'));
    renderAt('/admin/competitions');

    expect(await screen.findByRole('button', { name: /sign in with isa/i })).toBeInTheDocument();
  });
});
