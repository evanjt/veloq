import { Alert } from 'react-native';
import { announceDepartedRides, departedRideLines } from '@/features/routes/lib/departedRides';

const t = ((key: string, options?: Record<string, string>) =>
  options ? `${key}|${options.name}|${options.date}` : key) as never;

const ride = { activityId: 'a1', name: 'Morning ride', date: 1_710_200_000 };

describe('departedRideLines', () => {
  it('names each ride that left with its date', () => {
    const lines = departedRideLines([ride, { ...ride, activityId: 'a2', name: 'Evening ride' }], t);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^sections\.rideLeft\|Morning ride\|.+/);
    expect(lines[1]).toMatch(/^sections\.rideLeft\|Evening ride\|.+/);
  });

  it('has no lines when nothing left', () => {
    expect(departedRideLines([], t)).toEqual([]);
  });
});

describe('announceDepartedRides', () => {
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('shows one alert naming the ride that left', () => {
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
