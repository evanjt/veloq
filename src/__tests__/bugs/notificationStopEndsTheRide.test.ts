/**
 * Scenario: the recording notification's STOP button called
 * `store.stopRecording()` and stopped there. The screen's own Stop does three
 * things: the store transition, a backup written so an app kill on the review
 * screen cannot lose the ride, and the route to review. A rider who stopped
 * from the notification got the first, so the ride sat stopped, unsaved and
 * unreachable, and an app kill lost it.
 *
 * Expected behaviour: stopping from the notification ends the ride the same way
 * stopping from the screen does, because both go through one function.
 */

import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { applyRecordingNotificationAction } from '@/features/recording/lib/recordingNotification';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockSaveBackup = jest.fn();
const mockBuildBackup = jest.fn((_state: unknown) => ({ startTime: 1 }));
const mockNavigateTo = jest.fn();

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: (state: unknown) => mockBuildBackup(state),
  saveRecordingBackup: (...args: unknown[]) => mockSaveBackup(...args),
  clearRecordingBackup: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
});

describe('stopping from the notification', () => {
  it('stops the store, as it always did', async () => {
    await applyRecordingNotificationAction('stop');

    expect(useRecordingStore.getState().status).toBe('stopped');
  });

  it('writes the backup, so an app kill on the review screen cannot lose the ride', async () => {
    await applyRecordingNotificationAction('stop');

    expect(mockSaveBackup).toHaveBeenCalledTimes(1);
  });

  it('builds the backup from the stopped state, not the running one', async () => {
    await applyRecordingNotificationAction('stop');

    const state = mockBuildBackup.mock.calls[0][0] as { status?: string; stopTime?: number | null };
    expect(state.status).toBe('stopped');
    expect(state.stopTime).toEqual(expect.any(Number));
  });

  it('persists even when there is no screen to navigate to, which a broadcast has', async () => {
    mockNavigateTo.mockImplementation(() => {
      throw new Error('no navigator mounted');
    });

    await applyRecordingNotificationAction('stop');

    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(mockSaveBackup).toHaveBeenCalledTimes(1);
  });

  it('routes to review, so the ride is reachable when the app comes forward', async () => {
    await applyRecordingNotificationAction('stop');

    expect(mockNavigateTo).toHaveBeenCalledWith('/recording/review');
  });

  it('leaves a session that already ended alone, rather than backing it up twice', async () => {
    await applyRecordingNotificationAction('stop');
    await applyRecordingNotificationAction('stop');

    expect(mockSaveBackup).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
  });
});

describe('the one function both surfaces call', () => {
  it('ends the ride when called directly, which is what the screen does', async () => {
    await endRecordingSession();

    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(mockSaveBackup).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).toHaveBeenCalledWith('/recording/review');
  });

  it('does not write a backup for a session that never started', async () => {
    useRecordingStore.getState().reset();

    await endRecordingSession();

    expect(mockSaveBackup).not.toHaveBeenCalled();
  });
});
