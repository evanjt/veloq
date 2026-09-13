/**
 * Scenario: the insight fingerprint is the set of insight ids the athlete has
 * already been shown, and several of those ids are constants rather than being
 * keyed to anything the athlete owns: `hrv_trend`, `period_comparison-volume`,
 * `fitness_milestone-ftp`, `fitness_milestone-pace`,
 * `fitness_milestone-swim-pace` and `stale_pr-group`. The account wipe clears
 * the library, the profile and the caches and leaves the fingerprint.
 *
 * Expected behaviour: the wipe clears it too, so the next athlete's constant-id
 * insights are new to them.
 */

import { clearAccountData } from '@/shared/storage';
import {
  readInsightFingerprint,
  writeInsightFingerprint,
} from '@/features/insights/lib/fingerprintStore';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/storage/settingsStorage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => {
    throw new Error('File not found');
  }),
  deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    removeItem: jest.fn(async () => {}),
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
  },
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
  isEngineReady: jest.fn(() => false),
}));

beforeEach(() => {
  mockSettings.clear();
});

describe('an account wipe and the insights the next athlete has never seen', () => {
  it('forgets the fingerprint the previous athlete left', async () => {
    await writeInsightFingerprint('fitness_milestone-ftp|hrv_trend|period_comparison-volume');
    expect(await readInsightFingerprint()).not.toBe('');

    await clearAccountData({ clear: () => {} });

    expect(await readInsightFingerprint()).toBe('');
  });
});
