/**
 * Scenario: the athlete self-hosts WebDAV and types, or has stored, an
 * `http://` address.
 *
 * Expected behaviour: the address is saved as typed and the form warns that
 * the password and backups travel unencrypted. An `https://` address shows no
 * warning, and an address that is neither is refused.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';

const mockSave = jest.fn(async () => {});
let mockStored: { url: string; username: string; password: string } | null = null;

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => mockStored,
  setWebdavConfig: (...args: unknown[]) => (mockSave as (...a: unknown[]) => unknown)(...args),
  clearWebdavConfig: jest.fn(async () => {}),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: jest.requireActual('@/features/settings/lib/autobackup/webdavConfig')
    .webdavUrlProblem,
}));

beforeEach(() => {
  mockSave.mockClear();
  mockStored = null;
});

const WARNING = 'backup.webdavPlainHttpWarning';

async function typeInto(testID: string, value: string) {
  const field = screen.getByTestId(testID);
  await fireEvent.changeText(field, value);
  await fireEvent(field, 'blur');
}

it('saves a plain http address to a public host and warns', async () => {
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
  expect(screen.queryByText(WARNING)).toBeNull();

  await typeInto('backup-webdav-url', 'http://cloud.example.com/dav');
  await typeInto('backup-webdav-username', 'athlete');
  await typeInto('backup-webdav-password', 'pw');

  expect(screen.getByText(WARNING)).toBeTruthy();
  expect(mockSave).toHaveBeenCalledWith('http://cloud.example.com/dav', 'athlete', 'pw');
});

it('warns on a stored plain http config without being asked', async () => {
  mockStored = { url: 'http://nas.example.org/dav', username: 'a', password: 'p' };
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);

  expect(screen.getByText(WARNING)).toBeTruthy();
});

it('shows no warning for https', async () => {
  mockStored = { url: 'https://nas.example.org/dav', username: 'a', password: 'p' };
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);

  expect(screen.queryByText(WARNING)).toBeNull();
});

it('refuses an address that is neither http nor https', async () => {
  await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
  await typeInto('backup-webdav-url', 'ftp://cloud.example.com/dav');
  await typeInto('backup-webdav-username', 'athlete');
  await typeInto('backup-webdav-password', 'pw');

  expect(mockSave).not.toHaveBeenCalled();
});
