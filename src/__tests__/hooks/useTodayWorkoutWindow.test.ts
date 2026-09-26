import { renderHook } from '@testing-library/react-native';
import { useTodayWorkout } from '@/features/home/hooks/useTodayWorkout';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: the planned-workout banner asked the calendar for today and
 * tomorrow. The window rewrite is destructive, so a day that was never fetched
 * while online is not backfilled later.
 * Expected behaviour: one online mount stocks a forward fortnight, so a second
 * day offline still has a plan to show, and the banner still reads today and
 * tomorrow out of it.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

jest.mock('@/shared/native/engineBodies', () => ({
  useEngineBody: (_wanted: boolean, run: () => void) => run(),
}));

const readWindows: [number, number][] = [];

jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({
    data: queryFn(),
    isLoading: false,
  }),
}));

const syncCalendarEvents = jest.fn();

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function workout(dayString: string, name: string) {
  return JSON.stringify({
    id: name,
    category: 'WORKOUT',
    name,
    start_date_local: `${dayString}T06:00:00`,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  readWindows.length = 0;
  mockedGetEngine.mockReturnValue({
    syncCalendarEvents,
    getCalendarEventBodies: (oldest: number, newest: number) => {
      readWindows.push([oldest, newest]);
      return [workout(day(0), 'today'), workout(day(1), 'tomorrow'), workout(day(9), 'later')];
    },
  } as never);
});

describe('the planned-workout window', () => {
  it('asks the calendar for a forward fortnight, not two days', () => {
    renderHook(() => useTodayWorkout());

    expect(syncCalendarEvents).toHaveBeenCalledWith(day(0), day(14));
  });

  it('reads back the same window it asked for', () => {
    renderHook(() => useTodayWorkout());

    const [oldest, newest] = readWindows[0];
    const spanDays = (newest + 1 - oldest) / 86400;
    expect(spanDays).toBeCloseTo(15, 0);
  });

  it('still picks today and tomorrow out of the wider window', () => {
    const { result } = renderHook(() => useTodayWorkout());

    expect(result.current.todayWorkout?.name).toBe('today');
    expect(result.current.tomorrowWorkout?.name).toBe('tomorrow');
  });
});
