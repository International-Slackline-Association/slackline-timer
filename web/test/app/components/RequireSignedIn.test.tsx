import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchAuthSession, signOut } = vi.hoisted(() => ({
  fetchAuthSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession, signOut }));

import { RequireSignedIn } from 'app/components/RequireSignedIn';
import { setWsAuthDenied } from 'app/auth/wsAuthSignal';

const signedInSession = () => ({ tokens: { idToken: { payload: { sub: 'u1' } } } });
const signedOutSession = () => ({ tokens: undefined });

// The gate lives inside the router (CognitoGate navigates); mirror that here,
// with a competitions route to land the denied-screen recovery on.
const renderGate = () =>
  render(
    <MemoryRouter initialEntries={['/speedline/control']}>
      <Routes>
        <Route path="/admin/competitions" element={<div>competitions list</div>} />
        <Route
          path="*"
          element={
            <RequireSignedIn>
              <div>protected content</div>
            </RequireSignedIn>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  act(() => setWsAuthDenied(false));
});

afterEach(() => {
  fetchAuthSession.mockReset();
  signOut.mockReset();
  act(() => setWsAuthDenied(false));
});

describe('RequireSignedIn', () => {
  it('renders children for any signed-in ISA user (no group required)', async () => {
    fetchAuthSession.mockResolvedValue(signedInSession());
    renderGate();

    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('shows the signed-out message when there is no token', async () => {
    fetchAuthSession.mockResolvedValue(signedOutSession());
    renderGate();

    expect(await screen.findByText('Not authorized')).toBeInTheDocument();
    expect(screen.getByText(/signed out/i)).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('surfaces a denied WebSocket (expired session or ungranted competition)', async () => {
    fetchAuthSession.mockResolvedValue(signedInSession());
    renderGate();

    expect(await screen.findByText('protected content')).toBeInTheDocument();

    // The WS $connect authorizer then rejects the (re)connection.
    act(() => setWsAuthDenied(true));

    await waitFor(() => expect(screen.getByText('Not authorized')).toBeInTheDocument());
    expect(screen.getByText(/not authorized for this competition/i)).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('recovers from a denied socket without a reload — back to the competitions list', async () => {
    fetchAuthSession.mockResolvedValue(signedInSession());
    renderGate();
    expect(await screen.findByText('protected content')).toBeInTheDocument();

    // A manager whose grant was revoked hits a denied $connect — an everyday
    // state under the per-competition ACL, so it must not dead-end.
    act(() => setWsAuthDenied(true));
    await waitFor(() => expect(screen.getByText('Not authorized')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /go to competitions/i }));

    expect(await screen.findByText('competitions list')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('offers no navigation escape when actually signed out — only Sign out', async () => {
    fetchAuthSession.mockResolvedValue(signedOutSession());
    renderGate();

    expect(await screen.findByText('Not authorized')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /go to competitions/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
