/**
 * Scenario: an uploaded recording's streams sidecar has been discarded,
 * because the engine holds the ride's track from the moment it was saved.
 *
 * Expected behaviour: the detail view still draws the track, read from the
 * engine, and a recording whose engine write never landed still draws from
 * the sidecar it kept.
 */

import { readRecordingTrack } from '@/features/recording/lib/storage/recordingTrack';
import { readRecordingStreams } from '@/features/recording/lib/storage/recordingLibrary';
import { engine } from 'veloqrs';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: { ready: true, getGpsTrack: jest.fn(() => []) },
  })
);

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  readRecordingStreams: jest.fn(async () => null),
}));

const mockGetTrack = engine.getGpsTrack as unknown as jest.Mock;
const mockReadStreams = readRecordingStreams as jest.Mock;

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
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
  mockGetTrack.mockReturnValue([]);
  mockReadStreams.mockResolvedValue(null);
});

describe('readRecordingTrack', () => {
  it('reads the track the engine holds', async () => {
    mockGetTrack.mockReturnValue([
      { latitude: -33.86, longitude: 151.2 },
      { latitude: -33.87, longitude: 151.21 },
    ]);

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([
      [-33.86, 151.2],
      [-33.87, 151.21],
    ]);
    expect(mockGetTrack).toHaveBeenCalledWith('local-deadbeef');
    expect(mockReadStreams).not.toHaveBeenCalled();
  });

  it('falls back to the sidecar when the engine holds no row', async () => {
    mockReadStreams.mockResolvedValue({ latlng: [[-33.86, 151.2]] });

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([[-33.86, 151.2]]);
  });

  it('reads the sidecar for a recording that never got an engine key', async () => {
    mockReadStreams.mockResolvedValue({ latlng: [[-33.86, 151.2]] });

    await expect(readRecordingTrack({ ...ENTRY, engineActivityId: undefined })).resolves.toEqual([
      [-33.86, 151.2],
    ]);
    expect(mockGetTrack).not.toHaveBeenCalled();
  });

  it('does not ask a closed engine', async () => {
    (engine as unknown as { ready: boolean }).ready = false;
    mockReadStreams.mockResolvedValue({ latlng: [[-33.86, 151.2]] });

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([[-33.86, 151.2]]);
    expect(mockGetTrack).not.toHaveBeenCalled();
  });

  it('answers empty for an indoor ride that has neither', async () => {
    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([]);
  });

  it('answers empty rather than throwing when the engine read fails', async () => {
    mockGetTrack.mockImplementation(() => {
      throw new Error('engine closed');
    });

    await expect(readRecordingTrack(ENTRY)).resolves.toEqual([]);
  });
});
