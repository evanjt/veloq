import {
  DEFAULT_ENTRY_SPORTS,
  defaultEntrySport,
  entryGpsState,
  entrySportChips,
  recordingEntryHref,
} from '@/features/recording/lib/recordEntry';
import { planRecordingStart } from '@/features/recording/lib/armCountdown';

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
    expect(entrySportChips(['Run', 'Ride', 'Walk', 'Hike', 'Swim'], 'Run', 4)).toEqual([
      'Run',
      'Ride',
      'Walk',
      'Hike',
    ]);
  });

  it('offers the defaults before anything has been recorded', () => {
    expect(entrySportChips([], 'Ride')).toEqual([...DEFAULT_ENTRY_SPORTS]);
  });

  it('leads with a sport picked from More, and keeps the count', () => {
    expect(entrySportChips(['Run', 'Ride', 'Walk', 'Hike'], 'Rowing', 4)).toEqual([
      'Rowing',
      'Run',
      'Ride',
      'Walk',
    ]);
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
  it('is ready at 20 m or tighter', () => {
    expect(entryGpsState(5)).toBe('ready');
    expect(entryGpsState(20)).toBe('ready');
  });

  it('is weak past 20 m, and when the fix carries no accuracy', () => {
    expect(entryGpsState(20.1)).toBe('weak');
    expect(entryGpsState(null)).toBe('weak');
    expect(entryGpsState(undefined)).toBe('weak');
  });
});
