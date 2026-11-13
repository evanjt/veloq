import { Alert } from 'react-native';
import { announceDepartedRides, departedRideLines } from '@/features/routes/lib/departedRides';

const t = ((key: string, options?: Record<string, string>) =>
  options ? `${key}|${options.name}|${options.date}` : key) as never;

const ride = { activityId: 'a1', name: 'Morning ride', date: 1_710_200_000 };

describe('departedRideLines', () => {
  vaultIt('names each ride that left with its date', () => {
    const lines = departedRideLines([ride, { ...ride, activityId: 'a2', name: 'Evening ride' }], t);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^sections\.rideLeft\|Morning ride\|.+/);
    expect(lines[1]).toMatch(/^sections\.rideLeft\|Evening ride\|.+/);
  });

  it('has no lines when nothing left', () => {
    expect(departedRideLines([], t)).toEqual([]);
  });

  /**
   * The engine stamps the athlete's wall clock as UTC, so the day a ride is named by is the day of
   * those components whatever zone the device is in. Jest freezes the process zone, so the bug only
   * shows where the process zone is not UTC (`TZ=Australia/Sydney npx jest ...`); on a UTC runner
   * these pass before and after the fix.
   */
  describe('the date a ride is named by', () => {
    /** 5 March 2026 at the given wall-clock time, stamped as UTC the way the engine stores it. */
    const rideAt = (hour: number, minute = 0) => Date.UTC(2026, 2, 5, hour, minute) / 1000;

    it.each([
      ['an evening ride', 20, 0],
      ['a ride just before midnight', 23, 30],
      ['an early ride', 2, 0],
    ])('names %s by the day it was ridden on', (_label, hour, minute) => {
      const [line] = departedRideLines([{ ...ride, date: rideAt(hour, minute) }], t);

      expect(line).toBe('sections.rideLeft|Morning ride|5 Mar');
    });
  });
});

describe('announceDepartedRides', () => {
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  vaultIt('shows one alert naming the ride that left', () => {
    announceDepartedRides([ride], t);

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('sections.ridesLeftTitle');
    expect(message).toContain('Morning ride');
  });

  it('shows nothing when no ride left', () => {
    announceDepartedRides([], t);

    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
