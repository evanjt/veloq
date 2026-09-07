/**
 * Scenario: a 401 signs the phone out with rides still in the upload queue.
 * The rides are held rather than demoted, so whoever signs in next meets a
 * queue that is not necessarily theirs.
 *
 * Expected behaviour: signing in holds every ride the signing-in athlete did
 * not record, an unstamped one included, and leaves their own alone. Nothing
 * is deleted either way.
 */

import {
  holdRecordingsOfOtherAthletes,
  holdRecordingForAuth,
} from '@/features/recording/lib/storage/recordingLibrary';

const mockHoldOtherAthletes = jest.fn(() => 2);
const mockHoldForAuth = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    holdRecordingsOfOtherAthletes: mockHoldOtherAthletes,
    holdRecordingForAuth: mockHoldForAuth,
  }),
}));

jest.mock('@/shared/debug/debug', () => ({
  debug: {
    log: () => {},
    warn: () => {},
    error: () => {},
    create: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockHoldOtherAthletes.mockReturnValue(2);
});

describe('holding what is not the signing athlete-s', () => {
  it('asks the engine for the athlete who is signing in, and answers how many were held', async () => {
    await expect(holdRecordingsOfOtherAthletes('i296629')).resolves.toBe(2);
    expect(mockHoldOtherAthletes).toHaveBeenCalledWith('i296629');
  });

  it('says nothing was held when nothing was', async () => {
    mockHoldOtherAthletes.mockReturnValue(0);
    await expect(holdRecordingsOfOtherAthletes('i296629')).resolves.toBe(0);
  });
});

describe('holding a ride whose credential was refused', () => {
  it('passes the reason through, so the library can say why it is waiting', async () => {
    await holdRecordingForAuth('rec-1', 'unauthorized (401)');
    expect(mockHoldForAuth).toHaveBeenCalledWith('rec-1', 'unauthorized (401)');
  });
});
