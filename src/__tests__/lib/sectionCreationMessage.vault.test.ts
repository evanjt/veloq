/**
 * Scenario: drawing a section fails, and the overlay tells the athlete why.
 * A missing track means waiting for the sync, and anything else is a failure
 * to retry.
 *
 * Expected behaviour: a tagged missing track maps to its own message, and an
 * untagged or foreign error reads as the general failure.
 */
import { sectionCreationMessageKey } from '@/features/maps/lib/sectionCreationMessage';

function tagged(reason: string): Error {
  return Object.assign(new Error('engine text the athlete never reads'), { reason });
}

describe('sectionCreationMessageKey', () => {
  it('tells the athlete the track has not synced yet', () => {
    expect(sectionCreationMessageKey(tagged('noTrack'))).toBe('routes.gpsTrackNotDownloaded');
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
