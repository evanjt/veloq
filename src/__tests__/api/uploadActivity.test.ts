/**
 * Scenario: a FIT buffer is handed to the upload endpoint.
 *
 * Expected behaviour: the bytes are staged to a temp file, the multipart body
 * names the file part and the device, and the temp file is removed whether the
 * POST succeeds or fails. A leaked temp file is a slow disk leak, and a missing
 * part silently loses the activity, so both are asserted explicitly.
 */

jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn() },
  getAthleteId: jest.fn(() => 'i12345'),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: jest.fn(() => ({ isDemoMode: false, athleteId: 'i12345' })) },
  DEMO_ATHLETE_ID: 'demo',
}));

jest.mock(
  'expo-file-system/legacy',
  () => ({
    cacheDirectory: 'file:///cache/',
    EncodingType: { Base64: 'base64' },
    writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
    deleteAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true }
);

import { intervalsApi } from '@/api/intervals';
import { apiClient } from '@/api/client';

const FileSystem = require('expo-file-system/legacy');

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function fitBuffer(): ArrayBuffer {
  const bytes = Uint8Array.from([0x0e, 0x20, 0x00, 0x00, 0x2e, 0x46, 0x49, 0x54]);
  return bytes.buffer;
}

/**
 * React Native's FormData accepts the `{ uri, type, name }` file descriptor
 * the upload path builds. Node's built-in coerces it to a string, so stand in
 * a recorder with the same contract to keep the parts inspectable.
 */
class RecordingFormData {
  readonly parts: Array<[string, unknown]> = [];

  append(name: string, value: unknown) {
    this.parts.push([name, value]);
  }
}

const originalFormData = globalThis.FormData;

beforeAll(() => {
  (globalThis as { FormData: unknown }).FormData = RecordingFormData;
});

afterAll(() => {
  (globalThis as { FormData: unknown }).FormData = originalFormData;
});

function partsOf(form: unknown): Array<[string, unknown]> {
  return (form as RecordingFormData).parts;
}

beforeEach(() => {
  mockPost.mockReset();
  FileSystem.writeAsStringAsync.mockClear();
  FileSystem.deleteAsync.mockClear();
  mockPost.mockResolvedValue({ data: { id: 'i999', name: 'Morning Ride' } });
});

describe('intervalsApi.uploadActivity', () => {
  it('posts to the athlete activities endpoint as multipart', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit');

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, , config] = mockPost.mock.calls[0];
    expect(url).toBe('/athlete/i12345/activities');
    expect(config?.headers?.['Content-Type']).toBe('multipart/form-data');
  });

  it('stages the bytes to a temp file under the cache directory', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit');

    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
    const [path, contents, options] = FileSystem.writeAsStringAsync.mock.calls[0];
    expect(path).toMatch(/^file:\/\/\/cache\/\d+_Morning Ride\.fit$/);
    expect(contents).toBe(btoa('\x0e\x20\x00\x00.FIT'));
    expect(options).toEqual({ encoding: 'base64' });
  });

  it('assembles the file part from the staged temp file', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit');

    const [stagedPath] = FileSystem.writeAsStringAsync.mock.calls[0];
    const parts = partsOf(mockPost.mock.calls[0][1]);
    const filePart = parts.find(([name]) => name === 'file')?.[1] as Record<string, string>;

    expect(filePart).toEqual({
      uri: stagedPath,
      type: 'application/octet-stream',
      name: 'Morning Ride.fit',
    });
  });

  it('always tags the upload with the device name', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit');

    const parts = partsOf(mockPost.mock.calls[0][1]);
    expect(parts).toContainEqual(['device_name', 'Veloq']);
  });

  it('includes the activity name and paired event when supplied', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit', {
      name: 'Bern loop',
      pairedEventId: 4321,
    });

    const parts = partsOf(mockPost.mock.calls[0][1]);
    expect(parts).toContainEqual(['name', 'Bern loop']);
    expect(parts).toContainEqual(['paired_event_id', '4321']);
  });

  it('omits the optional parts when they are not supplied', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit');

    const names = partsOf(mockPost.mock.calls[0][1]).map(([name]) => name);
    expect(names).not.toContain('name');
    expect(names).not.toContain('paired_event_id');
  });

  it('cleans up the temp file after a successful upload', async () => {
    await intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit');

    const [stagedPath] = FileSystem.writeAsStringAsync.mock.calls[0];
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(stagedPath, { idempotent: true });
  });

  it('cleans up the temp file after a failed upload', async () => {
    mockPost.mockRejectedValue(new Error('Network Error'));

    await expect(intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit')).rejects.toThrow(
      'Network Error'
    );

    const [stagedPath] = FileSystem.writeAsStringAsync.mock.calls[0];
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(stagedPath, { idempotent: true });
  });

  it('does not fail the upload when cleanup itself fails', async () => {
    FileSystem.deleteAsync.mockRejectedValueOnce(new Error('EBUSY'));

    await expect(
      intervalsApi.uploadActivity(fitBuffer(), 'Morning Ride.fit')
    ).resolves.toMatchObject({ id: 'i999' });
  });
});
