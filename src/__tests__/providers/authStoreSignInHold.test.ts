/**
 * Scenario: a 401 signs the phone out with rides still queued, they are held
 * rather than demoted, and someone else signs in on the same phone.
 *
 * Expected behaviour: the auth store holds every ride the incoming athlete did
 * not record as soon as they are signed in, with nothing mounted to do it, and
 * holds nothing while nobody is.
 */

import { useAuthStore } from '@/shared/app/AuthStore';
import { holdRecordingsOfOtherAthletes } from '@/features/recording/lib/storage/recordingLibrary';

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  holdRecordingsOfOtherAthletes: jest.fn(async () => undefined),
}));
jest.mock('@/features/recording/lib/holdRecordingOnSignOut', () => ({
  holdRecordingOnSignOut: jest.fn(async () => undefined),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => null),
}));
jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(async () => true),
  unregisterPushToken: jest.fn(async () => true),
}));

const mockHold = jest.mocked(holdRecordingsOfOtherAthletes);

beforeEach(() => {
  useAuthStore.setState({ athleteId: null, isAuthenticated: false, authMethod: null });
  jest.clearAllMocks();
});

it('holds what the athlete signing in did not record', async () => {
  await useAuthStore.getState().setCredentials('key-one', 'i1001');

  expect(mockHold).toHaveBeenCalledTimes(1);
  expect(mockHold).toHaveBeenCalledWith('i1001');
});

it('holds again for whoever signs in next', async () => {
  await useAuthStore.getState().setCredentials('key-one', 'i1001');
  await useAuthStore.getState().setOAuthCredentials('token-two', 'i400');

  expect(mockHold).toHaveBeenCalledTimes(2);
  expect(mockHold).toHaveBeenLastCalledWith('i400');
});

it('holds once when the same athlete signs in again', async () => {
  await useAuthStore.getState().setCredentials('key-one', 'i1001');
  await useAuthStore.getState().setCredentials('key-two', 'i1001');

  expect(mockHold).toHaveBeenCalledTimes(1);
});

it('holds nothing on a sign-out, which is not a decision it can take', async () => {
  useAuthStore.setState({ athleteId: 'i1001', isAuthenticated: true, authMethod: 'apiKey' });
  mockHold.mockClear();

  await useAuthStore.getState().clearCredentials();

  expect(mockHold).not.toHaveBeenCalled();
});

it('holds for the demo athlete on entering demo mode', () => {
  useAuthStore.getState().enterDemoMode();

  expect(mockHold).toHaveBeenCalledWith('demo');
});

it('survives a hold the engine refuses', async () => {
  mockHold.mockRejectedValueOnce(new Error('Engine not initialised'));

  await expect(useAuthStore.getState().setCredentials('key-one', 'i1001')).resolves.toBeUndefined();
});
