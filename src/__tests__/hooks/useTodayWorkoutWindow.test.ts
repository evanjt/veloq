import { renderHook } from '@testing-library/react-native';
import { useTodayWorkout } from '@/features/home/hooks/useTodayWorkout';
import { getEngine } from '@/shared/native/engine';
import { CLOCK_EDGES, localDay } from '../__shared__/clockEdges';

/**
 * The engine stocks a forward fortnight, and the banner reads the same window.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

jest.mock('@/shared/native/useEngineChannel', () => ({ useEngineChannel: () => undefined }));

const readWindows: [number, number][] = [];

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({
    data: queryFn(),
    isLoading: false,
  }),
}));

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
    getCalendarEventBodies: (oldest: number, newest: number) => {
      readWindows.push([oldest, newest]);
      return [workout(day(0), 'today'), workout(day(1), 'tomorrow'), workout(day(9), 'later')];
    },
  } as never);
});

describe('the planned-workout window', () => {
  it('reads a forward fortnight', () => {
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

describe.each(CLOCK_EDGES)('the planned-workout window on %s', (_name, at) => {
  beforeEach(() => jest.setSystemTime(at));

  it('reads today through fourteen days on, by the local calendar', () => {
    renderHook(() => useTodayWorkout());
    const [oldest, newest] = readWindows[0];
    expect(oldest).toBe(Date.parse(`${localDay(at)}T00:00:00Z`) / 1000);
    expect(newest).toBe(Date.parse(`${localDay(at, 14)}T23:59:59Z`) / 1000);
  });

  it('still picks today and tomorrow out of the window', () => {
    const { result } = renderHook(() => useTodayWorkout());

    expect(result.current.todayWorkout?.name).toBe('today');
    expect(result.current.tomorrowWorkout?.name).toBe('tomorrow');
  });
});
