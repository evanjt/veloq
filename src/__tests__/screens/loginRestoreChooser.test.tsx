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
import { Alert, ScrollView } from 'react-native';
import * as Notice from '@/shared/ui/Notice';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';

import LoginScreen from '@/app/login';
import {
  clearWebdavConfig,
  getWebdavConfig,
} from '@/features/settings/lib/autobackup/webdavConfig';
import { ScreenScrollView } from '@/shared/ui/ScreenScrollView';
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
  jest.spyOn(Notice, 'showNotice');
  mockFiles.clear();
  await clearWebdavConfig();
});

async function openChooser() {
  await render(<LoginScreen />);
  await act(async () => {
    await fireEvent.press(screen.getByTestId('login-restore-button'));
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

  it('keeps the API key form and the inline WebDAV form on the scroll view that clears the keyboard', async () => {
    await openChooser();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-chooser-webdav'));
    });
    const scroll = within(screen.UNSAFE_getByType(ScreenScrollView));

    expect(scroll.getByTestId('login-apikey-section')).toBeTruthy();
    expect(scroll.getByLabelText(i18n.t('backup.password'))).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(ScrollView)[0]?.props.keyboardShouldPersistTaps).toBe(
      'handled'
    );
  });

  it("lists a WebDAV server's backups from the inline form and holds the chosen one for sign-in", async () => {
    const fetchMock = stubServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    await openChooser();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-chooser-webdav'));
    });
    await fireEvent.changeText(screen.getByLabelText(i18n.t('backup.serverUrl')), SERVER);
    await fireEvent.changeText(screen.getByLabelText(i18n.t('backup.username')), 'rider');
    const password = screen.getByLabelText(i18n.t('backup.password'));
    await fireEvent.changeText(password, 'app-password');
    await act(async () => {
      await fireEvent(password, 'blur');
    });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-chooser-list'));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}Veloq`,
      expect.objectContaining({ method: 'PROPFIND' })
    );
    const entry = screen.getByTestId(`restore-chooser-entry-${BACKUP_ID}`);

    await act(async () => {
      void fireEvent.press(entry);
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
    expect(Notice.showNotice).toHaveBeenCalledWith(
      expect.objectContaining({ message: i18n.t('backup.heldUntilSignIn') })
    );
    expect(alert).not.toHaveBeenCalledWith(
      i18n.t('backup.notRestoredTitle'),
      expect.anything(),
      undefined,
      expect.anything()
    );
  });
});

describe('restoring from a WebDAV server typed in without leaving the last field', () => {
  async function typeServer(fields: { url?: string; user?: string; password?: string }) {
    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-chooser-webdav'));
    });
    if (fields.url !== undefined)
      await fireEvent.changeText(screen.getByLabelText(i18n.t('backup.serverUrl')), fields.url);
    if (fields.user !== undefined)
      await fireEvent.changeText(screen.getByLabelText(i18n.t('backup.username')), fields.user);
    if (fields.password !== undefined)
      await fireEvent.changeText(screen.getByLabelText(i18n.t('backup.password')), fields.password);
  }

  async function pressList() {
    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-chooser-list'));
    });
  }

  it('stores what the form shows and lists the server, on the first press and the second', async () => {
    const fetchMock = stubServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    await openChooser();
    await typeServer({ url: SERVER, user: 'rider', password: 'app-password' });

    await pressList();

    expect(getWebdavConfig()).toEqual({
      url: SERVER,
      username: 'rider',
      password: 'app-password',
      plainLan: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER}Veloq`,
      expect.objectContaining({ method: 'PROPFIND' })
    );
    expect(screen.getByTestId(`restore-chooser-entry-${BACKUP_ID}`)).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();

    await pressList();

    const listings = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PROPFIND');
    expect(listings).toHaveLength(2);
    expect(screen.getByTestId(`restore-chooser-entry-${BACKUP_ID}`)).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
  });

  it('names the missing field rather than calling the destination unavailable', async () => {
    const fetchMock = stubServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    await openChooser();
    await typeServer({ url: SERVER, user: 'rider' });

    await pressList();

    const missing = i18n.t('backup.fillField', { field: i18n.t('backup.password') });
    expect(missing).not.toBe('backup.fillField');
    expect(alert).toHaveBeenCalledWith(
      i18n.t('backup.notListedTitle'),
      missing,
      undefined,
      expect.anything()
    );
    expect(alert).not.toHaveBeenCalledWith(
      expect.anything(),
      i18n.t('backup.destinationUnavailable'),
      undefined,
      expect.anything()
    );
    expect(getWebdavConfig()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for every field when none is filled in', async () => {
    stubServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    await openChooser();
    await typeServer({});

    await pressList();

    expect(alert).toHaveBeenCalledWith(
      i18n.t('backup.notListedTitle'),
      i18n.t('backup.fillAllFields'),
      undefined,
      expect.anything()
    );
  });

  it('gives the https refusal for a plain address on the open internet', async () => {
    const fetchMock = stubServer();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    await openChooser();
    await typeServer({ url: 'http://cloud.example.com/dav/', user: 'rider', password: 'pw' });

    await pressList();

    expect(alert).toHaveBeenCalledWith(
      i18n.t('backup.notListedTitle'),
      i18n.t('backup.webdavHttpsRequired'),
      undefined,
      expect.anything()
    );
    expect(getWebdavConfig()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the login screen', () => {
  it('opens on its title as a heading', async () => {
    await render(<LoginScreen />);

    expect(screen.getByRole('header', { name: i18n.t('login.title') })).toBeTruthy();
  });
});
