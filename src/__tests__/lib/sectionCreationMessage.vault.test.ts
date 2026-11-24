/**
 * Scenario: drawing a section fails, and the overlay tells the athlete why.
 * The engine refuses a cut from a ride whose track is not stored with its
 * `NotFound` variant, which is the one failure of that call that waiting for
 * the sync fixes. Every other failure is one to retry.
 *
 * Expected behaviour: a `NotFound` error maps to the not-downloaded message,
 * and any other engine variant, a foreign error or a bare value reads as the
 * general failure.
 */
import { sectionCreationMessageKey } from '@/features/maps/lib/sectionCreationMessage';

function engineError(tag: string): Error {
  return Object.assign(new Error('engine text the athlete never reads'), { tag });
}

describe('sectionCreationMessageKey', () => {
  it('tells the athlete the track has not synced yet', () => {
    expect(sectionCreationMessageKey(engineError('NotFound'))).toBe('routes.gpsTrackNotDownloaded');
  });

  it.each(['Database', 'ParseError', 'Busy', 'Suspended'])(
    'reads %s as the general failure',
    (tag) => {
      expect(sectionCreationMessageKey(engineError(tag))).toBe('routes.sectionCreationFailed');
    }
  );

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
