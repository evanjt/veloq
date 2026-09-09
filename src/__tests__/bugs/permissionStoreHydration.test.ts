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

import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useCanRecord } from '@/features/recording/hooks/useCanRecord';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

const mockGetSetting = jest.fn();

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
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../../..');
  const RECORDING = fs.readFileSync(path.join(root, 'src/app/recording/[type].tsx'), 'utf8');
  const PICKER = fs.readFileSync(path.join(root, 'src/app/record.tsx'), 'utf8');
  const GATE = fs.readFileSync(
    path.join(root, 'src/features/recording/components/RecordingGate.tsx'),
    'utf8'
  );

  it('the recording screen waits rather than gating, and starts nothing while it waits', () => {
    expect(RECORDING).toContain("reason === 'checking'");
    // The start is gated on canRecord, which `checking` leaves false.
    expect(RECORDING).toContain(
      'useInitRecordingEffect(status, activityType, mode, pairedEventId, canRecord)'
    );
  });

  it('the gate itself never renders a refusal for an answer that has not come', () => {
    expect(GATE).toContain("reason: 'no_permission' | 'not_signed_in'");
  });

  it('the picker keeps gating, where an athlete is still choosing a sport', () => {
    expect(PICKER).toContain("!canRecord && reason !== 'ok'");
  });
});
