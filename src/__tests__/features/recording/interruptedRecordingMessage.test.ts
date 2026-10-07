/**
 * Scenario: the phone died two hours into a ride and the app reopens on the
 * resume prompt, whose Discard deletes the ride.
 *
 * Expected behaviour: the prompt names the ride it would delete, by when it
 * started and how much moving time it holds, before the athlete chooses.
 */

import { initializeI18n } from '@/i18n';
import {
  backupMovingMs,
  interruptedRecordingMessage,
} from '@/features/recording/lib/interruptedRecording';
import { formatDateTime } from '@/shared/format/format';
import type { RecordingBackup } from '@/features/recording/types';

const START = Date.UTC(2026, 8, 30, 6, 15, 0);
const MINUTE = 60_000;

function backup(overrides: Partial<RecordingBackup> = {}): RecordingBackup {
  return {
    activityType: 'Ride',
    mode: 'gps',
    status: 'recording',
    startTime: START,
    stopTime: null,
    pausedDuration: 0,
    pauseIntervals: [],
    streams: {
      time: [],
      latlng: [],
      altitude: [],
      heartrate: [],
      power: [],
      cadence: [],
      speed: [],
      distance: [],
    },
    laps: [],
    pairedEventId: null,
    savedAt: START + 118 * MINUTE + 4_000,
    ...overrides,
  };
}

beforeAll(async () => {
  await initializeI18n('en-GB');
});

describe('the moving time a backup holds', () => {
  it('runs from the start to the last save for a live ride', () => {
    expect(backupMovingMs(backup())).toBe(118 * MINUTE + 4_000);
  });

  it('leaves out the time spent paused', () => {
    expect(backupMovingMs(backup({ status: 'paused', pausedDuration: 10 * MINUTE }))).toBe(
      108 * MINUTE + 4_000
    );
  });

  it('ends a stopped ride at its stop, not at the last save', () => {
    const stopped = backup({ status: 'stopped', stopTime: START + 90 * MINUTE });
    expect(backupMovingMs(stopped)).toBe(90 * MINUTE);
  });

  it('is zero when the ride was saved at its first instant', () => {
    expect(backupMovingMs(backup({ savedAt: START }))).toBe(0);
  });
});

describe('the resume prompt', () => {
  it('names when the interrupted ride started', () => {
    const startTime = formatDateTime(new Date(START).toISOString());
    expect(interruptedRecordingMessage(backup())).toContain(startTime);
  });

  it('names how much moving time Discard would delete', () => {
    expect(interruptedRecordingMessage(backup())).toContain('1:58:04');
  });

  it('says Discard deletes the ride for good', () => {
    expect(interruptedRecordingMessage(backup())).toMatch(/permanently/);
  });
});
