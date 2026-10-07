/**
 * Scenario: another app or a web page opens a veloq://recording link.
 * Expected behaviour: every system arrival at the recording screen is armed
 * with the cancellable countdown, whatever `from` the link forged. Other
 * paths pass untouched.
 */

import * as SecureStore from 'expo-secure-store';

import { armSystemRecordingPath } from '@/features/recording/lib/armCountdown';
import { redirectSystemPath } from '@/app/+native-intent';
import { useAuthStore } from '@/shared/app/AuthStore';

describe('armSystemRecordingPath', () => {
  it.each([
    ['veloq://recording/Ride', 'veloq://recording/Ride?from=quickstart'],
    ['/recording/Ride', '/recording/Ride?from=quickstart'],
    ['veloq://recording/Ride?from=entry', 'veloq://recording/Ride?from=quickstart'],
    ['veloq://recording/Ride?from=', 'veloq://recording/Ride?from=quickstart'],
    ['veloq://recording/Ride?from=a&from=b', 'veloq://recording/Ride?from=quickstart'],
    [
      'veloq://recording/Run?pairedEventId=42&from=x',
      'veloq://recording/Run?pairedEventId=42&from=quickstart',
    ],
    ['veloq://recording/Ride?from=quickstart', 'veloq://recording/Ride?from=quickstart'],
  ])('arms %s', (input, expected) => {
    expect(armSystemRecordingPath(input)).toBe(expected);
  });

  it.each([
    'veloq://activity/i1',
    '/map',
    'veloq://recordings/Ride',
    'veloq://recording',
    '/settings?from=x',
  ])('leaves %s alone', (path) => {
    expect(armSystemRecordingPath(path)).toBe(path);
  });
});

describe('redirectSystemPath', () => {
  beforeEach(() => {
    jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, isLoading: false });
  });

  it.each([true, false])('arms a recording link, initial=%s', async (initial) => {
    await expect(redirectSystemPath({ path: '/recording/Ride', initial })).resolves.toBe(
      '/recording/Ride?from=quickstart'
    );
  });

  it('passes other paths through', async () => {
    await expect(redirectSystemPath({ path: '/map', initial: true })).resolves.toBe('/map');
  });
});
