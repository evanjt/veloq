/**
 * Scenario: a WebDAV server is stored, and the athlete clears all three fields of the form. The
 * form reads blank while the stored server stays in use.
 *
 * Expected behaviour: committing the cleared form refuses, and neither the stored details nor
 * the stored server change. A form with nothing stored and nothing filled in still answers empty.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';

import {
  WebdavConfigForm,
  type WebdavConfigFormHandle,
} from '@/features/settings/components/WebdavConfigForm';

type StoredConfig = { url: string; username: string; password: string; plainLan: boolean };

let mockStored: StoredConfig | null = null;
const mockSave = jest.fn();
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
  setWebdavConfig: (...args: unknown[]) => mockSave(...args),
  clearWebdavConfig: () => mockClear(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));

const storedServer: StoredConfig = {
  url: 'https://x.example/dav/',
  username: 'keeper',
  password: 'lighthouse',
  plainLan: false,
};

beforeEach(() => {
  mockStored = null;
  mockSave.mockClear();
  mockClear.mockClear();
});

async function renderWithFieldsCleared(stored: StoredConfig | null) {
  mockStored = stored;
  const ref = createRef<WebdavConfigFormHandle>();
  await render(<WebdavConfigForm ref={ref} onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
  await fireEvent.changeText(screen.getByTestId('backup-webdav-url'), '');
  await fireEvent.changeText(screen.getByTestId('backup-webdav-username'), '');
  await fireEvent.changeText(screen.getByTestId('backup-webdav-password'), '');
  return ref;
}

it('refuses a cleared form over a stored server, and leaves the server stored', async () => {
  const ref = await renderWithFieldsCleared(storedServer);

  const first = await act(() => ref.current!.commit());
  const second = await act(() => ref.current!.commit({ required: true }));

  expect(first).toEqual({ kind: 'refused', message: 'backup.webdavRemoveFirst' });
  expect(second).toEqual({ kind: 'refused', message: 'backup.webdavRemoveFirst' });
  expect(mockStored).toEqual(storedServer);
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});

vaultIt('answers empty for a cleared form when nothing is stored', async () => {
  const ref = await renderWithFieldsCleared(null);

  expect(await act(() => ref.current!.commit())).toEqual({ kind: 'empty' });
  expect(mockSave).not.toHaveBeenCalled();
});
