/**
 * Scenario: the fitness screen holds a Run and a Swim pace curve for the
 * threshold readouts under the sport toggle, and only the sport in view
 * renders either of them.
 *
 * Expected behaviour: the curve the athlete is not looking at is not fetched.
 * Both were enabled by default, so a cyclist who never opens Running or
 * Swimming still downloaded up to ten curves a session, one per time range,
 * each stored in `curve_bodies` and each firing a pace snapshot write.
 */

import { renderHook } from '@testing-library/react-native';

import { useFitnessScreenData } from '@/features/fitness/hooks/useFitnessScreenData';
import { usePaceCurve } from '@/features/stats';

jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: undefined, isLoading: false }),
  timeRangeToDays: () => 42,
}));
jest.mock('@/features/activity/hooks', () => ({
  useActivities: () => ({ data: undefined, isLoading: false, isFetching: false }),
  useActivityStreams: () => ({ data: undefined, isLoading: false }),
  useEFTPHistory: () => [],
  getLatestFTP: () => undefined,
}));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({
  usePaceCurve: jest.fn(() => ({ data: undefined })),
  useSeasonBests: () => ({ efforts: [], isLoading: false, headerSummary: undefined }),
}));
jest.mock('@/features/fitness/hooks/useZoneDistribution', () => ({
  useZoneDistribution: () => ({ data: undefined }),
}));

const mockUsePaceCurve = usePaceCurve as jest.MockedFunction<typeof usePaceCurve>;

/** The `enabled` each sport was asked for, keyed by sport. */
function enabledBySport(): Record<string, boolean | undefined> {
  const out: Record<string, boolean | undefined> = {};
  for (const [options] of mockUsePaceCurve.mock.calls) {
    if (options?.sport) out[options.sport] = options.enabled;
  }
  return out;
}

beforeEach(() => jest.clearAllMocks());

describe('the fitness screen pace curves', () => {
  it('fetches neither curve for a cyclist', () => {
    renderHook(() => useFitnessScreenData({ timeRange: '1m', sportMode: 'Cycling' }));

    expect(enabledBySport()).toEqual({ Run: false, Swim: false });
  });

  it('fetches only the running curve in Running', () => {
    renderHook(() => useFitnessScreenData({ timeRange: '1m', sportMode: 'Running' }));

    expect(enabledBySport()).toEqual({ Run: true, Swim: false });
  });

  it('fetches only the swimming curve in Swimming', () => {
    renderHook(() => useFitnessScreenData({ timeRange: '1m', sportMode: 'Swimming' }));

    expect(enabledBySport()).toEqual({ Run: false, Swim: true });
  });
});
