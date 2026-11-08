/**
 * Scenario: the calendar page names the wellness of whichever day is selected,
 * and a drag selects a day per cell crossed.
 *
 * Expected behaviour: the window is read from the engine once, however many
 * days are selected from it, and a day absent from the answer has no entry.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage, type WellnessDays } from 'veloqrs';

import { useWellnessDays } from '@/features/wellness/hooks/useWellness';

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
jest.mock('@/shared/native/useEngineChannel', () => ({ useEngineChannel: () => undefined }));

const mockGetWellnessDays = jest.fn<WellnessDays, [string, string]>();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getWellnessDays: mockGetWellnessDays }),
}));

describe('useWellnessDays', () => {
  it('reads the window once and keys the days by date', async () => {
    mockGetWellnessDays.mockReturnValue({
      days: [
        { date: '2026-06-01', ctl: 40, sportLoad: [] },
        { date: '2026-06-02', ctl: 41, hrv: 60, sportLoad: [] },
      ],
      coverage: RangeCoverage.Loaded,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const view = await renderHook(() => useWellnessDays('2026-05-01', '2026-06-10'), { wrapper });
    expect(view.result.current).toBeNull();
    await waitFor(() => expect(view.result.current?.size).toBe(2));
    await view.rerender({});

    expect(view.result.current?.get('2026-06-02')?.hrv).toBe(60);
    expect(view.result.current?.get('2026-06-03')).toBeUndefined();
    expect(mockGetWellnessDays).toHaveBeenCalledTimes(1);
    expect(mockGetWellnessDays).toHaveBeenCalledWith('2026-05-01', '2026-06-10');
  });
});
