/**
 * Scenario: two of the three auto-backup triggers arrive close together. A
 * sync settles and the app is backgrounded a second later, or a foreground
 * follows a background. Both reach `performBackup`, and the last-backup
 * timestamp is not written until the upload has finished, so both pass the
 * throttle.
 *
 * Expected behaviour: the second one joins the first rather than starting a
 * second snapshot. Rust refuses a concurrent `startBackup` outright, throwing
 * "A backup is already running", and all three triggers swallow their errors,
 * so without a guard the collision is a wasted database copy nobody sees.
 */

import {
  performBackup,
  registerBackend,
  onSyncComplete,
  onAppBackground,
  type BackupBackend,
} from '@/features/settings/lib/autobackup';

const mockSettings = new Map<string, string>();
const mockStartBackup = jest.fn();
let mockSettled = false;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    // Rust holds one backup handle and refuses a second, the shape
    // `objects/engine.rs` gives `start_backup`.
    startBackup: (path: string) => {
      mockStartBackup(path);
      if (mockStartBackup.mock.calls.length > 1 && !mockSettled) {
        throw new Error('A backup is already running');
      }
    },
    pollBackup: () => 'complete',
    getBackupMetadata: () => ({ schema_version: '14', activity_count: '1', athlete_id: 'i1' }),
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

let releaseUpload: (() => void) | null = null;

const upload = jest.fn(
  () =>
    new Promise<void>((resolve) => {
      releaseUpload = () => {
        mockSettled = true;
        resolve();
      };
    })
);

const testBackend: BackupBackend = {
  id: 'test-inflight',
  name: 'Test In Flight',
  isAvailable: async () => true,
  listBackups: async () => [],
  upload: () => upload(),
  download: async () => {},
  delete: async () => {},
};

registerBackend(testBackend);

/** The snapshot polls on a 50 ms timer, so "during the backup" is a wait. */
async function untilUploading(nth = 1) {
  for (let i = 0; i < 300 && upload.mock.calls.length < nth; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (upload.mock.calls.length < nth) throw new Error(`upload ${nth} never started`);
}

beforeEach(() => {
  mockSettings.clear();
  mockSettings.set('__backup_backend', 'test-inflight');
  mockSettings.set('__auto_backup_enabled', '1');
  mockStartBackup.mockClear();
  upload.mockClear();
  mockSettled = false;
  releaseUpload = null;
});

describe('the auto-backup in-flight guard', () => {
  it('runs one snapshot when two triggers arrive during the same backup', async () => {
    const first = performBackup();
    await untilUploading();
    const second = performBackup();

    releaseUpload?.();
    const [a, b] = await Promise.all([first, second]);

    expect(mockStartBackup).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("hands the second caller the first one's answer, not a refusal", async () => {
    const first = performBackup();
    await untilUploading();
    const second = performBackup();

    releaseUpload?.();

    await expect(second).resolves.toBe(await first);
  });

  it('lets a later backup start once the first has finished', async () => {
    const first = performBackup();
    await untilUploading();
    releaseUpload?.();
    await first;

    mockSettings.delete('__last_auto_backup');
    const later = performBackup();
    await untilUploading(2);
    releaseUpload?.();
    await later;

    expect(mockStartBackup).toHaveBeenCalledTimes(2);
  });

  it('holds the two triggers that fire closest together to one run', async () => {
    onSyncComplete();
    await untilUploading();
    onAppBackground();

    releaseUpload?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockStartBackup).toHaveBeenCalledTimes(1);
  });

  it('releases the guard when the backup throws, so the next one is not stuck', async () => {
    upload.mockImplementationOnce(() => Promise.reject(new Error('upload refused')));

    await expect(performBackup()).rejects.toThrow('upload refused');

    mockSettled = true;
    const next = performBackup();
    await untilUploading(2);
    releaseUpload?.();
    await next;

    expect(mockStartBackup).toHaveBeenCalledTimes(2);
  });
});
