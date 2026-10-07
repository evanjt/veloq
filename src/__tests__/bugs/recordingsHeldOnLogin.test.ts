/**
 * Scenario: a 401 signs the phone out with rides still in the upload queue.
 * The rides are held rather than demoted, so whoever signs in next meets a
 * queue that is not necessarily theirs.
 *
 * Expected behaviour: signing in holds every ride the signing-in athlete did
 * not record, an unstamped one included, and leaves their own alone. Nothing
 * is deleted either way.
 */

import { holdRecordingsOfOtherAthletes } from '@/features/recording/lib/storage/recordingLibrary';

const mockHoldOtherAthletes = jest.fn(() => 2);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    holdRecordingsOfOtherAthletes: mockHoldOtherAthletes,
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
  it('asks the engine for the athlete who is signing in', async () => {
    await holdRecordingsOfOtherAthletes('i296629');
    expect(mockHoldOtherAthletes).toHaveBeenCalledWith('i296629');
  });

  it('asks once per sign-in, whatever the engine answers', async () => {
    mockHoldOtherAthletes.mockReturnValue(0);
    await holdRecordingsOfOtherAthletes('i296629');
    expect(mockHoldOtherAthletes).toHaveBeenCalledTimes(1);
  });
});
