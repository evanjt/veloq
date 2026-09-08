/**
 * Scenario: the recording screen's request for the location foreground service
 * is refused, on a device carrying leftovers from a previous ride.
 *
 * Expected behaviour: the check is Android's own list of this app's running
 * services, which a leftover cannot get into. Two cheaper answers were measured
 * on a device and both said the service was running when it was not: the task
 * registry, because an abnormally ended ride leaves the task registered across a
 * process restart, and the service's notification, because `manager.notify`
 * takes ownership of the id so the re-post outlives the service and the process
 * both. The registry stays only as the fallback for where the module is absent,
 * which is iOS, where nothing refuses the service in the first place.
 */

import * as Location from 'expo-location';

import { backgroundLocationRunning } from '@/features/recording/lib/backgroundLocation';

jest.mock('expo-location', () => ({
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const mockLocationServiceRunning = jest.fn();

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  locationServiceRunning: (...a: unknown[]) => mockLocationServiceRunning(...a),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
}));

const registrySays = Location.hasStartedLocationUpdatesAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  registrySays.mockResolvedValue(true);
});

describe('what counts as proof that the foreground service started', () => {
  it('does not take a stale registration for a running service', async () => {
    // The exact shape of the failure: task registered from a previous run and
    // this start refused, so the registry says yes and the service list says no.
    registrySays.mockResolvedValue(true);
    mockLocationServiceRunning.mockResolvedValue(false);
    await expect(backgroundLocationRunning()).resolves.toBe(false);
  });

  it('accepts a service Android lists as running', async () => {
    mockLocationServiceRunning.mockResolvedValue(true);
    await expect(backgroundLocationRunning()).resolves.toBe(true);
  });

  it('does not let the registry overrule the service list either way', async () => {
    registrySays.mockResolvedValue(false);
    mockLocationServiceRunning.mockResolvedValue(true);
    await expect(backgroundLocationRunning()).resolves.toBe(true);
  });

  it('falls back to the registry where the module is absent, which is iOS', async () => {
    mockLocationServiceRunning.mockResolvedValue(null);
    registrySays.mockResolvedValue(true);
    await expect(backgroundLocationRunning()).resolves.toBe(true);

    registrySays.mockResolvedValue(false);
    await expect(backgroundLocationRunning()).resolves.toBe(false);
  });

  it('counts a throw as not running rather than as running', async () => {
    mockLocationServiceRunning.mockRejectedValue(new Error('no'));
    registrySays.mockRejectedValue(new Error('no'));
    await expect(backgroundLocationRunning()).resolves.toBe(false);
  });
});

describe('the native side reads the service list, not a leftover', () => {
  const fs = require('fs');
  const path = require('path');
  const KOTLIN = fs.readFileSync(
    path.join(
      __dirname,
      '../../../modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt'
    ),
    'utf8'
  );

  it("asks Android which of this app's services are running", () => {
    expect(KOTLIN).toContain('Function("serviceRunning")');
    expect(KOTLIN).toContain('getRunningServices(');
    expect(KOTLIN).toContain('it.foreground');
    expect(KOTLIN).toContain('expo.modules.location.services.LocationTaskService');
  });

  it('does not answer from the notification, which outlives the service', () => {
    const start = KOTLIN.indexOf('Function("serviceRunning")');
    const check = KOTLIN.slice(start, KOTLIN.indexOf('\n  }\n', start));
    expect(check).toContain('getRunningServices(');
    expect(check).not.toContain('activeNotifications');
  });
});
