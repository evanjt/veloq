/**
 * Scenario: a widget, tile, shortcut or Siri phrase cold-starts the app straight
 * into the recording screen, on a launch where the upload-permission store has
 * not finished loading. `hasWritePermission` is still null, and null used to
 * read as "no write scope".
 *
 * Expected behaviour: "not yet known" and "known to be missing" are different
 * answers. The recording screen waits for the store rather than gating on an
 * answer that has not arrived, and it does not start the ride while it waits
 * either. The picker keeps today's behaviour, where gating on an unknown answer
 * costs an athlete who is still choosing a sport nothing.
 */

import React from 'react';
import { render, renderHook, screen } from '@testing-library/react-native';

import RecordingScreen from '@/app/recording/[type]';
import RecordScreen from '@/app/record';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useCanRecord } from '@/features/recording/hooks/useCanRecord';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

const mockGetSetting = jest.fn();
const mockCanRecord = jest.fn();
const mockGate = jest.fn();

// The screens take the answer from the feature barrel, so it is set here, and
// the hook itself is driven through its own path in the blocks above.
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    ...jest.requireActual('@/features/recording/lib/armCountdown'),
    RecordingMap: jest.requireMock('@/features/recording/components/RecordingMap').RecordingMap,
    useRecordingPreferences: jest.requireActual(
      '@/features/recording/stores/RecordingPreferencesStore'
    ).useRecordingPreferences,
    WorkoutGuide: jest.requireActual('@/features/recording/components/WorkoutGuide').WorkoutGuide,
    RecordingCloseButton: jest.requireActual('@/features/recording/components/RecordingCloseButton')
      .RecordingCloseButton,
    RecordingGate: (props: object) => {
      mockGate(props);
      return null;
    },
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => mockCanRecord(),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
    promptInterruptedRecording: jest.fn(async () => undefined),
    sessionReturnRoute: jest.requireActual('@/features/recording/lib/sessionReturnRoute')
      .sessionReturnRoute,
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ type: 'Ride' }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useScreenSafeAreaEdges: () => ['top', 'bottom', 'left', 'right'],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/features/recording/components/RecordingMap', () => ({ RecordingMap: () => null }));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/DataFieldGrid', () => ({ DataFieldGrid: () => null }));
jest.mock('@/features/recording/components/ControlBar', () => ({ ControlBar: () => null }));

jest.mock('@/shared/storage', () => ({
  getSetting: (...a: unknown[]) => mockGetSetting(...a),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useUploadPermissionStore.setState({
    hasWritePermission: null,
    isLoaded: false,
    needsUpgrade: false,
    bannerDismissed: false,
    grantedScopes: null,
  });
});

describe('an answer that has not arrived is not an answer of no', () => {
  it('says checking while the store is still loading', () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current).toEqual({ canRecord: false, reason: 'checking' });
  });

  it('says no permission once the store has loaded and there is none', () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: false });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current).toEqual({ canRecord: false, reason: 'no_permission' });
  });

  it('records once the store has loaded and there is', () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: true });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current).toEqual({ canRecord: true, reason: 'ok' });
  });

  it('does not wait for a store that cannot answer for this account', () => {
    for (const authMethod of ['apiKey', 'demo'] as const) {
      useAuthStore.setState({ authMethod });
      const { result } = renderHook(() => useCanRecord());
      expect(result.current).toEqual({ canRecord: true, reason: 'ok' });
    }
  });

  it('still says not signed in first, whatever the store is doing', () => {
    useAuthStore.setState({ authMethod: null });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current.reason).toBe('not_signed_in');
  });

  it('does not answer early on a scope that arrived before the store loaded', () => {
    // setFromOAuthScope is how a fresh sign-in answers, and it answers for good.
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,ACTIVITY:WRITE');
    const { result } = renderHook(() => useCanRecord());
    expect(result.current).toEqual({ canRecord: true, reason: 'ok' });
  });
});

describe('the store says when it has an answer', () => {
  it('is loaded once initialize has run, with nothing stored', async () => {
    mockGetSetting.mockResolvedValue(null);
    await useUploadPermissionStore.getState().initialize();
    expect(useUploadPermissionStore.getState().isLoaded).toBe(true);
    expect(useUploadPermissionStore.getState().hasWritePermission).toBeNull();
  });

  it('is loaded once initialize has run, with something stored', async () => {
    mockGetSetting.mockResolvedValue(JSON.stringify({ hasWritePermission: true }));
    await useUploadPermissionStore.getState().initialize();
    expect(useUploadPermissionStore.getState().isLoaded).toBe(true);
    expect(useUploadPermissionStore.getState().hasWritePermission).toBe(true);
  });

  it('is loaded even when the read throws, or the screen waits forever', async () => {
    mockGetSetting.mockRejectedValue(new Error('no'));
    await useUploadPermissionStore.getState().initialize();
    expect(useUploadPermissionStore.getState().isLoaded).toBe(true);
  });

  it('is unloaded again on reset, because a sign-out has no answer either', () => {
    useUploadPermissionStore.setState({ isLoaded: true, hasWritePermission: true });
    useUploadPermissionStore.getState().reset();
    expect(useUploadPermissionStore.getState().isLoaded).toBe(false);
  });
});

describe('the screens act on the difference', () => {
  const CHECKING = { canRecord: false, reason: 'checking' as const };

  beforeEach(() => {
    useRecordingStore.getState().reset();
    mockCanRecord.mockReturnValue(CHECKING);
  });

  afterEach(() => {
    useRecordingStore.getState().reset();
  });

  it('the recording screen waits rather than gating, and starts nothing while it waits', () => {
    render(<RecordingScreen />);

    expect(screen.getByTestId('recording-checking')).toBeTruthy();
    expect(screen.getByTestId('recording-close')).toBeTruthy();
    expect(mockGate).not.toHaveBeenCalled();
    expect(useRecordingStore.getState().status).toBe('idle');
  });

  it('the recording screen offers a way off beside the gate', () => {
    mockCanRecord.mockReturnValue({ canRecord: false, reason: 'no_permission' as const });
    render(<RecordingScreen />);

    expect(mockGate).toHaveBeenCalled();
    expect(screen.getByTestId('recording-close')).toBeTruthy();
  });

  it('the recording screen starts the ride once the answer is yes', () => {
    mockCanRecord.mockReturnValue({ canRecord: true, reason: 'ok' });
    render(<RecordingScreen />);

    expect(screen.queryByTestId('recording-checking')).toBeNull();
    expect(useRecordingStore.getState().status).not.toBe('idle');
  });

  it('the picker keeps gating, where an athlete is still choosing a sport', () => {
    render(<RecordScreen />);

    expect(mockGate).toHaveBeenCalled();
    // The gate is never handed an answer that has not come: the picker shows
    // it as the scope gate, with no way to continue past a scope not yet known
    // to be missing.
    const props = mockGate.mock.calls[0][0] as { reason: string; onContinue?: unknown };
    expect(props.reason).toBe('no_permission');
    expect(props.onContinue).toBeUndefined();
  });
});
