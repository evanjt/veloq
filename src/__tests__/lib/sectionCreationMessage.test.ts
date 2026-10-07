/**
 * Scenario: drawing a section fails, and the overlay tells the athlete why.
 * A missing track means waiting for the sync, a range too short means drawing
 * again, and anything else is a failure to retry.
 *
 * Expected behaviour: each tagged reason maps to its own message, and an
 * untagged or foreign error reads as the general failure.
 */
import { sectionCreationMessageKey } from '@/features/maps/lib/sectionCreationMessage';

function tagged(reason: string): Error {
  return Object.assign(new Error('engine text the athlete never reads'), { reason });
}

describe('sectionCreationMessageKey', () => {
  it('tells the athlete the track has not synced yet', () => {
    expect(sectionCreationMessageKey(tagged('noTrack'))).toBe('routes.gpsTrackNotSynced');
  });

  it('tells the athlete the range is too short', () => {
    expect(sectionCreationMessageKey(tagged('tooFewPoints'))).toBe('routes.invalidSectionRange');
  });

  it('reads an unknown reason as the general failure', () => {
    expect(sectionCreationMessageKey(tagged('somethingElse'))).toBe('routes.sectionCreationFailed');
  });

  it('reads an untagged error as the general failure', () => {
    expect(sectionCreationMessageKey(new Error('No GPS track found'))).toBe(
      'routes.sectionCreationFailed'
    );
  });

  it('reads a thrown value that is not an error as the general failure', () => {
    expect(sectionCreationMessageKey({ reason: 'noTrack' })).toBe('routes.sectionCreationFailed');
    expect(sectionCreationMessageKey(undefined)).toBe('routes.sectionCreationFailed');
  });
});
