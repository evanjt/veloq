import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useTodayWorkout } from '@/features/home/hooks/useTodayWorkout';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

it('re-reads the planned workout after the engine stores a calendar window', async () => {
  const listeners = new Map<string, (payload?: unknown) => void>();
  let oldest = 0;
  let bodies: string[] = [];
  const syncCalendarEvents = jest.fn();
  mockGetEngine.mockReturnValue({
    getCalendarEventBodies: (start: number) => {
      oldest = start;
      return bodies;
    },
    syncCalendarEvents,
    getBodiesStored: () => 0,
    subscribe: (event: string, listener: (payload?: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let unmount: (() => void) | undefined;
  try {
    const rendered = renderHook(() => useTodayWorkout(), { wrapper });
    unmount = rendered.unmount;
    const { result } = rendered;
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.todayWorkout).toBeNull();

    const today = new Date(oldest * 1000).toISOString().slice(0, 10);
    bodies = [
      JSON.stringify({
        id: 'intervals',
        name: 'Intervals',
        category: 'WORKOUT',
        start_date_local: `${today}T07:00:00`,
      }),
    ];
    act(() => listeners.get('bodyStored')?.({ kind: 'calendar' }));

    await waitFor(() => expect(result.current.todayWorkout?.name).toBe('Intervals'));
    expect(syncCalendarEvents).not.toHaveBeenCalled();
  } finally {
    unmount?.();
    client.clear();
  }
});
