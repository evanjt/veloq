/**
 * Scenario: on a new phone, signed out on the login screen, an athlete taps
 * Restore from Backup. Their backups are on a WebDAV server, and the phone's
 * own backup is the platform's to bring back.
 *
 * Expected behaviour: the screen offers a file and a WebDAV server, with the
 * server's form inline since a fresh install holds no credentials. Listing the
 * server shows its backups, and choosing one holds it until the sign-in, with
 * nothing sent to the closed engine. A line says the phone's own backup comes
 * back when a new phone is set up, and it is never offered as a choice.
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';

import LoginScreen from '@/app/login';
import { clearWebdavConfig } from '@/features/settings/lib/autobackup/webdavConfig';
import { i18n, initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ clear: jest.fn() }),
}));
jest.mock('@/features/auth/hooks/useApiKeyLogin', () => ({
  useApiKeyLogin: () => ({ handleApiKeyLogin: jest.fn(), isApiKeyLoading: false }),
}));
// The engine is closed on the login screen, so no record can be placed yet.
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
  getNativeModule: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/shared/storage/cacheFiles', () => ({
  ...jest.requireActual('@/shared/storage/cacheFiles'),
  restoreCopyUri: async (name: string) => `file:///cache/restores/${name}`,
}));

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  // The server's archive, as its first base64 characters: a zip's PK header.
  downloadAsync: jest.fn(async (_url: string, dest: string) => {
    mockFiles.set(dest, 'UEsDBBQAAAAIAA');
    return { status: 200 };
  }),
  readAsStringAsync: jest.fn(async (uri: string) => mockFiles.get(uri) ?? ''),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from) ?? '');
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from) ?? '');
    mockFiles.delete(from);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

const SERVER = 'https://cloud.example.com/remote.php/dav/files/rider/';
const BACKUP_ID = 'veloq-2026-10-01T08-00-00-000Z.zip';

function response(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

/** A WebDAV server holding one backup and its metadata sidecar. */
function stubServer() {
  const listing =
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
    '<d:response><d:href>/remote.php/dav/files/rider/Veloq/</d:href></d:response>' +
    `<d:response><d:href>/remote.php/dav/files/rider/Veloq/${BACKUP_ID}.meta.json</d:href></d:response>` +
    '</d:multistatus>';
  const sidecar = JSON.stringify({
    id: BACKUP_ID,
    timestamp: '2026-10-01T08:00:00.000Z',
    sizeBytes: 4096,
    appVersion: '0.4.0',
    schemaVersion: 14,
    activityCount: 120,
    athleteId: 'i999',
  });
  const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method === 'PROPFIND') return response(207, listing);
    if (method === 'GET' && url.endsWith('.meta.json')) return response(200, sidecar);
    throw new Error(`Unexpected ${method} ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockFiles.clear();
  await clearWebdavConfig();
});

async function openChooser() {
  render(<LoginScreen />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('login-restore-button'));
  });
}

describe('restore from backup on the login screen', () => {
  it('offers a file and a WebDAV server', async () => {
    await openChooser();

    expect(screen.getByTestId('restore-chooser-file')).toBeTruthy();
    expect(screen.getByTestId('restore-chooser-webdav')).toBeTruthy();
  });

  it("says the phone's own backup comes back with a new phone, and offers it as nothing", async () => {
    await openChooser();

    expect(screen.getByTestId('restore-chooser-device-backup')).toBeTruthy();
    expect(screen.getByText(i18n.t('backup.carrierDeviceRestore'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('backup.restoreFromDestination'))).toBeNull();
  });

  it("lists a WebDAV server's backups from the inline form and holds the chosen one for sign-in", async () => {
    const fetchMock = stubServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    await openChooser();

    await act(async () => {
      fireEvent.press(screen.getByTestId('restore-chooser-webdav'));
    });
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('backup.serverUrl')), SERVER);
    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('backup.username')), 'rider');
    const password = screen.getByPlaceholderText(i18n.t('backup.password'));
    fireEvent.changeText(password, 'app-password');
    await act(async () => {
      fireEvent(password, 'blur');
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('restore-chooser-list'));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}Veloq`,
      expect.objectContaining({ method: 'PROPFIND' })
    );
    const entry = screen.getByTestId(`restore-chooser-entry-${BACKUP_ID}`);

    await act(async () => {
      fireEvent.press(entry);
    });
    await act(async () => {
      const confirm = alert.mock.calls
        .at(-1)?.[2]
        ?.find((button) => button.text === i18n.t('backup.importBackup'));
      confirm?.onPress?.();
    });

    expect(FileSystem.downloadAsync).toHaveBeenCalledWith(
      `${SERVER}Veloq/${BACKUP_ID}`,
      expect.any(String),
      expect.anything()
    );
    expect(mockFiles.get('file:///docs/veloq-held-import.zip')).toBe('UEsDBBQAAAAIAA');
    expect(alert).toHaveBeenLastCalledWith(
      i18n.t('backup.importBackup'),
      i18n.t('backup.heldUntilSignIn')
    );
    expect(alert).not.toHaveBeenCalledWith(i18n.t('common.error'), expect.anything());
  });
});
