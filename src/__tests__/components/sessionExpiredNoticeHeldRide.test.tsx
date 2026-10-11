/**
 * Scenario: a forced sign-out holds a ride for the athlete who recorded it,
 * and the login screen says what was kept.
 *
 * Expected behaviour: the notice names the held ride and says it opens on the
 * next sign-in, and says nothing about a ride when none is held for the
 * outgoing athlete.
 */

import React from 'react';
import { render, renderHook, waitFor } from '@testing-library/react-native';

import { SessionExpiredNotice } from '@/features/auth/components/SessionExpiredNotice';
import { useSessionExpiryNotice } from '@/features/auth/hooks/useSessionExpiryNotice';
import { saveRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatClockOrDate } from '@/shared/format/format';
import type { RecordingBackup } from '@/features/recording/types';

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from)!);
    mockFiles.delete(from);
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFiles.set(path, data);
  }),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path)),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/features/auth/lib/accountChange', () => ({
  getCachedAthleteId: jest.fn(async () => 'i1'),
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides()
);
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  holdsRecordingStartingIn: jest.fn(() => false),
  holdRecordingsOfOtherAthletes: jest.fn(async () => undefined),
}));

const START = 1_700_000_000_000;

function backup(overrides: Partial<RecordingBackup> = {}): RecordingBackup {
  return {
    athleteId: 'i1',
    activityType: 'Ride',
    mode: 'gps',
    status: 'stopped',
    startTime: START,
    stopTime: START + 60_000,
    pausedDuration: 0,
    pauseIntervals: [],
    streams: {
      time: [0],
      latlng: [[45, 10]],
      altitude: [100],
      heartrate: [0],
      power: [0],
      cadence: [0],
      speed: [0],
      distance: [0],
    },
    laps: [],
    pairedEventId: null,
    savedAt: START + 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockFiles.clear();
  useAuthStore.setState({ athleteId: null, isAuthenticated: false, sessionExpired: null });
});

describe('the notice', () => {
  it('names the held ride and where it reappears', () => {
    const view = render(
      <SessionExpiredNotice
        notice={{ reason: 'signed_out', cachedAthleteId: 'i1', heldRideStart: START }}
      />
    );
    expect(
      view.getByText(`login.sessionHeldRide:${JSON.stringify({ when: formatClockOrDate(START) })}`)
    ).toBeTruthy();
  });

  it('mentions no ride when none is held', () => {
    const view = render(
      <SessionExpiredNotice
        notice={{ reason: 'signed_out', cachedAthleteId: 'i1', heldRideStart: null }}
      />
    );
    expect(view.queryByText(/login\.sessionHeldRide/)).toBeNull();
  });
});

describe('the notice source', () => {
  it('reads the outgoing athlete’s held ride', async () => {
    await saveRecordingBackup(backup());
    useAuthStore.setState({ sessionExpired: 'signed_out' });
    const { result } = renderHook(() => useSessionExpiryNotice());
    await waitFor(() => expect(result.current[0]).not.toBeNull());
    expect(result.current[0]).toEqual({
      reason: 'signed_out',
      cachedAthleteId: 'i1',
      heldRideStart: START,
    });
  });

  it('holds no ride for a backup of a live ride or of another athlete', async () => {
    await saveRecordingBackup(backup({ status: 'paused', stopTime: null }));
    await saveRecordingBackup(backup({ athleteId: 'i2' }));
    useAuthStore.setState({ sessionExpired: 'signed_out' });
    const { result } = renderHook(() => useSessionExpiryNotice());
    await waitFor(() => expect(result.current[0]).not.toBeNull());
    expect(result.current[0]?.heldRideStart).toBeNull();
  });
});
