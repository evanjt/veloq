/**
 * Scenario: a signed-in athlete opens the app on an empty library with a backup to restore.
 *
 * Expected behaviour: the restore offer is pushed as a sheet route once, when the library is
 * empty, a backup can be seen and the offer is unanswered. Finishing the sheet, or swiping it
 * away, answers it, so the next launch pushes nothing.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import RestorePromptSheet from '@/app/sheets/restore-prompt';
import { offerRestorePrompt } from '@/features/settings/lib/restorePrompt';
import { initialiseI18n } from '@/i18n';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';

const mockSettings = new Map<string, string>();
const mockBack = jest.fn();
let mockBackups: { id: string; timestamp: number }[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), canGoBack: () => true, back: () => mockBack() },
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/storage/platformRecord', () => ({ platformRecordUri: () => null }));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  getWebdavConfig: () => ({ url: 'https://example.invalid/backups' }),
  initWebdavConfig: async () => {},
}));
jest.mock('@/features/settings/lib/autobackup/backends', () => ({
  webdavBackend: {
    isAvailable: async () => true,
    listBackups: async () => mockBackups,
  },
}));
jest.mock('@/features/settings/hooks/useBackup', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));
jest.mock('@/features/settings/components/WebdavConfigForm', () => ({
  WebdavConfigForm: () => null,
}));

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => {
  mockSettings.clear();
  mockBack.mockClear();
  mockBackups = [{ id: 'b1', timestamp: 1_700_000_000_000 }];
});

describe('offering the restore sheet', () => {
  it('shows it once on an empty library with a backup found', async () => {
    const show = jest.fn();
    await offerRestorePrompt(0, () => true, show);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when no backup can be seen', async () => {
    mockBackups = [];
    const show = jest.fn();
    await offerRestorePrompt(0, () => true, show);
    expect(show).not.toHaveBeenCalled();
  });

  it('shows nothing when the library already holds activities', async () => {
    const show = jest.fn();
    await offerRestorePrompt(3, () => true, show);
    expect(show).not.toHaveBeenCalled();
  });

  it('shows nothing when the launch is superseded while the backup is looked up', async () => {
    let live = true;
    const show = jest.fn();
    const offered = offerRestorePrompt(0, () => live, show);
    live = false;
    await offered;
    expect(show).not.toHaveBeenCalled();
  });

  it('shows nothing a second time once the sheet was dismissed with a tap', async () => {
    const first = jest.fn();
    await offerRestorePrompt(0, () => true, first);
    expect(first).toHaveBeenCalledTimes(1);

    render(<RestorePromptSheet />);
    fireEvent.press(screen.getByTestId('restore-prompt-dismiss'));
    expect(mockBack).toHaveBeenCalledTimes(1);

    const second = jest.fn();
    await offerRestorePrompt(0, () => true, second);
    expect(second).not.toHaveBeenCalled();
  });

  it('counts a swipe-down as the dismiss', async () => {
    render(<RestorePromptSheet />);
    expect(screen.getByTestId('restore-prompt-sheet')).toBeTruthy();
    screen.unmount();

    const show = jest.fn();
    await offerRestorePrompt(0, () => true, show);
    expect(show).not.toHaveBeenCalled();
  });

  it('keeps its scroll view where the iOS sheet sizes it', () => {
    render(<RestorePromptSheet />);
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it('stays unanswered while the sheet is open', async () => {
    render(<RestorePromptSheet />);
    const show = jest.fn();
    await offerRestorePrompt(0, () => true, show);
    expect(show).toHaveBeenCalledTimes(1);
  });
});
