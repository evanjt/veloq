/**
 * Scenario: a signed-out athlete taps record on a widget, a launcher shortcut,
 * the Quick Settings tile or the iOS control. Before the one-tap surfaces those
 * taps landed on the picker, which is gated. They now land on the recording
 * screen, which was not.
 *
 * Expected behaviour: nothing records without an account. The screen gates
 * rather than starting, `useCanRecord` says sign-in rather than scope, and the
 * snapshot hands the surfaces no URL that starts a ride while signed out, so a
 * stale shortcut cannot get past the gate either.
 */

import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useCanRecord } from '@/features/recording/hooks/useCanRecord';
import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

describe('useCanRecord separates a missing account from a missing scope', () => {
  it('says not signed in when there is no account at all', () => {
    useAuthStore.setState({ authMethod: null });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current).toEqual({ canRecord: false, reason: 'not_signed_in' });
  });

  it('still says no permission for an OAuth account without write', () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ hasWritePermission: false });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current).toEqual({ canRecord: false, reason: 'no_permission' });
  });

  it.each(['apiKey', 'demo'] as const)('lets a %s account record', (authMethod) => {
    useAuthStore.setState({ authMethod });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current.canRecord).toBe(true);
  });

  it('lets an OAuth account with write record', () => {
    useAuthStore.setState({ authMethod: 'oauth' });
    useUploadPermissionStore.setState({ hasWritePermission: true });
    const { result } = renderHook(() => useCanRecord());
    expect(result.current.canRecord).toBe(true);
  });
});

describe('the recording screen starts nothing it is not allowed to start', () => {
  beforeEach(() => {
    jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not start when the athlete cannot record', () => {
    renderHook(() => useInitRecordingEffect('idle', 'Ride', 'gps', undefined, false));
    expect(useRecordingStore.getState().startRecording).not.toHaveBeenCalled();
  });

  it('starts when the athlete can', () => {
    renderHook(() => useInitRecordingEffect('idle', 'Ride', 'gps', undefined, true));
    expect(useRecordingStore.getState().startRecording).toHaveBeenCalledWith(
      'Ride',
      'gps',
      undefined
    );
  });
});

describe('the surfaces are handed no ride-starting URL while signed out', () => {
  const mockEngine = { getWidgetSnapshot: jest.fn(() => undefined) };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));
  });

  afterEach(() => {
    jest.dontMock('@/shared/native/engine');
  });

  function gather() {
    const { setRecentRecordingTypes } = require('@/shared/recording');
    setRecentRecordingTypes(['Ride']);
    const { gatherWidgetSnapshot } = require('@/features/home/lib/widgetSnapshot');
    return gatherWidgetSnapshot({ locale: 'en-AU', isMetric: true, now: new Date(0) });
  }

  it('gathers no shortcuts when there is no account, so a stale one is cleared', () => {
    require('@/shared/app/AuthStore').useAuthStore.setState({ authMethod: null });
    expect(gather().recordShortcuts).toEqual([]);
  });

  it('gathers them again once there is one', () => {
    require('@/shared/app/AuthStore').useAuthStore.setState({ authMethod: 'apiKey' });
    expect(gather().recordShortcuts).toHaveLength(1);
  });
});
