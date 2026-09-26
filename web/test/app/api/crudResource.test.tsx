import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { crudResource } from 'app/api/crudResource';

const COMP = 'worlds-2026';

interface Widget {
  widgetId: string;
  label: string;
}
type WidgetInput = Pick<Widget, 'label'>;

const widgetKeys = {
  all: (compId: string) => ['widgets', compId] as const,
};

const widgets = crudResource<Widget, WidgetInput>('widgets', widgetKeys);

const wrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('crudResource', () => {
  it('useCreate POSTs the input to the collection and invalidates the entity branch', async () => {
    apiFetchMock.mockReset().mockResolvedValue({ widgetId: 'w1', label: 'A' });
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => widgets.useCreate(COMP), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ label: 'A' });

    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/widgets`, {
      method: 'POST',
      body: { label: 'A' },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: widgetKeys.all(COMP) });
  });

  it('useUpdate PUTs the input to the id and invalidates', async () => {
    apiFetchMock.mockReset().mockResolvedValue({ widgetId: 'w1', label: 'B' });
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => widgets.useUpdate(COMP), { wrapper: wrapper(client) });

    await result.current.mutateAsync({ id: 'w1', input: { label: 'B' } });

    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/widgets/w1`, {
      method: 'PUT',
      body: { label: 'B' },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: widgetKeys.all(COMP) });
  });

  it('useDelete DELETEs by id and invalidates', async () => {
    apiFetchMock.mockReset().mockResolvedValue(undefined);
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => widgets.useDelete(COMP), { wrapper: wrapper(client) });

    await result.current.mutateAsync('w1');

    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/widgets/w1`, {
      method: 'DELETE',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: widgetKeys.all(COMP) });
  });

  it('does not invalidate when the request fails', async () => {
    apiFetchMock.mockReset().mockRejectedValue(new Error('boom'));
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => widgets.useCreate(COMP), { wrapper: wrapper(client) });

    await expect(result.current.mutateAsync({ label: 'A' })).rejects.toThrow('boom');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
