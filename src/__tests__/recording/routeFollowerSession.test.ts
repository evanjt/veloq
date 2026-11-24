/**
 * Scenario: a GPS ride follows a saved route and the recording screen is closed mid-ride, as
 * when the phone is pocketed or another tab is open. Fixes keep reaching the live store.
 *
 * Expected behaviour: the session owns the follower. It is built once per route choice, every
 * fix is placed on it with no screen mounted, and it is dropped when the choice changes or the
 * ride ends.
 */

import { FfiFollowStatus } from 'veloqrs';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import { sessionGuidanceCue } from '@/features/recording/lib/guidanceCue';

const mockFollow = jest.fn();
const mockAdvance = jest.fn();
const TURNS = [{ alongM: 300, angleDeg: 90, lat: 1, lng: 2 }];

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub'),
  routes: {
    followRoute: (...args: unknown[]) => mockFollow(...args),
    advanceRouteFollower: (...args: unknown[]) => mockAdvance(...args),
  },
}));

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
  locationServiceRunning: jest.fn(async () => true),
  startIndoorRecordingService: jest.fn(() => true),
  stopIndoorRecordingService: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  saveRecordingBackup: jest.fn(async () => true),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const live = () => useRecordingLiveStore.getState();
const fix = (latitude: number) => live().setFix({ latitude, longitude: 6.6 }, 5);
const record = (alongM: number, status = FfiFollowStatus.OnRoute) => ({
  alongM,
  remainingM: 1000 - alongM,
  status,
  crossTrackM: 80,
});

let followers: Record<string, { id: string; turns: () => unknown[] }>;
let uninstall: () => void;

beforeEach(() => {
  useRecordingStore.getState().reset();
  live().reset();
  sessionGuidanceCue.reset();
  mockFollow.mockReset();
  mockAdvance.mockReset();
  followers = {};
  mockFollow.mockImplementation((id: string) => (followers[id] = { id, turns: () => TURNS }));
  mockAdvance.mockImplementation((_f: unknown, lat: number) => record(Math.round(lat * 100)));
  uninstall = installRecordingSession();
});

afterEach(() => {
  uninstall();
  useRecordingStore.getState().reset();
});

function startFollowedRide(routeId = 'a'): void {
  live().setRouteChoice('Ride', routeId);
  useRecordingStore.getState().startRecording('Ride', 'gps');
}

describe('the route follower held by the ride session', () => {
  it('places every fix on one follower with no screen mounted', () => {
    startFollowedRide();
    fix(1);
    fix(2);
    expect(mockFollow).toHaveBeenCalledTimes(1);
    expect(mockAdvance.mock.calls.map((c) => c[1])).toEqual([1, 2]);
    expect(mockAdvance.mock.calls.every((c) => c[0] === followers.a)).toBe(true);
    expect(live().guidance).toEqual(record(200));
    expect(live().routeTurns).toEqual(TURNS);
  });

  it('clears the off-route cue when the ride rejoins the route off screen', () => {
    startFollowedRide();
    mockAdvance.mockReturnValueOnce(record(100, FfiFollowStatus.OffRoute));
    fix(1);
    expect(sessionGuidanceCue.line).not.toBeNull();
    mockAdvance.mockReturnValueOnce(record(150));
    fix(2);
    expect(sessionGuidanceCue.line).toBeNull();
  });

  it('switches follower on a new choice and drops the guidance at once', () => {
    startFollowedRide();
    fix(1);
    live().setRouteChoice('Ride', 'b');
    expect(live().guidance).toBeNull();
    fix(2);
    expect(mockFollow).toHaveBeenCalledTimes(2);
    expect(mockAdvance.mock.calls.map((c) => c[0])).toEqual([followers.a, followers.b]);
  });

  it('follows nothing for another sport, and stops when the choice is cleared', () => {
    live().setRouteChoice('Walk', 'a');
    useRecordingStore.getState().startRecording('Ride', 'gps');
    fix(1);
    expect(mockFollow).not.toHaveBeenCalled();

    live().setRouteChoice('Ride', 'a');
    fix(2);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
    live().clearRouteChoice();
    expect(live().guidance).toBeNull();
    expect(live().routeTurns).toEqual([]);
    fix(3);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
  });

  it('holds no guidance when the engine refuses the route', () => {
    mockFollow.mockImplementation(() => {
      throw new Error('track holds no line');
    });
    startFollowedRide();
    fix(1);
    expect(mockAdvance).not.toHaveBeenCalled();
    expect(live().guidance).toBeNull();
  });

  it('stops following when the ride ends', () => {
    startFollowedRide();
    fix(1);
    useRecordingStore.getState().reset();
    expect(live().guidance).toBeNull();
    fix(2);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
  });
});
