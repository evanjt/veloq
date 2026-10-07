/**
 * Scenario: the native Android poster opens an activity by deep link
 * rather than through the tap handler, so a tray entry of athlete A's that
 * survives a wipe (the dismissal is best-effort) would open A's activity in
 * athlete B's library.
 *
 * Expected behaviour: the link names its athlete, and the app opens it only
 * for the athlete signed in now, through the same check a tapped entry passes.
 * An activity link that names another athlete opens the app where it is. A link
 * naming no athlete is one the app or a widget made itself and passes. A link
 * to the retired summary route opens the same check against the activity.
 * Every other link passes through untouched.
 */

import * as SecureStore from 'expo-secure-store';

import { isForSignedInAthlete, openableSystemPath } from '@/features/insights/lib/pushPayload';
import { redirectSystemPath } from '@/app/+native-intent';
import { useAuthStore } from '@/shared/app/AuthStore';

const ATHLETE = 'i12345';

function signIn(athleteId: string | null) {
  useAuthStore.setState({ athleteId, isAuthenticated: athleteId !== null, isLoading: false });
}

describe('isForSignedInAthlete', () => {
  it('holds only when the entry names the athlete signed in now', () => {
    expect(isForSignedInAthlete(ATHLETE, ATHLETE)).toBe(true);
    expect(isForSignedInAthlete(ATHLETE, 'i777')).toBe(false);
    expect(isForSignedInAthlete(undefined, ATHLETE)).toBe(false);
  });

  it('refuses every entry while signed out, whatever form the absence takes', () => {
    expect(isForSignedInAthlete(ATHLETE, null)).toBe(false);
    expect(isForSignedInAthlete(undefined, null)).toBe(false);
    expect(isForSignedInAthlete(undefined, undefined)).toBe(false);
    expect(isForSignedInAthlete(undefined, '')).toBe(false);
  });
});

describe('openableSystemPath', () => {
  it('opens a activity link that names the athlete signed in', () => {
    const link = `veloq://activity/i999?athlete=${ATHLETE}`;
    expect(openableSystemPath(link, ATHLETE)).toBe(link);
  });

  it.each([
    ['another athlete', 'veloq://activity/i999?athlete=i777'],
    ['an empty athlete', 'veloq://activity/i999?athlete='],
    ['three slashes', 'veloq:///activity/i999?athlete=i777'],
    ['a path alone', '/activity/i999?athlete=i777'],
    ['another parameter first', 'veloq://activity/i999?from=tray&athlete=i777'],
  ])('opens nothing from a activity link naming %s', (_name, link) => {
    expect(openableSystemPath(link, ATHLETE)).toBeNull();
  });

  it('opens nothing from an activity link naming an athlete while signed out', () => {
    expect(openableSystemPath(`veloq://activity/i999?athlete=${ATHLETE}`, null)).toBeNull();
  });

  it('opens a link to an activity that names no athlete, signed in or not', () => {
    expect(openableSystemPath('veloq://activity/i999', ATHLETE)).toBe('veloq://activity/i999');
    expect(openableSystemPath('veloq://activity/i999', null)).toBe('veloq://activity/i999');
  });

  it('sends a link from the retired summary route to the activity, under the same check', () => {
    expect(openableSystemPath(`veloq://summary/i999?athlete=${ATHLETE}`, ATHLETE)).toBe(
      '/activity/i999'
    );
    expect(openableSystemPath('veloq://summary/i999?athlete=i777', ATHLETE)).toBeNull();
    expect(openableSystemPath('veloq://summary/i999', ATHLETE)).toBeNull();
  });

  it('reads an athlete id the poster encoded', () => {
    expect(openableSystemPath('veloq://activity/i999?athlete=i%31%32', 'i12')).toBe(
      'veloq://activity/i999?athlete=i%31%32'
    );
  });

  it.each(['veloq://summary-card-settings', 'veloq:///settings', 'veloq://map', '/section/s1'])(
    'passes %s through untouched, signed in or not',
    (link) => {
      expect(openableSystemPath(link, ATHLETE)).toBe(link);
      expect(openableSystemPath(link, null)).toBe(link);
    }
  );
});

describe('redirectSystemPath', () => {
  afterEach(() => {
    signIn(null);
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  });

  /** A cold start whose credential is still in the keychain, not yet in memory. */
  function credentialNotYetRead() {
    useAuthStore.setState({ athleteId: null, isAuthenticated: false, isLoading: true });
    const keychain: Record<string, string> = {
      intervals_athlete_id: ATHLETE,
      intervals_access_token: 'oauth-token',
    };
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation(async (key: string) => keychain[key] ?? null);
  }

  it("opens the athlete's own native entry from a cold start before the credential is read", async () => {
    credentialNotYetRead();
    const link = `veloq://activity/i999?athlete=${ATHLETE}`;
    await expect(redirectSystemPath({ path: link, initial: true })).resolves.toBe(link);
  });

  it("opens nothing from another athlete's native entry before the credential is read", async () => {
    credentialNotYetRead();
    const link = 'veloq://activity/i999?athlete=i777';
    await expect(redirectSystemPath({ path: link, initial: true })).resolves.toBeNull();
  });

  it('opens the native entry for the athlete it was posted for', async () => {
    signIn(ATHLETE);
    const link = `veloq://activity/i999?athlete=${ATHLETE}`;
    await expect(redirectSystemPath({ path: link, initial: true })).resolves.toBe(link);
    await expect(redirectSystemPath({ path: link, initial: false })).resolves.toBe(link);
  });

  it("opens nothing from the previous athlete's native entry, cold or warm", async () => {
    signIn('i777');
    const link = `veloq://activity/i999?athlete=${ATHLETE}`;
    await expect(redirectSystemPath({ path: link, initial: true })).resolves.toBeNull();
    await expect(redirectSystemPath({ path: link, initial: false })).resolves.toBeNull();
  });

  it('leaves every other deep link alone', async () => {
    signIn(null);
    await expect(
      redirectSystemPath({ path: 'veloq://activity/demo-test-0', initial: true })
    ).resolves.toBe('veloq://activity/demo-test-0');
  });
});
