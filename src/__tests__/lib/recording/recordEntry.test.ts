import {
  DEFAULT_ENTRY_SPORTS,
  defaultEntrySport,
  entryGpsState,
  entrySportChips,
  recordingEntryHref,
  resolveEntryGps,
} from '@/features/recording/lib/recordEntry';
import { planRecordingStart } from '@/features/recording/lib/armCountdown';
import { locationGrant } from '@/shared/app/permissions/locationGrant';
import type { LocationPermissionResponse } from 'expo-location';

describe('the sport Start begins', () => {
  it('is the last one recorded', () => {
    expect(defaultEntrySport(['Run', 'Ride'])).toBe('Run');
  });

  it('is a ride before anything has been recorded', () => {
    expect(defaultEntrySport([])).toBe('Ride');
  });
});

describe('the chip row', () => {
  it('holds the recent sports, most recent first, up to the count', () => {
    expect(entrySportChips(['Run', 'Ride', 'Walk', 'Hike', 'Swim'], 'Run', [], 4)).toEqual([
      'Run',
      'Ride',
      'Walk',
      'Hike',
    ]);
  });

  it('offers the defaults before anything has been recorded', () => {
    expect(entrySportChips([], 'Ride')).toEqual([...DEFAULT_ENTRY_SPORTS]);
  });

  it('follows one recent sport with the library sports before the defaults', () => {
    expect(entrySportChips(['Swim'], 'Swim', ['Run', 'Swim', 'Rowing'])).toEqual([
      'Swim',
      'Run',
      'Rowing',
      'Ride',
    ]);
  });

  it('keeps the chosen sport and the count when the library fills the row', () => {
    expect(entrySportChips(['Run'], 'Yoga', ['Swim', 'Rowing', 'Ride'])).toEqual([
      'Yoga',
      'Run',
      'Swim',
      'Rowing',
    ]);
  });

  it('keeps the fixed defaults for a library with no activity', () => {
    expect(entrySportChips(['Run'], 'Run', [])).toEqual(['Run', 'Ride', 'Walk', 'Hike']);
  });

  it('leads with a sport picked from More, and keeps the count', () => {
    expect(entrySportChips(['Run', 'Ride', 'Walk', 'Hike'], 'Rowing', [], 4)).toEqual([
      'Rowing',
      'Run',
      'Ride',
      'Walk',
    ]);
  });

  it('fills the row to the count with the defaults after one recent sport', () => {
    expect(entrySportChips(['Walk'], 'Walk', [], 4)).toEqual(['Walk', 'Ride', 'Run', 'Hike']);
  });

  it('keeps a sport picked from More inside the count when the recents are short', () => {
    expect(entrySportChips(['Walk'], 'Rowing', [], 4)).toEqual(['Rowing', 'Walk', 'Ride', 'Run']);
  });

  it('lists no sport twice when the recents overlap the defaults', () => {
    const chips = entrySportChips(['Hike', 'Walk'], 'Ride', [], 4);
    expect(chips).toEqual(['Hike', 'Walk', 'Ride', 'Run']);
    expect(new Set(chips).size).toBe(chips.length);
  });
});

describe('the route a Start takes', () => {
  it('starts the recording on arrival', () => {
    const href = recordingEntryHref('Ride');
    expect(href).toBe('/recording/Ride?from=entry');
    const from = new URLSearchParams(href.split('?')[1]).get('from') ?? undefined;
    expect(planRecordingStart({ canRecord: true, status: 'idle', from })).toBe('start');
  });

  it('carries a followed workout', () => {
    expect(recordingEntryHref('Run', 77)).toBe('/recording/Run?from=entry&pairedEventId=77');
  });
});

describe('GPS readiness from a fix', () => {
  it('is ready at the discard threshold or tighter', () => {
    expect(entryGpsState(5, 20)).toBe('ready');
    expect(entryGpsState(20, 20)).toBe('ready');
  });

  it('is weak past the discard threshold, and when the fix carries no accuracy', () => {
    expect(entryGpsState(20.1, 20)).toBe('weak');
    expect(entryGpsState(null, 20)).toBe('weak');
    expect(entryGpsState(undefined, 20)).toBe('weak');
  });
});

describe('GPS state before a ride', () => {
  const granted = {
    servicesEnabled: true,
    permission: 'granted',
    fix: null,
    timedOut: false,
    precision: 'precise',
    rejectThreshold: 30,
  } as const;

  it('names the device switch at once when location is off', () => {
    expect(resolveEntryGps({ ...granted, servicesEnabled: false })).toBe('servicesOff');
  });

  it('names the switch rather than a denial, since the switch is what denies', () => {
    expect(resolveEntryGps({ ...granted, servicesEnabled: false, permission: 'denied' })).toBe(
      'servicesOff'
    );
  });

  it('names the switch over a stale fix and over a timed-out wait', () => {
    expect(resolveEntryGps({ ...granted, servicesEnabled: false, fix: { accuracy: 5 } })).toBe(
      'servicesOff'
    );
    expect(resolveEntryGps({ ...granted, servicesEnabled: false, timedOut: true })).toBe(
      'servicesOff'
    );
  });

  it('is checking while the switch has not been read yet', () => {
    expect(resolveEntryGps({ ...granted, servicesEnabled: null })).toBe('checking');
  });

  it('is denied when the switch is on and the permission is refused', () => {
    expect(resolveEntryGps({ ...granted, permission: 'denied' })).toBe('none');
  });

  it('reads a fix by its accuracy', () => {
    expect(resolveEntryGps({ ...granted, fix: { accuracy: 8 } })).toBe('ready');
    expect(resolveEntryGps({ ...granted, fix: { accuracy: 60 } })).toBe('weak');
  });

  it('is checking until the wait for a first fix runs out, then weak', () => {
    expect(resolveEntryGps(granted)).toBe('checking');
    expect(resolveEntryGps({ ...granted, timedOut: true })).toBe('weak');
  });

  it('names an approximate grant before the first fix rather than waiting it out', () => {
    expect(resolveEntryGps({ ...granted, precision: 'approximate' })).toBe('approximate');
  });

  it('names an approximate grant over a coarse fix', () => {
    expect(resolveEntryGps({ ...granted, precision: 'approximate', fix: { accuracy: 500 } })).toBe(
      'approximate'
    );
  });

  it('names the switch over an approximate grant', () => {
    expect(resolveEntryGps({ ...granted, servicesEnabled: false, precision: 'approximate' })).toBe(
      'servicesOff'
    );
  });
});

describe('GPS readiness under an approximate location grant', () => {
  const coarse = {
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
    android: { accuracy: 'coarse' },
  } as LocationPermissionResponse;

  it('reads a granted coarse response with a 500 m fix as approximate, not weak', () => {
    expect(entryGpsState(500, 30, locationGrant(coarse).precision)).toBe('approximate');
  });

  it('is approximate before the first fix, since no fix will be tight enough', () => {
    expect(entryGpsState(null, 30, 'approximate')).toBe('approximate');
  });

  it('keeps a precise grant on the fix alone', () => {
    expect(entryGpsState(500, 30, 'precise')).toBe('weak');
    expect(entryGpsState(8, 30, 'precise')).toBe('ready');
  });
});
