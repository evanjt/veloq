/**
 * Scenario: the athlete's wellness smoothing choice is kept on the device and
 * read back when the fitness tab opens again.
 *
 * Expected behaviour: a stored window comes back as itself, a value the window
 * list does not hold reads as Auto, and a written choice is stored under the
 * settings key the backup and restore path carries.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  WELLNESS_SMOOTHING_KEY,
  parseSmoothingWindow,
  readWellnessSmoothing,
  writeWellnessSmoothing,
} from '@/features/fitness/lib/wellnessSmoothingPreference';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('parseSmoothingWindow', () => {
  it.each([
    [null, 'auto'],
    ['auto', 'auto'],
    ['none', 'none'],
    ['3', 3],
    ['28', 28],
  ])('reads %s as %s', (stored, expected) => {
    expect(parseSmoothingWindow(stored)).toBe(expected);
  });

  it('reads a value the window list does not hold as Auto', () => {
    expect(parseSmoothingWindow('5')).toBe('auto');
    expect(parseSmoothingWindow('')).toBe('auto');
  });
});

describe('readWellnessSmoothing and writeWellnessSmoothing', () => {
  it('reads Auto when nothing is stored', async () => {
    await expect(readWellnessSmoothing()).resolves.toBe('auto');
  });

  it('keeps a written choice for the next read', async () => {
    await writeWellnessSmoothing(21);
    await expect(readWellnessSmoothing()).resolves.toBe(21);
  });

  it('stores the choice under the settings key the backup carries', async () => {
    await writeWellnessSmoothing('none');
    expect(WELLNESS_SMOOTHING_KEY).toBe('veloq-wellness-smoothing');
    await expect(AsyncStorage.getItem(WELLNESS_SMOOTHING_KEY)).resolves.toBe('none');
  });
});
