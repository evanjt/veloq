/**
 * Scenario: the device refuses to store the WebDAV credentials, after a
 * Nextcloud QR scan or when a field loses focus.
 *
 * Expected behaviour: the form says the details were not saved, rather than
 * showing filled fields over nothing stored, and the backend list is not told
 * the configuration changed.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';

const mockSave = jest.fn();

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => null,
  setWebdavConfig: (...args: unknown[]) => mockSave(...args),
  clearWebdavConfig: jest.fn(async () => {}),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: ({ onScanned }: { onScanned: (login: unknown) => void }) => {
    const { Pressable: P, Text: T } = jest.requireActual('react-native');
    const { parseNextcloudLogin } = jest.requireActual(
      '@/features/settings/lib/autobackup/nextcloudLogin'
    );
    return (
      <P
        onPress={() =>
          onScanned(parseNextcloudLogin('nc://login/user:a b&password:p&server:https://x.example/'))
        }
      >
        <T>scan code</T>
      </P>
    );
  },
}));

beforeEach(() => {
  mockSave.mockReset();
  mockSave.mockRejectedValue(new Error('keychain unavailable'));
});

it('shows the refusal after a QR scan', async () => {
  const onConfigChange = jest.fn();
  await render(<WebdavConfigForm onConfigChange={onConfigChange} onRemoved={jest.fn()} />);
  await fireEvent.press(screen.getByText('backup.scanNextcloudQr'));
  await fireEvent.press(screen.getByText('scan code'));

  expect(mockSave).toHaveBeenCalledWith(
    'https://x.example/remote.php/dav/files/a%20b/',
    'a b',
    'p',
    false
  );
  expect(await screen.findByText('backup.webdavSaveFailed')).toBeTruthy();
  expect(onConfigChange).not.toHaveBeenCalled();
});

it('shows the refusal when a field loses focus', async () => {
  const onConfigChange = jest.fn();
  await render(<WebdavConfigForm onConfigChange={onConfigChange} onRemoved={jest.fn()} />);
  await fireEvent.changeText(screen.getByTestId('backup-webdav-url'), 'https://x.example/dav/');
  await fireEvent.changeText(screen.getByTestId('backup-webdav-username'), 'keeper');
  await fireEvent.changeText(screen.getByTestId('backup-webdav-password'), 'lighthouse');
  await fireEvent(screen.getByTestId('backup-webdav-password'), 'blur');

  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('backup.webdavSaveFailed')).toBeTruthy();
  expect(onConfigChange).not.toHaveBeenCalled();
});
