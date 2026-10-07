/**
 * Scenario: the feed reports to the engine when it opens, closes and when a
 * new card is tapped. The engine decides the rings from those reports.
 *
 * Expected behaviour: each report reaches the engine as the matching event, an
 * empty dismissal is not sent, and a failing engine never throws into the
 * caller.
 */
import { reportFeedClosed, reportFeedDismissed, reportFeedOpened } from '@/shared/native/feedSeen';

const mockRecord = jest.fn();
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ recordFeedSeen: (e: unknown) => mockRecord(e) }),
}));

beforeEach(() => mockRecord.mockReset());

describe('feed seen reports', () => {
  it('sends opened and closed', () => {
    reportFeedOpened();
    reportFeedClosed();
    expect(mockRecord.mock.calls.map((c) => c[0].tag)).toEqual(['Opened', 'Closed']);
  });

  it('sends the dismissed ids', () => {
    reportFeedDismissed(['a1', 'a2']);
    expect(mockRecord).toHaveBeenCalledWith({
      tag: 'Dismissed',
      inner: { activityIds: ['a1', 'a2'] },
    });
  });

  it('sends nothing for an empty dismissal', () => {
    reportFeedDismissed([]);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('swallows an engine failure', () => {
    mockRecord.mockImplementation(() => {
      throw new Error('locked');
    });
    expect(() => reportFeedOpened()).not.toThrow();
    expect(() => reportFeedDismissed(['a1'])).not.toThrow();
  });
});
