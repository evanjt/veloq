/**
 * Scenario: an athlete without upload access takes a ride past the warning,
 * then the ride ends unsaved or upload access arrives.
 * Expected behaviour: the "recorded without scope" mark belongs to that one
 * ride, so it is gone once the ride ends or write access is granted, and the
 * next ride's save is free to upload.
 */
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

const withoutScope = () => useUploadPermissionStore.getState().recordingWithoutScope;

beforeEach(() => {
  useUploadPermissionStore.getState().reset();
  useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ');
  useUploadPermissionStore.getState().continueWithoutScope();
});

it('forgets the mark when an OAuth upgrade grants write access', () => {
  useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,ACTIVITY:WRITE');
  expect(withoutScope()).toBe(false);
});

it('keeps the mark when a scope answer still lacks write access', () => {
  useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,WELLNESS:READ');
  expect(withoutScope()).toBe(true);
});

it('forgets the mark when write permission is set granted', () => {
  useUploadPermissionStore.getState().setHasWritePermission(true);
  expect(withoutScope()).toBe(false);
});

it('keeps the mark when write permission is set denied', () => {
  useUploadPermissionStore.getState().setHasWritePermission(false);
  expect(withoutScope()).toBe(true);
});

it('forgets the mark when the ride it belongs to is discarded', () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.getState().reset();
  expect(withoutScope()).toBe(false);
});

it('keeps the mark through the start of the ride it was given for', () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  expect(withoutScope()).toBe(true);
  useRecordingStore.getState().reset();
});
