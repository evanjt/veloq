/**
 * Scenario: the athlete enters a complete WebDAV configuration on the login screen's restore
 * chooser and leaves the last field, which stores the credentials. Nothing else on the screen
 * changes.
 *
 * Expected behaviour: Remove appears at once, without any other interaction. Pressing it removes
 * the stored credentials and hides it again. Remove shows straight away when the credentials were
 * already stored before the form opened.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';

type StoredConfig = { url: string; username: string; password: string };

let mockStored: StoredConfig | null = null;
const mockSave = jest.fn(async (url: string, username: string, password: string) => {
  mockStored = { url, username, password };
});
const mockClear = jest.fn(async () => {
  mockStored = null;
});

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => mockStored,
  setWebdavConfig: (...args: Parameters<typeof mockSave>) => mockSave(...args),
  clearWebdavConfig: () => mockClear(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));

beforeEach(() => {
  mockStored = null;
  mockSave.mockClear();
  mockClear.mockClear();
});

it('shows Remove once a complete configuration is stored on blur', async () => {
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
  expect(screen.queryByTestId('backup-remove-webdav')).toBeNull();

  await fireEvent.changeText(screen.getByTestId('backup-webdav-url'), 'https://x.example/dav/');
  await fireEvent.changeText(screen.getByTestId('backup-webdav-username'), 'keeper');
  await fireEvent.changeText(screen.getByTestId('backup-webdav-password'), 'lighthouse');
  await fireEvent(screen.getByTestId('backup-webdav-password'), 'blur');

  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(await screen.findByTestId('backup-remove-webdav')).toBeTruthy();
});

it('hides Remove again after it removes the stored configuration', async () => {
  mockStored = {
    url: 'https://x.example/dav/',
    username: 'keeper',
    password: 'lighthouse',
  };
  const onRemoved = jest.fn();
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={onRemoved} />);
  await fireEvent.press(screen.getByTestId('backup-remove-webdav'));

  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(onRemoved).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByTestId('backup-remove-webdav')).toBeNull());
});

it('shows Remove straight away when the configuration was stored before the form opened', async () => {
  mockStored = {
    url: 'https://x.example/dav/',
    username: 'keeper',
    password: 'lighthouse',
  };
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);

  expect(screen.getByTestId('backup-remove-webdav')).toBeTruthy();
});
