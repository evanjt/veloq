/**
 * Scenario: with no startup bundle, as on the summary card settings preview,
 * the card built its week bounds as true instants of local midnight, while
 * the engine compares them against wall-clock dates stamped as UTC. East of
 * UTC last Sunday evening's ride counted in this week, west of it a Monday
 * morning ride counted in the last.
 *
 * Expected behaviour: the fallback read asks for the same four wall-clock
 * stamps the feed's bundle does, whatever the device offset.
 */

import { renderHook } from '@testing-library/react-native';

import { currentAndPreviousWeek } from '@/features/fitness/lib/weekWindow';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { getEngine } from '@/shared/native/engine';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';
import { installUtcOffset } from '../__shared__/fixedOffsetDate';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const engine = {
  getSummaryCardData: jest.fn((..._bounds: number[]) => null),
  getWellnessSparklines: jest.fn(() => null),
  subscribe: jest.fn(() => () => {}),
};

/** Wednesday 23 September 2026, midday UTC: still Wednesday at both offsets. */
const NOW = Date.parse('2026-09-23T12:00:00Z');

let restoreClock: (() => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  restoreClock?.();
  restoreClock = undefined;
});

describe.each([
  ['UTC+10', 10],
  ['UTC-7', -7],
])('the fallback week read at %s', (_zone, offset) => {
  beforeEach(() => {
    restoreClock = installUtcOffset(offset, NOW);
  });

  it('asks for the same wall-clock weeks as the bundle', () => {
    renderHook(() => useSummaryCardData());

    const week = currentAndPreviousWeek(new Date());
    expect(engine.getSummaryCardData).toHaveBeenCalledWith(
      week.weekStartTs,
      week.weekEndTs,
      week.prevStartTs,
      week.prevEndTs
    );
  });

  it("puts last Sunday's evening ride in the previous week and Monday morning's in this one", () => {
    renderHook(() => useSummaryCardData());

    const [weekStart, weekEnd, prevStart, prevEnd] = engine.getSummaryCardData.mock.calls[0];
    const sundayEvening = startDateLocalToEpochSeconds('2026-09-20T18:00:00')!;
    const mondayMorning = startDateLocalToEpochSeconds('2026-09-21T03:00:00')!;
    const thisSundayAfternoon = startDateLocalToEpochSeconds('2026-09-27T15:00:00')!;

    expect(sundayEvening).toBeGreaterThanOrEqual(prevStart);
    expect(sundayEvening).toBeLessThanOrEqual(prevEnd);
    expect(mondayMorning).toBeGreaterThanOrEqual(weekStart);
    expect(thisSundayAfternoon).toBeLessThanOrEqual(weekEnd);
  });
});
