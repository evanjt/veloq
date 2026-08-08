/**
 * Scenario: athlete, sport settings and wellness are read from SQLite rather
 * than fetched. Each read must survive a body the engine cannot produce
 * (missing, empty, unparseable) without taking a screen down, and must return
 * the fields only the untyped body carries.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useAthlete } from '@/shared/app/useAthlete';
import { useSportSettings } from '@/shared/app/useSportSettings';
import { useWellness, useWellnessForDate } from '@/features/wellness/hooks/useWellness';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

// One stable identity per store field: a fresh jest.fn() per render would make
// the profile effect re-run forever.
jest.mock('@/shared/app/UnitPreferenceStore', () => {
  const state = { setIntervalsPreferences: jest.fn() };
  return { useUnitPreference: (selector: (s: unknown) => unknown) => selector(state) };
});

const setAthlete = jest.fn();

const engine = {
  getAthleteProfile: jest.fn(),
  getSportSettings: jest.fn(),
  getWellnessBodies: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetRouteEngine.mockReturnValue(engine as unknown as ReturnType<typeof getRouteEngine>);
  engine.getAthleteProfile.mockReturnValue(null);
  engine.getSportSettings.mockReturnValue(null);
  engine.getWellnessBodies.mockReturnValue([]);
  useAuthStore.setState({ isAuthenticated: true, setAthlete });
});

afterEach(() => {
  client.clear();
});

describe('useAthlete', () => {
  it('returns the stored body including fields no Rust type models', async () => {
    engine.getAthleteProfile.mockReturnValue(
      JSON.stringify({ id: 'i1', name: 'Demo', measurement_preference: 'feet', fahrenheit: true })
    );

    const { result } = renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data?.name).toBe('Demo');
    expect((result.current.data as unknown as Record<string, unknown>).measurement_preference).toBe(
      'feet'
    );
  });

  it('reads as absent when nothing has been synced', async () => {
    const { result } = renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('survives an unparseable body', async () => {
    engine.getAthleteProfile.mockReturnValue('{not json');

    const { result } = renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useSportSettings', () => {
  it('returns the stored zone definitions', async () => {
    engine.getSportSettings.mockReturnValue(
      JSON.stringify([{ types: ['Ride'], ftp: 250, power_zones: [55, 75, 90] }])
    );

    const { result } = renderHook(() => useSportSettings(), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].ftp).toBe(250);
  });

  it('reads as empty when the stored body is not an array', async () => {
    engine.getSportSettings.mockReturnValue(JSON.stringify({ ftp: 250 }));

    const { result } = renderHook(() => useSportSettings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useWellness', () => {
  it('parses each stored day, keeping fields the typed row drops', async () => {
    engine.getWellnessBodies.mockReturnValue([
      JSON.stringify({ id: '2026-07-01', ctl: 60, hrr: 18 }),
      JSON.stringify({ id: '2026-07-02', ctl: 61, hrvSDNN: 92 }),
    ]);

    const { result } = renderHook(() => useWellness('1m'), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(result.current.data?.[0].hrr).toBe(18);
    expect(result.current.data?.[1].hrvSDNN).toBe(92);
  });

  it('drops a corrupt day rather than failing the whole range', async () => {
    engine.getWellnessBodies.mockReturnValue([
      '{broken',
      JSON.stringify({ id: '2026-07-02', ctl: 61 }),
    ]);

    const { result } = renderHook(() => useWellness('1m'), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].id).toBe('2026-07-02');
  });

  it('asks for the window the range covers', async () => {
    const { result } = renderHook(() => useWellness('7d'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [oldest, newest] = engine.getWellnessBodies.mock.calls[0];
    expect(oldest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(newest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(oldest < newest).toBe(true);
  });
});

describe('useWellnessForDate', () => {
  it('returns the single day stored for that date', async () => {
    engine.getWellnessBodies.mockReturnValue([JSON.stringify({ id: '2026-07-04', ctl: 62 })]);

    const { result } = renderHook(() => useWellnessForDate('2026-07-04'), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data?.ctl).toBe(62);
    expect(engine.getWellnessBodies).toHaveBeenCalledWith('2026-07-04', '2026-07-04');
  });

  it('returns null for a date with no stored day', async () => {
    const { result } = renderHook(() => useWellnessForDate('2026-07-04'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
