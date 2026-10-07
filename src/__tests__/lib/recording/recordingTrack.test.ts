/**
 * Scenario: a recording's detail view draws its track. The engine holds the
 * track from the save, or from the launch that replayed a save whose engine
 * write failed, and no streams copy of it is kept on disk.
 *
 * Expected behaviour: the track is read from the engine only. A sidecar an
 * earlier build left beside the FIT is not read.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { readRecordingTrack } from '@/features/recording/lib/storage/recordingTrack';
import { engine } from 'veloqrs';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: { ready: true, getGpsTrack: jest.fn(() => ({ points: [] })) },
    // The track crosses coordinate-encoded. What stands in for the blob here is
    // an object carrying the points, which this reads back out.
    decodeCoords: (buf: ArrayBuffer) =>
      (buf as unknown as { points?: { latitude: number; longitude: number }[] }).points ?? [],
  })
);

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  readAsStringAsync: jest.fn(async () => JSON.stringify({ latlng: [[-33.86, 151.2]] })),
}));

const mockGetTrack = engine.getGpsTrack as unknown as jest.Mock;

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  kind: 'fit',
  fitPath: 'file:///recordings/rec-1.fit',
  streamsPath: 'file:///recordings/rec-1.streams.json',
  activityType: 'Ride',
  name: 'Morning Ride',
  startTime: Date.parse('2026-03-08T06:30:00Z'),
  durationSeconds: 3600,
  distanceMeters: 28_400,
  createdAt: Date.parse('2026-03-08T07:30:00Z'),
  uploadStatus: 'uploaded',
  retryCount: 0,
  engineActivityId: 'local-deadbeef',
};

beforeEach(() => {
  jest.clearAllMocks();
  (engine as unknown as { ready: boolean }).ready = true;
  mockGetTrack.mockReturnValue({ points: [] });
});

describe('readRecordingTrack', () => {
  it('reads the track the engine holds', async () => {
    mockGetTrack.mockReturnValue({
      points: [
        { latitude: -33.86, longitude: 151.2 },
        { latitude: -33.87, longitude: 151.21 },
      ],
    });

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([
      [-33.86, 151.2],
      [-33.87, 151.21],
    ]);
    expect(mockGetTrack).toHaveBeenCalledWith('local-deadbeef');
  });

  it('does not read a sidecar an earlier build left, when the engine holds no track', async () => {
    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([]);
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('answers empty for a recording that has no engine row yet', async () => {
    const unkeyed = { ...ENTRY };
    delete unkeyed.engineActivityId;
    await expect(readRecordingTrack(unkeyed)).resolves.toEqual([]);
    expect(mockGetTrack).not.toHaveBeenCalled();
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('does not ask a closed engine', async () => {
    (engine as unknown as { ready: boolean }).ready = false;

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([]);
    expect(mockGetTrack).not.toHaveBeenCalled();
  });

  it('answers empty rather than throwing when the engine read fails', async () => {
    mockGetTrack.mockImplementation(() => {
      throw new Error('engine closed');
    });

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([]);
  });
});
