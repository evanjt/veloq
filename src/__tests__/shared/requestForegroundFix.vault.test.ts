/**
 * Scenario: a screen asks for a foreground fix and the GPS does not answer
 * within the ceiling, as happens with a cold fix indoors.
 *
 * Expected behaviour: the request resolves to the coords when the fix arrives
 * first, and to null at the ceiling. A fix that arrives after the ceiling is
 * dropped, and a failed fix still rejects to the caller.
 */
import * as Location from 'expo-location';

import { FOREGROUND_FIX_DEADLINE_MS, requestForegroundFix } from '@/shared/app/foregroundFix';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: jest.fn(),
}));

const getPosition = Location.getCurrentPositionAsync as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  getPosition.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('requestForegroundFix', () => {
  it('uses a 15 s ceiling', () => {
    expect(FOREGROUND_FIX_DEADLINE_MS).toBe(15_000);
  });

  it('resolves to the coords when the fix arrives inside the ceiling', async () => {
    getPosition.mockResolvedValue({ coords: { latitude: 46.5, longitude: 6.6 } });

    const got = await requestForegroundFix(Location.Accuracy.Balanced);

    expect(got).toEqual({ latitude: 46.5, longitude: 6.6 });
    expect(getPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it('resolves to null at the ceiling when the fix never settles', async () => {
    getPosition.mockReturnValue(new Promise(() => {}));
    const pending = requestForegroundFix(Location.Accuracy.Balanced);

    await jest.advanceTimersByTimeAsync(FOREGROUND_FIX_DEADLINE_MS + 500);

    await expect(pending).resolves.toBeNull();
  });

  it('resolves to null when the fix arrives one tick after the ceiling', async () => {
    let resolveFix: (value: unknown) => void = () => {};
    getPosition.mockReturnValue(new Promise((resolve) => (resolveFix = resolve)));
    const pending = requestForegroundFix(Location.Accuracy.Balanced);

    await jest.advanceTimersByTimeAsync(FOREGROUND_FIX_DEADLINE_MS + 500);
    resolveFix({ coords: { latitude: 47, longitude: 8 } });

    await expect(pending).resolves.toBeNull();
  });

  it('rejects to the caller when the fix fails inside the ceiling', async () => {
    getPosition.mockRejectedValue(new Error('no fix'));

    await expect(requestForegroundFix(Location.Accuracy.Balanced)).rejects.toThrow('no fix');
  });
});
