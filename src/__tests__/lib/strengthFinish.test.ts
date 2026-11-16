/**
 * Scenario: an athlete who logs weights in pounds finishes a recorded strength session.
 * Expected behaviour: the session is finished by the engine, which writes the FIT in the
 * athlete's own unit, and that row is what is uploaded. The effort goes with the finish, a
 * session with no done set is not finished, and a row that must stay on the device is never
 * handed to the upload.
 */

import { UploadOutcome, recordings } from 'veloqrs';

import { finishStrengthSession, savedNoticeKey } from '@/features/recording/lib/strengthFinish';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    recordings: { finishStrengthRecording: jest.fn(), uploadRecording: jest.fn() },
  })
);

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

const mockAuth = { authMethod: 'oauth', isDemoMode: false, athleteId: 'i42' };
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuth },
  getStoredCredentials: () => ({ athleteId: 'i42' }),
  DEMO_ATHLETE_ID: 'demo',
}));

jest.mock('@/shared/native/engine', () => ({ getEngine: () => ({ ready: true }) }));

const mockWriteProvisional = jest.fn();
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  writeProvisionalActivity: (entry: unknown) => mockWriteProvisional(entry),
}));

const mockPreferences = { autoUploadEnabled: true };
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  useRecordingPreferences: { getState: () => mockPreferences },
}));

const mockPermission = { recordingWithoutScope: false };
jest.mock('@/features/recording/stores/UploadPermissionStore', () => ({
  useUploadPermissionStore: { getState: () => mockPermission },
}));

jest.mock('@/shared/app/source', () => ({
  sourceFor: () => ({ can: { uploads: true } }),
}));

const mockFinish = recordings.finishStrengthRecording as jest.Mock;
const mockUpload = recordings.uploadRecording as jest.Mock;

function finishedRow(id: string) {
  return {
    id,
    kind: 'fit',
    fitPath: `recordings/${id}.fit`,
    activityType: 'WeightTraining',
    name: 'Strength session',
    startTime: 1000,
    durationSeconds: 600,
    distanceMeters: 0,
    createdAt: 1000,
    uploadStatus: 'pending',
    retryCount: 0,
    engineReconciled: false,
    rpeSent: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPreferences.autoUploadEnabled = true;
  mockPermission.recordingWithoutScope = false;
  mockFinish.mockImplementation((input: { recordingId: string }) => ({
    kind: 'finished',
    entry: finishedRow(input.recordingId),
  }));
  mockUpload.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
});

describe('finishing a strength session', () => {
  it('finishes through the engine under the athlete and uploads the row the engine wrote', async () => {
    const outcome = await finishStrengthSession({
      name: 'Strength session',
      rpe: 7,
      athleteId: 'i42',
    });

    expect(mockFinish).toHaveBeenCalledTimes(1);
    const input = mockFinish.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      name: 'Strength session',
      athleteId: 'i42',
      rpe: 7,
      keepOnDevice: false,
      filesRoot: 'file:///docs/',
    });
    expect(input.nowSeconds).toBeGreaterThan(1_700_000_000);
    expect(mockUpload).toHaveBeenCalledWith(input.recordingId, true, 'file:///docs/');
    expect(mockWriteProvisional).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ kind: 'saved', kept: null });
    expect(outcome.kind === 'saved' && outcome.upload?.outcome).toBe(UploadOutcome.Uploaded);
  });

  it('leaves the effort absent when the slider was never moved', async () => {
    await finishStrengthSession({ name: 'Strength session', rpe: null, athleteId: 'i42' });

    expect(mockFinish.mock.calls[0]?.[0].rpe).toBeUndefined();
  });

  it('answers noSets and writes and uploads nothing when no set was done', async () => {
    mockFinish.mockReturnValue({ kind: 'noSets' });

    const outcome = await finishStrengthSession({
      name: 'Strength session',
      rpe: null,
      athleteId: 'i42',
    });

    expect(outcome).toEqual({ kind: 'noSets' });
    expect(mockWriteProvisional).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['auto-upload is off', () => (mockPreferences.autoUploadEnabled = false), 'autoUploadOff'],
    [
      'the athlete recorded past the missing scope',
      () => (mockPermission.recordingWithoutScope = true),
      'noUploadScope',
    ],
  ])('keeps the row on the device and tries no upload when %s', async (_name, arrange, reason) => {
    arrange();

    const outcome = await finishStrengthSession({
      name: 'Strength session',
      rpe: null,
      athleteId: 'i42',
    });

    expect(mockFinish.mock.calls[0]?.[0].keepOnDevice).toBe(true);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: 'saved', kept: reason, upload: null });
  });

  it('propagates an engine refusal so the session stays live and the screen can say so', async () => {
    mockFinish.mockImplementation(() => {
      throw new Error('no strength session is live');
    });

    await expect(
      finishStrengthSession({ name: 'Strength session', rpe: null, athleteId: 'i42' })
    ).rejects.toThrow('no strength session is live');
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('the notice for a saved session', () => {
  const saved = (
    kept: Parameters<typeof savedNoticeKey>[0]['kept'],
    upload: Parameters<typeof savedNoticeKey>[0]['upload']
  ) => ({ kind: 'saved' as const, entry: {} as never, kept, upload });

  it('says nothing when the upload landed', () => {
    expect(savedNoticeKey(saved(null, { outcome: UploadOutcome.Uploaded }))).toBeNull();
  });

  it.each([
    [UploadOutcome.Network, 'recording.savedQueued'],
    [UploadOutcome.NotStarted, 'recording.savedQueued'],
    [UploadOutcome.Rejected, 'recording.uploadRejected'],
    [UploadOutcome.PermissionBlocked, 'recording.savedLocallyNoScope'],
    [UploadOutcome.AuthExpired, 'recording.savedQueuedAuth'],
  ])('names where the row waits after upload outcome %s', (outcome, key) => {
    expect(savedNoticeKey(saved(null, { outcome }))).toBe(key);
  });

  it('names why a row kept on the device was not sent', () => {
    expect(savedNoticeKey(saved('autoUploadOff', null))).toBe('recording.savedLocally');
    expect(savedNoticeKey(saved('noUploadScope', null))).toBe('recording.savedLocallyNoScope');
  });
});
