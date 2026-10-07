import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useExportRecordBackup } from '@/features/settings/hooks/useBackup';
import { exportRecordBackup } from '@/features/settings/lib/backup';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/settings/lib/backup', () => ({
  exportRecordBackup: jest.fn(),
  hasPendingRecordExport: () => false,
  pendingRecordExportSettled: () => Promise.resolve(),
  resumePendingRecordExport: () => Promise.resolve('nothing-pending'),
}));

const mockExport = exportRecordBackup as jest.MockedFunction<typeof exportRecordBackup>;

beforeEach(() => {
  mockExport.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('shares one record archive for repeated taps while export is running', async () => {
  let finish = () => {};
  mockExport.mockImplementation(
    () =>
      new Promise<'complete'>((resolve) => {
        finish = () => resolve('complete');
      })
  );
  const { result } = renderHook(() => useExportRecordBackup());

  let first: Promise<void> = Promise.resolve();
  await act(async () => {
    first = result.current.exportRecordBackup();
    void result.current.exportRecordBackup();
  });
  expect(result.current.exporting).toBe(true);
  expect(mockExport).toHaveBeenCalledTimes(1);

  await act(async () => {
    finish();
    await first;
  });
  expect(result.current.exporting).toBe(false);
});

it('shows a failure and permits another export', async () => {
  mockExport.mockRejectedValueOnce(new Error('share failed'));
  mockExport.mockResolvedValueOnce('complete');
  const { result } = renderHook(() => useExportRecordBackup());

  await act(async () => {
    await result.current.exportRecordBackup();
  });
  expect(Alert.alert).toHaveBeenCalledWith('common.error', 'backup.exportError');

  await act(async () => {
    await result.current.exportRecordBackup();
  });
  expect(mockExport).toHaveBeenCalledTimes(2);
});
