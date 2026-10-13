/**
 * Scenario: every gate that asks what the signed-in source can do (push, the
 * write-scope check, recording, uploads) reads the same auth state.
 *
 * Expected behaviour: for every state the store can hold, each gate gives the
 * answer it gave before those gates shared one owner.
 */

import { renderHook } from '@testing-library/react-native';
import { UploadOutcome, engine } from 'veloqrs';

import { useAuthStore, type AuthMethod } from '@/shared/app/AuthStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useCanRecord } from '@/features/recording/hooks/useCanRecord';
import { useWriteAccessMissing } from '@/features/recording/hooks/useWriteAccessMissing';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { reconcilePushRegistrationOnLaunch } from '@/features/settings/lib/reconcilePushRegistration';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: { uploadRecording: jest.fn() },
  })
);

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  recordingInstall: jest.fn(() => 4),
  transitionRecording: jest.fn(async () => ({ applied: true })),
}));

const mockEnsureRegistered = jest.fn(async (_athleteId: string) => true);
jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  ...jest.requireActual('@/features/settings/lib/pushTokenRegistration'),
  ensurePushTokenRegistered: (id: string) => mockEnsureRegistered(id),
}));

const { authorizationHeader } = jest.requireActual(
  '@/features/settings/lib/pushTokenRegistration'
) as typeof import('@/features/settings/lib/pushTokenRegistration');

interface State {
  name: string;
  authMethod: AuthMethod;
  isDemoMode: boolean;
  athleteId: string | null;
}

function state(authMethod: AuthMethod, isDemoMode: boolean, athleteId: string | null): State {
  return {
    name: `${authMethod}/${isDemoMode ? 'demo' : 'live'}/${athleteId}`,
    authMethod,
    isDemoMode,
    athleteId,
  };
}

interface Expected {
  header: string | null;
  canRecord: [boolean, string];
  writeMissing: boolean;
  uploadReachesEngine: boolean;
  registersOnLaunch: boolean;
}

const ROWS: [State, Expected][] = [
  [
    state('oauth', false, 'i1'),
    {
      header: 'Bearer tok',
      canRecord: [false, 'no_permission'],
      writeMissing: true,
      uploadReachesEngine: true,
      registersOnLaunch: true,
    },
  ],
  [
    state('oauth', false, null),
    {
      header: 'Bearer tok',
      canRecord: [false, 'no_permission'],
      writeMissing: true,
      uploadReachesEngine: true,
      registersOnLaunch: false,
    },
  ],
  [
    state('apiKey', false, 'i1'),
    {
      header: null,
      canRecord: [true, 'ok'],
      writeMissing: false,
      uploadReachesEngine: true,
      registersOnLaunch: true,
    },
  ],
  [
    state('apiKey', false, null),
    {
      header: null,
      canRecord: [true, 'ok'],
      writeMissing: false,
      uploadReachesEngine: true,
      registersOnLaunch: false,
    },
  ],
  [
    state('demo', true, 'demo'),
    {
      header: null,
      canRecord: [true, 'ok'],
      writeMissing: false,
      uploadReachesEngine: false,
      registersOnLaunch: false,
    },
  ],
  [
    state('demo', true, null),
    {
      header: null,
      canRecord: [true, 'ok'],
      writeMissing: false,
      uploadReachesEngine: false,
      registersOnLaunch: false,
    },
  ],
  [
    state(null, false, 'i1'),
    {
      header: null,
      canRecord: [false, 'not_signed_in'],
      writeMissing: false,
      uploadReachesEngine: true,
      registersOnLaunch: true,
    },
  ],
  [
    state(null, false, null),
    {
      header: null,
      canRecord: [false, 'not_signed_in'],
      writeMissing: false,
      uploadReachesEngine: true,
      registersOnLaunch: false,
    },
  ],
  [
    state('apiKey', false, 'demo'),
    {
      header: null,
      canRecord: [true, 'ok'],
      writeMissing: false,
      uploadReachesEngine: false,
      registersOnLaunch: true,
    },
  ],
  [
    state('oauth', false, 'demo'),
    {
      header: 'Bearer tok',
      canRecord: [false, 'no_permission'],
      writeMissing: true,
      uploadReachesEngine: false,
      registersOnLaunch: true,
    },
  ],
  [
    state(null, false, 'demo'),
    {
      header: null,
      canRecord: [false, 'not_signed_in'],
      writeMissing: false,
      uploadReachesEngine: false,
      registersOnLaunch: true,
    },
  ],
];

const mockUpload = engine.uploadRecording as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  useUploadPermissionStore.setState({ hasWritePermission: false, isLoaded: true });
  useNotificationPreferences.setState({
    enabled: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
  });
});

describe.each(ROWS)('%o', ({ authMethod, isDemoMode, athleteId }, expected) => {
  beforeEach(() => {
    useAuthStore.setState({ authMethod, isDemoMode, athleteId });
  });

  it('authorises push only with an OAuth token', () => {
    expect(authorizationHeader({ authMethod, accessToken: ' tok ', apiKey: 'key' })).toBe(
      expected.header
    );
  });

  it('answers whether the athlete may record', () => {
    const { result } = renderHook(() => useCanRecord());
    expect([result.current.canRecord, result.current.reason]).toEqual(expected.canRecord);
  });

  it('answers whether the write scope is missing', () => {
    const { result } = renderHook(() => useWriteAccessMissing());
    expect(result.current).toBe(expected.writeMissing);
  });

  it('sends an upload to the engine only for a real account', async () => {
    await uploadRecordingNow('ride');
    expect(mockUpload.mock.calls.length > 0).toBe(expected.uploadReachesEngine);
  });

  it('registers the push token at launch only for a real session', () => {
    reconcilePushRegistrationOnLaunch();
    expect(mockEnsureRegistered.mock.calls.length > 0).toBe(expected.registersOnLaunch);
  });
});

it('reads a write scope still loading as checking for OAuth alone', () => {
  useUploadPermissionStore.setState({ hasWritePermission: null, isLoaded: false });
  useAuthStore.setState({ authMethod: 'oauth', isDemoMode: false, athleteId: 'i1' });
  expect(renderHook(() => useCanRecord()).result.current.reason).toBe('checking');
  useAuthStore.setState({ authMethod: 'apiKey' });
  expect(renderHook(() => useCanRecord()).result.current.reason).toBe('ok');
});

it('grants an OAuth athlete whose token carries the write scope', () => {
  useUploadPermissionStore.setState({ hasWritePermission: true, isLoaded: true });
  useAuthStore.setState({ authMethod: 'oauth', isDemoMode: false, athleteId: 'i1' });
  expect(renderHook(() => useCanRecord()).result.current).toEqual({
    canRecord: true,
    reason: 'ok',
  });
  expect(renderHook(() => useWriteAccessMissing()).result.current).toBe(false);
});
