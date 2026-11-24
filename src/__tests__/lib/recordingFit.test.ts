/**
 * Scenario: a ride is saved and the engine writes its FIT file.
 *
 * Expected behaviour: the engine gets the streams of the saved window, a missing fix
 * as NaN and a missing power reading as absent, the laps with their closing lap, the
 * start in milliseconds and the pause, and its bytes are what the save stores.
 */

import { recordings } from 'veloqrs';

import { writeRecordingFit } from '@/features/recording/lib/recordingFit';
import type { RecordingStreams } from '@/types';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    recordings: { writeRecordingFit: jest.fn() },
  })
);

const written = new ArrayBuffer(16);

function streams(overrides: Partial<RecordingStreams>): RecordingStreams {
  return {
    time: [],
    latlng: [],
    altitude: [],
    heartrate: [],
    power: [],
    cadence: [],
    speed: [],
    distance: [],
    ...overrides,
  };
}

describe('writeRecordingFit', () => {
  beforeEach(() => {
    jest.mocked(recordings.writeRecordingFit).mockReset().mockReturnValue(written);
  });

  it('hands the engine the saved streams, laps and clock, and returns its bytes', () => {
    const startTime = new Date('2026-01-15T10:00:00Z');
    const buffer = writeRecordingFit({
      activityType: 'Run',
      startTime,
      pausedTimeSeconds: 3,
      laps: [],
      streams: streams({
        time: [0, 2, 5],
        latlng: [[46.5, 6.6]],
        altitude: [420, NaN, 421],
        heartrate: [140, 0, 145],
        power: [210, null, 0],
        cadence: [80, 0, 82],
        speed: [6, 0, 7],
        distance: [0, 12, 26],
      }),
    });

    expect(buffer).toBe(written);
    const sent = jest.mocked(recordings.writeRecordingFit).mock.calls[0]?.[0];
    expect(sent?.activityType).toBe('Run');
    expect(sent?.startUnixMillis).toBe(startTime.getTime());
    expect(sent?.pausedSeconds).toBe(3);
    expect(sent?.streams.time).toEqual([0, 2, 5]);
    expect(sent?.streams.latitude).toEqual([46.5, NaN, NaN]);
    expect(sent?.streams.longitude).toEqual([6.6, NaN, NaN]);
    expect(sent?.streams.power).toEqual([210, undefined, 0]);
    expect(sent?.streams.distance).toEqual([0, 12, 26]);
  });

  it('closes the laps the athlete pressed before the engine writes them', () => {
    writeRecordingFit({
      activityType: 'Ride',
      startTime: new Date('2026-01-15T10:00:00Z'),
      pausedTimeSeconds: 10,
      streams: streams({ time: [0, 10, 20, 30], distance: [0, 100, 150, 200] }),
      laps: [
        {
          index: 0,
          startTime: 0,
          endTime: 10,
          startIndex: 0,
          endIndex: 1,
          movingEndTime: 10,
          distance: 100,
          avgSpeed: 10,
          avgHeartrate: 130,
          avgPower: null,
          avgCadence: null,
        },
      ],
    });

    const laps = jest.mocked(recordings.writeRecordingFit).mock.calls[0]?.[0].laps;
    expect(laps).toHaveLength(2);
    expect(laps?.[0]).toEqual({
      startTime: 0,
      endTime: 10,
      movingEndTime: 10,
      distance: 100,
      avgSpeed: 10,
      avgHeartrate: 130,
      avgPower: undefined,
      avgCadence: undefined,
    });
    expect(laps?.[1]).toMatchObject({
      startTime: 10,
      endTime: 30,
      movingEndTime: 20,
      distance: 100,
    });
  });
});
