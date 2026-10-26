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
import { useAuthStore } from '@/shared/app/AuthStore';
import { GARMIN_KEY_STORAGE_KEY } from '@/shared/app/credentialKeychain';
import * as engineKey from '@/shared/native/garminKey';
import { GarminKeyStatus, GarminMatch } from 'veloqrs';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

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
  garminAccount: jest.fn(async () => undefined),
  holdGarminKey: jest.fn(),
  clearGarminKey: jest.fn(),
}));

const mockUpgrade = jest.fn(async () => ({ granted: true, error: null }));
jest.mock('@/features/recording', () => ({
  usePermissionUpgrade: () => ({ upgradePermissions: mockUpgrade }),
  useUploadPermissionStore: jest.requireActual('@/features/recording/stores/UploadPermissionStore')
    .useUploadPermissionStore,
  useWriteAccessMissing: jest.requireActual('@/features/recording/hooks/useWriteAccessMissing')
    .useWriteAccessMissing,
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
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: true });
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

describe('the Garmin connector after a restore', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockSettings.clear();
    jest.clearAllMocks();
  });

  it('asks for the key again when the connector was on and the device holds no key', async () => {
    mockSettings.set('__garmin_connector_enabled', 'true');
    const screen = await render(<GarminConnector />);
    await waitFor(() => expect(screen.getByTestId('garmin-key-needed')).toBeTruthy());
    expect(screen.getByTestId('garmin-key-input')).toBeTruthy();
    expect(screen.queryByTestId('garmin-disconnect')).toBeNull();
  });

  it('shows no request once a key is kept', async () => {
    mockSettings.set('__garmin_connector_enabled', 'true');
    mockKeychain.set(GARMIN_KEY_STORAGE_KEY, 'kept-key');
    const screen = await render(<GarminConnector />);
    await waitFor(() => expect(screen.getByTestId('garmin-disconnect')).toBeTruthy());
    expect(screen.queryByTestId('garmin-key-needed')).toBeNull();
  });
});

describe('the Garmin connector upload switch', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockSettings.clear();
    jest.clearAllMocks();
    mockUpgrade.mockResolvedValue({ granted: true, error: null });
  });

  it('turns on at once for an API-key athlete, which carries every permission', async () => {
    useAuthStore.setState({ authMethod: 'apiKey' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: null });
    const screen = await connectedScreen(false);
    fireEvent(screen.getByTestId('garmin-upload-switch'), 'valueChange', true);
    await waitFor(() => expect(mockSettings.get('veloq-garmin-upload')).toBe('true'));
    expect(mockUpgrade).not.toHaveBeenCalled();
  });

  it('runs the upgrade for an OAuth athlete without the grant and saves once it is granted', async () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: null });
    const screen = await connectedScreen(false);
    fireEvent(screen.getByTestId('garmin-upload-switch'), 'valueChange', true);
    await waitFor(() => expect(mockSettings.get('veloq-garmin-upload')).toBe('true'));
    expect(mockUpgrade).toHaveBeenCalledTimes(1);
  });

  it('leaves the switch off and saves nothing when the OAuth upgrade is refused', async () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: null });
    mockUpgrade.mockResolvedValue({ granted: false, error: null });
    const screen = await connectedScreen(false);
    fireEvent(screen.getByTestId('garmin-upload-switch'), 'valueChange', true);
    await waitFor(() => expect(mockUpgrade).toHaveBeenCalledTimes(1));
    expect(mockSettings.has('veloq-garmin-upload')).toBe(false);
  });

  it('turns on without the upgrade for an OAuth athlete who already holds the grant', async () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: true });
    const screen = await connectedScreen(false);
    fireEvent(screen.getByTestId('garmin-upload-switch'), 'valueChange', true);
    await waitFor(() => expect(mockSettings.get('veloq-garmin-upload')).toBe('true'));
    expect(mockUpgrade).not.toHaveBeenCalled();
  });
});

describe('the Garmin connector automatic swap switch', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockSettings.clear();
    jest.clearAllMocks();
    useAuthStore.setState({ authMethod: 'apiKey' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: null });
    useDebugStore.setState({
      experimentalEnabled: true,
      experimentalUnlocked: true,
      experimentalFeatures: {},
    });
  });

  afterEach(() => {
    useDebugStore.setState({
      experimentalEnabled: false,
      experimentalUnlocked: false,
      experimentalFeatures: {},
    });
  });

  it('is absent while the experimental switch is off', async () => {
    useDebugStore.setState({ experimentalEnabled: false });
    const screen = await connectedScreen(false);
    expect(screen.queryByTestId('garmin-auto-swap-switch')).toBeNull();
    expect(screen.getByTestId('garmin-upload-switch')).toBeTruthy();
  });

  it('is absent when the Garmin entry is off under the experimental switch', async () => {
    useDebugStore.setState({ experimentalFeatures: { garminUpdate: false } });
    const screen = await connectedScreen(false);
    expect(screen.queryByTestId('garmin-auto-swap-switch')).toBeNull();
  });

  it('is off and labelled Experimental until the athlete turns it on', async () => {
    const screen = await connectedScreen(false);
    expect(screen.getByTestId('garmin-auto-swap-experimental')).toBeTruthy();
    expect(screen.getByTestId('garmin-auto-swap-switch').props.accessibilityState.checked).toBe(
      false
    );
    expect(mockSettings.has('veloq-garmin-auto-swap')).toBe(false);
  });

  it('stores the moment it was turned on, and false when turned off', async () => {
    const screen = await connectedScreen(false);
    const before = Date.now();
    fireEvent(screen.getByTestId('garmin-auto-swap-switch'), 'valueChange', true);
    await waitFor(() => expect(mockSettings.has('veloq-garmin-auto-swap')).toBe(true));
    const stored = Date.parse(mockSettings.get('veloq-garmin-auto-swap') ?? '');
    expect(stored).toBeGreaterThanOrEqual(before);
    fireEvent(screen.getByTestId('garmin-auto-swap-switch'), 'valueChange', false);
    await waitFor(() => expect(mockSettings.get('veloq-garmin-auto-swap')).toBe('false'));
  });

  it('shows why the engine switched it off, and clears that reason when it is turned on again', async () => {
    mockSettings.set('veloq-garmin-auto-swap', 'false');
    mockSettings.set('veloq-garmin-auto-swap-stopped', 'intervals.icu holds a different file');
    const screen = await connectedScreen(false);
    expect(screen.getByTestId('garmin-auto-swap-stopped')).toBeTruthy();
    fireEvent(screen.getByTestId('garmin-auto-swap-switch'), 'valueChange', true);
    await waitFor(() => expect(screen.queryByTestId('garmin-auto-swap-stopped')).toBeNull());
    expect(mockSettings.has('veloq-garmin-auto-swap-stopped')).toBe(false);
  });

  it('asks for write access first and stays off when it is refused', async () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    mockUpgrade.mockResolvedValue({ granted: false, error: null });
    const screen = await connectedScreen(false);
    fireEvent(screen.getByTestId('garmin-auto-swap-switch'), 'valueChange', true);
    await waitFor(() => expect(mockUpgrade).toHaveBeenCalledTimes(1));
    expect(mockSettings.has('veloq-garmin-auto-swap')).toBe(false);
  });

  it('is forgotten with the rest of the connector on disconnect', async () => {
    mockSettings.set('veloq-garmin-auto-swap', '2026-10-26T09:00:00.000Z');
    mockSettings.set('veloq-garmin-auto-swap-stopped', 'why');
    const screen = await connectedScreen(false);
    fireEvent.press(screen.getByTestId('garmin-disconnect'));
    await waitFor(() => expect(mockSettings.has('veloq-garmin-auto-swap')).toBe(false));
    expect(mockSettings.has('veloq-garmin-auto-swap-stopped')).toBe(false);
  });
});

describe('the Garmin connector account line after a paste', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockSettings.clear();
    jest.clearAllMocks();
    (engineKey.connectGarmin as jest.Mock).mockResolvedValue(GarminKeyStatus.Connected);
  });

  async function pasteAndConnect(account: unknown) {
    (engineKey.garminAccount as jest.Mock).mockResolvedValueOnce(account);
    const screen = await render(<GarminConnector />);
    fireEvent.changeText(screen.getByTestId('garmin-key-input'), 'invented-key');
    fireEvent.press(screen.getByTestId('garmin-connect'));
    await waitFor(() => expect(screen.getByTestId('garmin-disconnect')).toBeTruthy());
    return screen;
  }

  it('shows the matched line when the rides match intervals.icu', async () => {
    const screen = await pasteAndConnect({
      displayName: 'Invented Athlete',
      matched: GarminMatch.Matched,
      matchedCount: 18,
    });
    expect(screen.getByText('garmin.statusMatched')).toBeTruthy();
    expect(screen.queryByTestId('garmin-account-warning')).toBeNull();
  });

  it('warns that the rides are not in intervals.icu when the import is on and none of them are', async () => {
    const screen = await pasteAndConnect({
      displayName: 'Invented Athlete',
      matched: GarminMatch.WrongAccount,
      matchedCount: 0,
    });
    expect(screen.getByText('garmin.statusConnectedAs')).toBeTruthy();
    expect(screen.getByTestId('garmin-account-warning')).toBeTruthy();
  });

  it('shows the account alone when the window has nothing to compare', async () => {
    const screen = await pasteAndConnect({ matched: GarminMatch.Silent, matchedCount: 0 });
    expect(screen.getByText('garmin.statusConnectedAs')).toBeTruthy();
    expect(screen.queryByTestId('garmin-account-warning')).toBeNull();
  });
});
