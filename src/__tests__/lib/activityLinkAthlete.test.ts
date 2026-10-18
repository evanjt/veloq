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
 * to the retired summary route opens the same check against the activity, and
 * one to the retired health tab opens fitness with its query.
 * A link to a route the app publishes as an entry passes through untouched;
 * a link to a sheet, the recording review, the login screen or anything else
 * opens nothing, and the developer screens open only for a developer.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { isForSignedInAthlete, openableSystemPath } from '@/features/insights/lib/pushPayload';
import { redirectSystemPath } from '@/app/+native-intent';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useDebugStore } from '@/features/settings';
import { fitnessEntryFromParams, fitnessPlaceOf } from '@/shared/app/fitnessEntry';

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

  it.each([
    ['veloq://training', '/fitness?tab=calendar'],
    ['veloq:///training/', '/fitness?tab=calendar'],
    ['veloq://training?chart=week', '/fitness?chart=week&tab=calendar'],
    ['veloq://training?chart=hrv#top', '/fitness?chart=hrv&tab=calendar'],
    ['/training?chart=weight', '/fitness?chart=weight&tab=calendar'],
    ['exp://192.0.2.1:8081/--/training?chart=rhr', '/fitness?chart=rhr&tab=calendar'],
  ])('sends %s from the retired health tab to fitness, query and all', (link, opened) => {
    expect(openableSystemPath(link, ATHLETE)).toBe(opened);
    expect(openableSystemPath(link, null)).toBe(opened);
  });

  it('lands a bare retired health link on the calendar place', () => {
    const opened = openableSystemPath('veloq://training', ATHLETE) ?? '';
    const entry = fitnessEntryFromParams(
      Object.fromEntries(new URLSearchParams(opened.split('?')[1] ?? ''))
    );

    expect(opened.split('?')[0]).toBe('/fitness');
    expect(fitnessPlaceOf(entry)).toBe('calendar');
  });

  it('lands a retired health link to a wellness chart on the place that draws it', () => {
    const opened = openableSystemPath('veloq://training?chart=hrv', ATHLETE) ?? '';
    const entry = fitnessEntryFromParams(
      Object.fromEntries(new URLSearchParams(opened.split('?')[1] ?? ''))
    );

    expect(entry.chart).toBe('hrv');
    expect(fitnessPlaceOf(entry)).toBe('fitness');
  });

  it('keeps a place the retired link already named', () => {
    expect(openableSystemPath('veloq://training?tab=trends', ATHLETE)).toBe('/fitness?tab=trends');
  });

  it('opens nothing below the retired health tab', () => {
    expect(openableSystemPath('veloq://training/extra', ATHLETE)).toBeNull();
  });

  /** Every link a widget, a notification, the app or a test flow opens from outside. */
  const PUBLISHED = [
    'veloq://',
    'veloq:///',
    'veloq://fitness',
    'veloq://insights',
    'veloq://insights?tab=strength&period=1m',
    'veloq://insights?tab=sections',
    'veloq://map',
    'veloq://map?activity=demo-test-0',
    'veloq://map?section=s_47075_-6084',
    'veloq://activity/demo-test-0',
    'veloq://activity/demo-test-0?tab=sections',
    'veloq://record',
    'veloq://recording/Ride?from=quickstart',
    'veloq://recordings',
    'veloq://recordings/r1',
    'veloq://route/r1',
    'veloq://routes',
    'veloq://section/s1',
    'veloq://section/history/s1',
    'veloq://section/laps/s1',
    'veloq://oauth/callback?code=c1&state=s1',
    'veloq://settings',
    'veloq:///settings',
    'veloq://about',
    'veloq://display-settings',
    'veloq://cache-settings',
    'veloq://summary-card-settings',
    'veloq://notification-settings',
    'veloq://backup-settings',
    '/section/s1',
    'exp://192.0.2.1:8081/--/activity/demo-test-0',
  ];

  it.each(PUBLISHED)('passes %s through untouched, signed in or not', (link) => {
    expect(openableSystemPath(link, ATHLETE)).toBe(link);
    expect(openableSystemPath(link, null)).toBe(link);
  });

  it.each([
    'veloq://sheets/param-editor',
    'veloq://sheets/smoothing?x=1',
    'veloq:///sheets/insight',
    '/sheets/stat-detail',
    'veloq://recording/review',
    'veloq://recording/review?from=quickstart',
    'veloq://login',
    'veloq://debug',
    'veloq://debug/expire-session',
    'veloq://detection-preview',
    'veloq://route-grouping-preview',
    'veloq://no-such-screen',
    'veloq://settings/extra',
    'veloq://activity',
    'veloq://activity/a1/extra',
    'exp://192.0.2.1:8081/--/sheets/param-editor',
  ])('opens nothing from %s', (link) => {
    expect(openableSystemPath(link, ATHLETE)).toBeNull();
    expect(openableSystemPath(link, null)).toBeNull();
  });

  it.each(['veloq://debug', 'veloq://detection-preview', 'veloq://route-grouping-preview'])(
    'opens the developer screen %s only for a developer',
    (link) => {
      expect(openableSystemPath(link, ATHLETE, false)).toBeNull();
      expect(openableSystemPath(link, ATHLETE, true)).toBe(link);
      expect(openableSystemPath(link, null, true)).toBe(link);
    }
  );

  it('refuses a sheet and the recording review to a developer too', () => {
    expect(openableSystemPath('veloq://sheets/param-editor', ATHLETE, true)).toBeNull();
    expect(openableSystemPath('veloq://recording/review', ATHLETE, true)).toBeNull();
  });
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

  it('leaves every other published deep link alone', async () => {
    signIn(null);
    await expect(
      redirectSystemPath({ path: 'veloq://activity/demo-test-0', initial: true })
    ).resolves.toBe('veloq://activity/demo-test-0');
  });

  it('opens nothing from a link to a sheet, cold or warm', async () => {
    signIn(ATHLETE);
    const link = 'veloq://sheets/param-editor';
    await expect(redirectSystemPath({ path: link, initial: true })).resolves.toBeNull();
    await expect(redirectSystemPath({ path: link, initial: false })).resolves.toBeNull();
  });

  it('opens the developer screen once the athlete unlocked it', async () => {
    signIn(ATHLETE);
    useDebugStore.setState({ unlocked: false });
    await expect(redirectSystemPath({ path: 'veloq://debug', initial: false })).resolves.toBeNull();
    useDebugStore.setState({ unlocked: true });
    await expect(redirectSystemPath({ path: 'veloq://debug', initial: false })).resolves.toBe(
      'veloq://debug'
    );
    useDebugStore.setState({ unlocked: false });
  });
});

describe('a backup file opened into the app', () => {
  it.each([
    'file:///docs/Inbox/backup.zip',
    'content://com.android.providers.downloads.documents/document/42',
  ])('opens no screen for %s, and copies it for the restore', async (link) => {
    // Signed out, nothing waits for the engine, so the restore starts at once.
    signIn(null);
    const copy = jest.spyOn(FileSystem, 'copyAsync').mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'cancel')?.onPress?.();
    });
    await expect(redirectSystemPath({ path: link, initial: false })).resolves.toBeNull();
    await waitFor(() => expect(copy).toHaveBeenCalledWith(expect.objectContaining({ from: link })));
  });
});
