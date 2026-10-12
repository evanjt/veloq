/**
 * Scenario: the season bests header read a running best per kilometre and a
 * swimming best per 100 m whatever the unit preference said.
 *
 * Expected behaviour: the headline follows the preference.
 */

import { renderHook } from '@testing-library/react-native';

import { useSeasonBests } from '@/features/stats/hooks/useSeasonBests';
import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

/** The read as the engine gives it: a 5 minute ride best, a 5K run best and a 400 m swim best. */
const mockRead = {
  data: {
    sports: [
      {
        sport: 'Ride',
        fetched: true,
        efforts: [{ label: '5m', checkpoint: 300, value: 312.4, time: 300, activityId: 'b' }],
      },
      {
        sport: 'Run',
        fetched: true,
        efforts: [{ label: '5K', checkpoint: 5000, value: 3.57, time: 1400, activityId: 'c' }],
      },
      {
        sport: 'Swim',
        fetched: true,
        efforts: [{ label: '400m', checkpoint: 400, value: 4, time: 100, activityId: 'a' }],
      },
    ],
    climbing: [],
  },
  isLoading: false,
};

jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => mockRead,
}));

describe('season bests headline units', () => {
  it('reads the 5K pace per kilometre when metric and per mile when imperial', async () => {
    useUnitPreference.setState({ unitPreference: 'metric' });
    expect(
      await (
        await renderHook(() => useSeasonBests({ sport: 'Running', days: 42 }))
      ).result.current.headerSummary
    ).toBe('5K: 4:40/km');

    useUnitPreference.setState({ unitPreference: 'imperial' });
    expect(
      await (
        await renderHook(() => useSeasonBests({ sport: 'Running', days: 42 }))
      ).result.current.headerSummary
    ).toBe('5K: 7:31/mi');
  });

  it('reads the 400 m swim pace per 100 m when metric and per 100 yd when imperial', async () => {
    useUnitPreference.setState({ unitPreference: 'metric' });
    expect(
      await (
        await renderHook(() => useSeasonBests({ sport: 'Swimming', days: 42 }))
      ).result.current.headerSummary
    ).toBe('400m: 0:25/100m');

    useUnitPreference.setState({ unitPreference: 'imperial' });
    expect(
      await (
        await renderHook(() => useSeasonBests({ sport: 'Swimming', days: 42 }))
      ).result.current.headerSummary
    ).toBe('400m: 0:23/100yd');
  });

  it('reads the 5 minute power with the watt symbol spaced from the value', () => {
    const summary = renderHook(() => useSeasonBests({ sport: 'Cycling', days: 42 })).result.current
      .headerSummary;
    expect(summary).toContain('312 W');
    expect(summary).not.toMatch(/\dw/i);
  });
});
