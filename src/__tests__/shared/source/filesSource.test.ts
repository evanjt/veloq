/**
 * Scenario: an athlete fills the library from activity files alone, with no
 * connector and no account. The keychain holds no credential, only the choice
 * to keep a files library.
 *
 * Expected behaviour: the device reads as a session through the files source,
 * which can neither push, scope, upload, record nor link anywhere, and which
 * any credential supersedes. A later sign-in over the library keeps it whole.
 */

import { sourceFor } from '@/shared/app/source';
import { resolveStoredSession } from '@/shared/app/storedSession';
import { completeLaunchIdentity, launchIdentityAction } from '@/features/auth/lib/launchIdentity';

const none = { apiKey: null, accessToken: null, athleteId: null, garminKey: null };

describe('the files source', () => {
  it('can do nothing that needs a connector', () => {
    const source = sourceFor({ authMethod: 'files' })!;
    expect(source.id).toBe('files');
    expect(source.scheme).toBe('files');
    expect(source.can).toEqual({ push: false, scoped: false, uploads: false, records: false });
    expect(source.links).toBeNull();
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.can)).toBe(true);
  });

  it('yields to demo, as every other source does', () => {
    expect(sourceFor({ authMethod: 'files', isDemoMode: true })?.id).toBe('demo');
    expect(sourceFor({ authMethod: 'files', athleteId: 'demo' })?.id).toBe('demo');
  });

  it('leaves recording to the sources that have somewhere to send a ride', () => {
    expect(sourceFor({ authMethod: 'oauth' })!.can.records).toBe(true);
    expect(sourceFor({ authMethod: 'apiKey' })!.can.records).toBe(true);
    expect(sourceFor({ authMethod: 'garmin' })!.can.records).toBe(true);
    expect(sourceFor({ authMethod: 'demo' })!.can.records).toBe(true);
  });
});

describe('resolveStoredSession with a files library', () => {
  it('signs the choice in with no credential and no athlete id', () => {
    const session = resolveStoredSession({ ...none, filesSource: true });
    expect(session).toEqual({ authMethod: 'files', isAuthenticated: true });
    expect(sourceFor({ authMethod: session.authMethod })?.id).toBe('files');
  });

  it('reads no choice as nobody signed in', () => {
    expect(resolveStoredSession({ ...none, filesSource: false })).toEqual({
      authMethod: null,
      isAuthenticated: false,
    });
    expect(resolveStoredSession(none)).toEqual({ authMethod: null, isAuthenticated: false });
  });

  it('yields to any credential beside it', () => {
    expect(
      resolveStoredSession({ ...none, athleteId: 'i1', apiKey: 'key', filesSource: true })
    ).toEqual({ authMethod: 'apiKey', isAuthenticated: true });
    expect(
      resolveStoredSession({ ...none, athleteId: 'i1', accessToken: 'tok', filesSource: true })
    ).toEqual({ authMethod: 'oauth', isAuthenticated: true });
    expect(
      resolveStoredSession({
        ...none,
        athleteId: 'garmin:8841',
        garminKey: 'key',
        filesSource: true,
      })
    ).toEqual({ authMethod: 'garmin', isAuthenticated: true });
  });
});

describe('a later sign-in over a files library', () => {
  it('proceeds, because the library names no athlete', () => {
    expect(launchIdentityAction(undefined, 'i1', 5)).toBe('proceed');
    expect(launchIdentityAction(null, 'garmin:8841', 5)).toBe('proceed');
  });

  it('wipes nothing and asks nothing', async () => {
    const steps = {
      adopt: jest.fn(),
      wipe: jest.fn(async () => undefined),
      reopen: jest.fn(() => true),
      ask: jest.fn(async () => false),
      proceed: jest.fn(),
    };
    const settled = await completeLaunchIdentity(launchIdentityAction(undefined, 'i1', 5), steps);
    expect(settled).toBe(true);
    expect(steps.proceed).toHaveBeenCalledTimes(1);
    expect(steps.wipe).not.toHaveBeenCalled();
    expect(steps.ask).not.toHaveBeenCalled();
  });
});
