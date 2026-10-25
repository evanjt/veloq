/**
 * Scenario: the athlete has connected a Garmin key. intervals.icu may import
 * Garmin activities itself, and uploading originals from Veloq would then
 * duplicate them.
 *
 * Expected behaviour: the duplicate warning and the intervals.icu connections
 * link show only when the upload switch is on while intervals.icu's import is
 * on, and Veloq makes no write to intervals.icu's settings either way.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { GarminConnector } from '@/features/settings/components/GarminConnector';
import { GARMIN_KEY_STORAGE_KEY } from '@/shared/app/credentialKeychain';
import * as engineKey from '@/shared/native/garminKey';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockProfile: { data: { garminSyncsActivities?: boolean } | null } = { data: null };
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => mockProfile }));

const mockSettings = new Map<string, string>();
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
}));

const mockKeychain = new Map<string, string>();
jest.mock('@/shared/app/credentialKeychain', () => ({
  ...jest.requireActual('@/shared/app/credentialKeychain'),
  secureStoreIo: {
    read: async (key: string) => mockKeychain.get(key) ?? null,
    write: async (key: string, value: string) => {
      mockKeychain.set(key, value);
    },
    remove: async (key: string) => {
      mockKeychain.delete(key);
    },
  },
}));

jest.mock('@/shared/native/garminKey', () => ({
  connectGarmin: jest.fn(),
  holdGarminKey: jest.fn(),
  clearGarminKey: jest.fn(),
}));

jest.mock('@/features/recording', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: jest.fn(async () => ({ granted: true, error: null })),
  }),
  useUploadPermissionStore: (select: (s: { hasWritePermission: boolean }) => unknown) =>
    select({ hasWritePermission: true }),
}));

const fetchSpy = jest.spyOn(global, 'fetch');

async function connectedScreen(syncsActivities: boolean | undefined) {
  mockProfile.data =
    syncsActivities === undefined ? {} : { garminSyncsActivities: syncsActivities };
  mockKeychain.set(GARMIN_KEY_STORAGE_KEY, 'kept-key');
  const screen = await render(<GarminConnector />);
  await waitFor(() => expect(screen.getByTestId('garmin-more-options')).toBeTruthy());
  fireEvent.press(screen.getByTestId('garmin-more-options'));
  return screen;
}

describe('the Garmin connector duplicate warning', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockSettings.clear();
    jest.clearAllMocks();
  });

  it('warns and links to the connections page when uploading while the import is on, writing nothing', async () => {
    const screen = await connectedScreen(true);
    fireEvent(screen.getByTestId('garmin-upload-switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('garmin-duplicate-warning')).toBeTruthy());
    expect(screen.getByTestId('garmin-open-connections')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows neither while uploading is off, with the import on', async () => {
    const screen = await connectedScreen(true);
    expect(screen.queryByTestId('garmin-duplicate-warning')).toBeNull();
    expect(screen.queryByTestId('garmin-open-connections')).toBeNull();
  });

  it('shows neither when the import is off', async () => {
    const screen = await connectedScreen(false);
    fireEvent(screen.getByTestId('garmin-upload-switch'), 'valueChange', true);
    await waitFor(() => expect(mockSettings.get('veloq-garmin-upload')).toBe('true'));
    expect(screen.queryByTestId('garmin-duplicate-warning')).toBeNull();
    expect(screen.queryByTestId('garmin-open-connections')).toBeNull();
  });

  it('clears the keychain entry and the engine key on disconnect', async () => {
    const screen = await connectedScreen(true);
    fireEvent.press(screen.getByTestId('garmin-disconnect'));
    await waitFor(() => expect(mockKeychain.has(GARMIN_KEY_STORAGE_KEY)).toBe(false));
    expect(engineKey.clearGarminKey).toHaveBeenCalledTimes(1);
  });
});
