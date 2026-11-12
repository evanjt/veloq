/**
 * Scenario: the login screen takes a Garmin Personal key as the only
 * credential. It has no engine, so Garmin is asked about the key on its own
 * and the library already on the device is judged against `garmin:<id>`.
 *
 * Expected behaviour: a key Garmin refuses, cannot reach, or accepts without
 * naming an account signs nobody in and touches nothing. An accepted key signs
 * in as `garmin:<id>` after the library on disk is kept, wiped or refused by
 * the same rule an intervals.icu sign-in follows.
 */

import { GarminKeyStatus } from 'veloqrs';

import { signInWithGarminKey, type GarminSignInSteps } from '@/features/auth/lib/garminSignIn';

function steps(overrides: Partial<GarminSignInSteps> = {}): GarminSignInSteps & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    check: jest.fn(async () => ({ status: GarminKeyStatus.Connected, accountId: '8841' })),
    resolveLibrary: jest.fn(async () => 'keep' as const),
    keepLibrary: jest.fn(async () => {
      calls.push('keep');
    }),
    wipeLibrary: jest.fn(async () => {
      calls.push('wipe');
    }),
    signIn: jest.fn(async () => {
      calls.push('signIn');
    }),
    ...overrides,
  };
}

describe('signInWithGarminKey', () => {
  it('signs the account in as garmin:<id>, keeping a library that is already its own', async () => {
    const s = steps();
    expect(await signInWithGarminKey('  pasted-key ', s)).toEqual({ kind: 'signedIn' });
    expect(s.check).toHaveBeenCalledWith('pasted-key');
    expect(s.resolveLibrary).toHaveBeenCalledWith('garmin:8841');
    expect(s.signIn).toHaveBeenCalledWith('pasted-key', '8841');
    expect(s.calls).toEqual(['keep', 'signIn']);
  });

  it('wipes another account’s library before it signs in', async () => {
    const s = steps({ resolveLibrary: jest.fn(async () => 'wipe' as const) });
    expect(await signInWithGarminKey('pasted-key', s)).toEqual({ kind: 'signedIn' });
    expect(s.calls).toEqual(['wipe', 'signIn']);
  });

  it('signs nobody in and touches nothing when the athlete backs out of the wipe', async () => {
    const s = steps({ resolveLibrary: jest.fn(async () => 'refused' as const) });
    expect(await signInWithGarminKey('pasted-key', s)).toEqual({ kind: 'refused' });
    expect(s.calls).toEqual([]);
  });

  it.each([
    GarminKeyStatus.Rejected,
    GarminKeyStatus.Malformed,
    GarminKeyStatus.Unreachable,
    GarminKeyStatus.NoActivityAccess,
  ])('reports Garmin’s answer %s and judges no library', async (status) => {
    const s = steps({ check: jest.fn(async () => ({ status, accountId: undefined })) });
    expect(await signInWithGarminKey('pasted-key', s)).toEqual({ kind: 'failed', status });
    expect(s.resolveLibrary).not.toHaveBeenCalled();
    expect(s.calls).toEqual([]);
  });

  it('refuses an accepted key that names no account, since the library would have no identity', async () => {
    const s = steps({
      check: jest.fn(async () => ({ status: GarminKeyStatus.Connected, accountId: undefined })),
    });
    expect(await signInWithGarminKey('pasted-key', s)).toEqual({ kind: 'noAccount' });
    expect(s.resolveLibrary).not.toHaveBeenCalled();
    expect(s.calls).toEqual([]);
  });

  it('asks Garmin nothing for a blank paste', async () => {
    const s = steps();
    expect(await signInWithGarminKey('   ', s)).toEqual({
      kind: 'failed',
      status: GarminKeyStatus.Malformed,
    });
    expect(s.check).not.toHaveBeenCalled();
  });

  it('reports Garmin as unreachable when the check itself throws', async () => {
    const s = steps({
      check: jest.fn(async () => {
        throw new Error('native');
      }),
    });
    expect(await signInWithGarminKey('pasted-key', s)).toEqual({
      kind: 'failed',
      status: GarminKeyStatus.Unreachable,
    });
    expect(s.calls).toEqual([]);
  });
});
