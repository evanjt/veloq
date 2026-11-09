/**
 * Scenario: another app or a web page opens a veloq://recording link.
 * Expected behaviour: every system arrival at the recording screen is armed
 * with the cancellable countdown, whatever `from` the link forged. Other
 * paths pass untouched.
 */

import * as SecureStore from 'expo-secure-store';

import { openableSystemPath } from '@/features/insights/lib/pushPayload';
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
    ['veloq:///recording/Ride', 'veloq:///recording/Ride?from=quickstart'],
    ['veloq://recording/Ride/', 'veloq://recording/Ride?from=quickstart'],
    ['veloq://recording/Ride/?x=1', 'veloq://recording/Ride?x=1&from=quickstart'],
    ['//recording/Ride', '//recording/Ride?from=quickstart'],
    ['veloq:////recording/Ride', 'veloq:////recording/Ride?from=quickstart'],
    [
      'exp://192.0.2.1:8081/--/recording/Ride',
      'exp://192.0.2.1:8081/--/recording/Ride?from=quickstart',
    ],
  ])('arms %s', (input, expected) => {
    expect(armSystemRecordingPath(input)).toBe(expected);
  });

  it.each([
    'veloq://activity/i1',
    '/map',
    'veloq://recordings/Ride',
    'veloq://recording',
    'veloq:///recording',
    'veloq://recording/Ride/extra',
    'veloq://recording/review?from=x',
    '/settings?from=x',
  ])('leaves %s alone', (path) => {
    expect(armSystemRecordingPath(path)).toBe(path);
  });

  /**
   * Every recording link the router opens is armed. The two checks read one
   * normalisation, so a shape the router accepts cannot start a ride unarmed.
   */
  it.each([
    'veloq://recording/Ride',
    'veloq:///recording/Ride',
    'veloq://recording/Ride/',
    'veloq:///recording/Ride/',
    '//recording/Ride',
    'recording/Ride',
    '/recording/Ride/?from=entry',
    'exp://192.0.2.1:8081/--/recording/Ride',
  ])('arms every recording link the router opens: %s', (link) => {
    expect(openableSystemPath(link, 'i1')).not.toBeNull();
    expect(armSystemRecordingPath(link)).toMatch(/[?&]from=quickstart$/);
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

  it.each([
    ['veloq:///recording/Ride', 'veloq:///recording/Ride?from=quickstart'],
    ['veloq://recording/Ride/', 'veloq://recording/Ride?from=quickstart'],
  ])('arms the system link %s before the recorder mounts', async (path, expected) => {
    await expect(redirectSystemPath({ path, initial: false })).resolves.toBe(expected);
  });

  it('passes other paths through', async () => {
    await expect(redirectSystemPath({ path: '/map', initial: true })).resolves.toBe('/map');
  });
});
