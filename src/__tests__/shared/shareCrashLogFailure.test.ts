import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';

import { shareCrashLog } from '@/shared/app/supportLinks';

/**
 * Scenario: the athlete taps Share crash log and the share sheet does not open,
 * because it threw or because the device has none.
 * Expected behaviour: a notice says the log was not shared and which of the
 * two it was. Closing the sheet without choosing a target is not a failure.
 */

jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  writeAsStringAsync: jest.fn(async () => undefined),
}));
jest.mock('@/shared/storage/cacheFiles', () => ({
  exportFileUri: jest.fn(async (name: string) => `file:///cache/${name}`),
}));
jest.mock('@/shared/debug/crashLog', () => ({
  getCrashLog: jest.fn(async () => [{ message: 'boom' }]),
  formatCrashLog: () => 'boom',
}));

const t = ((key: string) => key) as unknown as Parameters<typeof shareCrashLog>[0];

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  alert.mockRestore();
});

it('says the log was not shared when the sheet throws', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('no activity'));
  await shareCrashLog(t);

  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe('export.shareFailedTitle');
  expect(alert.mock.calls[0][1]).toBe('export.shareFailed');
});

it('says the device cannot share, rather than that it failed', async () => {
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
  await shareCrashLog(t);

  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][1]).toBe('export.shareUnavailable');
});

it('says nothing when the sheet closes without a target', async () => {
  await shareCrashLog(t);

  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/veloq-crash-log.txt', {
    mimeType: 'text/plain',
    UTI: 'text/plain',
  });
  expect(alert).not.toHaveBeenCalled();
});
