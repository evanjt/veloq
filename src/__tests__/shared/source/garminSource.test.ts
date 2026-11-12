/**
 * Scenario: an athlete with no intervals.icu account signs in with a Garmin key
 * alone. The keychain holds that key, the library's identity `garmin:<id>` and
 * no intervals.icu credential.
 *
 * Expected behaviour: the device reads as signed in through the Garmin source,
 * with nothing it could push, scope, upload or link to on intervals.icu, and a
 * launch against the library already on disk keeps it. An intervals.icu
 * credential beside the key keeps the source intervals.icu.
 */

import { sourceFor } from '@/shared/app/source';
import {
  garminAthleteId,
  isGarminAthleteId,
  resolveStoredSession,
} from '@/shared/app/storedSession';
import { launchIdentityAction } from '@/features/auth/lib/launchIdentity';
import { accountChangeAction } from '@/features/auth/lib/accountChange';

const none = { apiKey: null, accessToken: null, athleteId: null, garminKey: null };

describe('the Garmin source', () => {
  it('can neither push, scope, upload nor link anywhere', () => {
    const source = sourceFor({ authMethod: 'garmin' })!;
    expect(source.id).toBe('garmin');
    expect(source.scheme).toBe('garmin');
    expect(source.can).toEqual({ push: false, scoped: false, uploads: false });
    expect(source.links).toBeNull();
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('yields to demo, as every other source does', () => {
    expect(sourceFor({ authMethod: 'garmin', isDemoMode: true })?.id).toBe('demo');
    expect(sourceFor({ authMethod: 'garmin', athleteId: 'demo' })?.id).toBe('demo');
  });
});

describe('garminAthleteId', () => {
  it('names the library after the account Garmin keeps, and recognises its own', () => {
    expect(garminAthleteId('8841')).toBe('garmin:8841');
    expect(isGarminAthleteId('garmin:8841')).toBe(true);
    expect(isGarminAthleteId('garmin:')).toBe(false);
    expect(isGarminAthleteId('garmin: ')).toBe(false);
    expect(isGarminAthleteId('i8841')).toBe(false);
    expect(isGarminAthleteId(null)).toBe(false);
  });
});

describe('resolveStoredSession', () => {
  it('signs a Garmin key and its library identity in with no intervals.icu credential', () => {
    const session = resolveStoredSession({
      ...none,
      athleteId: 'garmin:8841',
      garminKey: 'pasted-key',
    });
    expect(session).toEqual({ authMethod: 'garmin', isAuthenticated: true });
    expect(sourceFor({ authMethod: session.authMethod })?.id).toBe('garmin');
  });

  it('keeps an OAuth token the intervals.icu source with a Garmin key beside it', () => {
    expect(
      resolveStoredSession({
        ...none,
        accessToken: 'token',
        athleteId: 'i77',
        garminKey: 'pasted-key',
      })
    ).toEqual({ authMethod: 'oauth', isAuthenticated: true });
  });

  it('keeps an API key the intervals.icu source with a Garmin key beside it', () => {
    expect(
      resolveStoredSession({
        ...none,
        apiKey: 'key',
        athleteId: 'i77',
        garminKey: 'pasted-key',
      })
    ).toEqual({ authMethod: 'apiKey', isAuthenticated: true });
  });

  it('does not sign anyone in on a key alone, which is what a sign-out from intervals.icu leaves', () => {
    expect(resolveStoredSession({ ...none, garminKey: 'pasted-key' })).toEqual({
      authMethod: null,
      isAuthenticated: false,
    });
  });

  it('does not take an intervals.icu athlete id for a Garmin identity', () => {
    expect(resolveStoredSession({ ...none, athleteId: 'i77', garminKey: 'pasted-key' })).toEqual({
      authMethod: null,
      isAuthenticated: false,
    });
  });

  it('does not sign a Garmin identity in once its key is gone', () => {
    expect(resolveStoredSession({ ...none, athleteId: 'garmin:8841', garminKey: '  ' })).toEqual({
      authMethod: null,
      isAuthenticated: false,
    });
    expect(resolveStoredSession({ ...none, athleteId: 'garmin:8841' })).toEqual({
      authMethod: null,
      isAuthenticated: false,
    });
  });

  it('signs nobody in on nothing', () => {
    expect(resolveStoredSession(none)).toEqual({ authMethod: null, isAuthenticated: false });
  });
});

describe('a Garmin library at launch', () => {
  it('is kept when the identity on disk is the Garmin identity signing in', () => {
    expect(launchIdentityAction('garmin:8841', 'garmin:8841', 400)).toBe('proceed');
  });

  it('is asked about, never wiped unasked, when another account signs in over it', () => {
    expect(launchIdentityAction('garmin:8841', 'garmin:9000', 400)).toBe('ask-first');
    expect(launchIdentityAction('i77', 'garmin:8841', 400)).toBe('ask-first');
  });

  it('is adopted, not asked about, when an intervals.icu athlete signs in over it', () => {
    expect(launchIdentityAction('garmin:8841', 'i77', 400)).toBe('adopt');
    expect(launchIdentityAction('garmin:8841', 'i77', 0)).toBe('adopt');
  });

  it('is kept by a sign-in as the same Garmin account and confirmed for another', () => {
    expect(accountChangeAction('garmin:8841', 'garmin:8841', 400)).toBe('keep');
    expect(accountChangeAction('garmin:8841', 'garmin:9000', 400)).toBe('confirm-then-wipe');
  });

  it('is adopted, never wiped, by an intervals.icu sign-in', () => {
    expect(accountChangeAction('garmin:8841', 'i77', 400)).toBe('adopt');
    expect(accountChangeAction('garmin:8841', 'i77', 0)).toBe('adopt');
  });

  it('is still confirmed before an intervals.icu library gives way to a Garmin key', () => {
    expect(accountChangeAction('i77', 'garmin:8841', 400)).toBe('confirm-then-wipe');
  });
});
