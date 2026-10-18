/**
 * Scenario: athlete and wellness are read from SQLite rather than fetched.
 * Each read must survive the engine having nothing stored without taking a
 * screen down, and the profile's unit and form preferences must reach the
 * stores that every screen reads them from.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage, type WellnessDay } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useAthlete } from '@/shared/app/useAthlete';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { useWellness, useWellnessForDate } from '@/features/wellness/hooks/useWellness';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

// One stable identity per store field: a fresh jest.fn() per render would make
// the profile effect re-run forever.
const mockSetIntervalsPreferences = jest.fn();
jest.mock('@/shared/app/UnitPreferenceStore', () => {
  const state = {
    setIntervalsPreferences: (prefs: unknown) => mockSetIntervalsPreferences(prefs),
  };
  return { useUnitPreference: (selector: (s: unknown) => unknown) => selector(state) };
});

jest.mock('@/features/home/lib/widgetBridge', () => ({
  scheduleWidgetSnapshot: jest.fn(),
}));

const setAthlete = jest.fn();

const engine = {
  getAthleteProfile: jest.fn(),
  getWellnessDays: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

/** The days a window holds, as the engine answers them with the window's coverage. */
function stored(days: WellnessDay[]) {
  return { days, coverage: days.length > 0 ? RangeCoverage.Loaded : RangeCoverage.Empty };
}

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  engine.getAthleteProfile.mockReturnValue(null);
  engine.getWellnessDays.mockReturnValue(stored([]));
  useAuthStore.setState({ isAuthenticated: true, setAthlete });
  useFormPreference.getState().reset();
});

afterEach(() => {
  client.clear();
});

describe('useAthlete', () => {
  it("lifts the units and the form denominator off the engine's profile", async () => {
    const profile = { id: 'i1', name: 'Demo', measurementPreference: 'feet', formAsPercent: true };
    engine.getAthleteProfile.mockReturnValue(profile);

    const { result } = await renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data).toEqual(profile);
    expect(setAthlete).toHaveBeenCalledWith(profile);
    expect(mockSetIntervalsPreferences).toHaveBeenCalledWith({ measurementPreference: 'feet' });
    expect(useFormPreference.getState().formAsPercent).toBe(true);
  });

  it('reads any measurement preference but feet as metres', async () => {
    engine.getAthleteProfile.mockReturnValue({ id: 'i1', measurementPreference: 'yards' });

    await renderHook(() => useAthlete(), { wrapper });

    await waitFor(() =>
      expect(mockSetIntervalsPreferences).toHaveBeenCalledWith({ measurementPreference: 'meters' })
    );
  });

  it('leaves the preferences unset when the profile carries none', async () => {
    engine.getAthleteProfile.mockReturnValue({ id: 'i1', name: 'Demo' });

    const { result } = await renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(setAthlete).toHaveBeenCalled());
    expect(result.current.data?.name).toBe('Demo');
    expect(mockSetIntervalsPreferences).not.toHaveBeenCalled();
    expect(useFormPreference.getState().formAsPercent).toBeNull();
  });

  it('reads as absent when nothing has been synced', async () => {
    const { result } = await renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useWellness', () => {
  it('carries each stored day through, in the order the engine gave them', async () => {
    engine.getWellnessDays.mockReturnValue(
      stored([
        { date: '2026-07-01', ctl: 60, sportLoad: [] },
        { date: '2026-07-02', ctl: 61, sportLoad: [] },
      ])
    );

    const { result } = await renderHook(() => useWellness('1m'), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(result.current.data?.map((d) => d.id)).toEqual(['2026-07-01', '2026-07-02']);
    expect(result.current.data?.[1].ctl).toBe(61);
  });

  it('keeps the per-sport loads the daily load bar sums', async () => {
    engine.getWellnessDays.mockReturnValue(
      stored([
        {
          date: '2026-07-01',
          ctl: 60,
          sportLoad: [
            { sportGroup: 'Ride', load: 63 },
            { sportGroup: 'Run', load: 28 },
          ],
        },
      ])
    );

    const { result } = await renderHook(() => useWellness('1m'), { wrapper });

    await waitFor(() => expect(result.current.data?.length).toBe(1));
    const total = result.current.data?.[0].sportInfo?.reduce((sum, s) => sum + (s.load ?? 0), 0);
    expect(total).toBe(91);
  });

  it('asks for the window the range covers', async () => {
    const { result } = await renderHook(() => useWellness('7d'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [oldest, newest] = engine.getWellnessDays.mock.calls[0];
    expect(oldest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(newest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(oldest < newest).toBe(true);
  });
});

describe('useWellnessForDate', () => {
  it('returns the single day stored for that date', async () => {
    engine.getWellnessDays.mockReturnValue(
      stored([{ date: '2026-07-04', ctl: 62, sportLoad: [] }])
    );

    const { result } = await renderHook(() => useWellnessForDate('2026-07-04'), { wrapper });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data?.ctl).toBe(62);
    expect(engine.getWellnessDays).toHaveBeenCalledWith('2026-07-04', '2026-07-04');
  });

  it('returns null for a date with no stored day', async () => {
    const { result } = await renderHook(() => useWellnessForDate('2026-07-04'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
