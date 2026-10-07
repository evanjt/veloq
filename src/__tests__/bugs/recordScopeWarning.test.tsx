/**
 * Scenario: an OAuth athlete whose write scope is missing or stale opens the
 * record screen offline. The screen was replaced by a wall whose only action was
 * an OAuth round trip, so the ride was not recorded at all.
 *
 * Expected behaviour: the missing scope is a warning, not a refusal. The grant
 * action stays for when the network is there, a continue records anyway, and the
 * ride the athlete took that way is saved to the device and never queued for
 * upload. A missing account is still a wall: that ride has nowhere to go.
 */

import React from 'react';
import { fireEvent, render, renderHook, act } from '@testing-library/react-native';
import { UploadOutcome } from 'veloqrs';

import { RecordingGate } from '@/features/recording/components/RecordingGate';
import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingStreams } from '@/features/recording/types';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/recording/lib/fitGenerator', () => ({
  generateFitFile: jest.fn().mockResolvedValue(new ArrayBuffer(64)),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  saveRecording: jest.fn(),
  attachEngineActivity: jest.fn(async () => null),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  writeProvisionalActivity: jest.fn(async () => 'local-deadbeef'),
}));
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/auth', () => ({ isOAuthConfigured: () => true }));
jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

const STREAMS: RecordingStreams = {
  time: [0, 1],
  latlng: [
    [45.0, 10.0],
    [45.001, 10.001],
  ],
  altitude: [100, 101],
  heartrate: [120, 130],
  power: [0, 0],
  cadence: [0, 0],
  speed: [8, 8],
  distance: [0, 8],
};

function saveArgs() {
  return {
    isManual: false,
    type: 'Ride' as const,
    name: 'Morning Ride',
    summary: { duration: 2, distance: 8, avgHeartrate: 125, elevationGain: 1 },
    notes: '',
    startTime: 1_700_000_000_000,
    pausedSecondsInWindow: 0,
    laps: [],
    pairedEventId: null,
    getTrimmedStreams: () => STREAMS,
    canTrim: false,
    trimStartIndex: 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0 as never;
  }) as never);
  (generateFitFile as jest.Mock).mockResolvedValue(new ArrayBuffer(64));
  (saveRecording as jest.Mock).mockResolvedValue({ id: 'rec-1' });
  useRecordingPreferences.setState({ autoUploadEnabled: true });
  useUploadPermissionStore.setState({
    hasWritePermission: false,
    needsUpgrade: true,
    recordingWithoutScope: false,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('the missing-scope gate', () => {
  it('offers a continue beside the grant action', () => {
    const onContinue = jest.fn();
    const tree = render(
      <RecordingGate reason="no_permission" onGrantAccess={jest.fn()} onContinue={onContinue} />
    );

    expect(tree.getByTestId('record-grant-access')).toBeTruthy();
    fireEvent.press(tree.getByTestId('recording-gate-continue'));

    expect(onContinue).toHaveBeenCalled();
  });

  it('offers no continue to an athlete with no account', () => {
    const tree = render(
      <RecordingGate reason="not_signed_in" onGrantAccess={jest.fn()} onContinue={jest.fn()} />
    );

    expect(tree.queryByTestId('recording-gate-continue')).toBeNull();
  });
});

describe('a ride recorded past the warning', () => {
  it('is saved to the device even with auto-upload on', async () => {
    useUploadPermissionStore.getState().continueWithoutScope();

    const { result } = renderHook(() => useReviewSave(saveArgs()));
    await act(() => result.current.handleSave());

    expect(saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ uploadStatus: 'localOnly' })
    );
    expect(uploadRecordingNow).not.toHaveBeenCalled();
  });

  it('is queued as usual once the scope is there again', async () => {
    (uploadRecordingNow as jest.Mock).mockResolvedValue({ outcome: UploadOutcome.Uploaded });
    useUploadPermissionStore.setState({ hasWritePermission: true, recordingWithoutScope: false });

    const { result } = renderHook(() => useReviewSave(saveArgs()));
    await act(() => result.current.handleSave());

    expect(saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ uploadStatus: 'pending' })
    );
    expect(uploadRecordingNow).toHaveBeenCalledWith('rec-1');
  });

  it('does not carry the flag into the next ride', async () => {
    useUploadPermissionStore.getState().continueWithoutScope();

    const { result } = renderHook(() => useReviewSave(saveArgs()));
    await act(() => result.current.handleSave());

    expect(useUploadPermissionStore.getState().recordingWithoutScope).toBe(false);
  });
});
