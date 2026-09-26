/**
 * Scenario: an iOS Notification Service Extension is a separate process and
 * cannot open anything under the app's Documents, so `routes.db` has to live
 * in the App Group container. Every released build put it in Documents.
 *
 * Expected behaviour: the database moves once, on upgrade, and the old copy
 * stays authoritative until a verified copy exists at the new location.
 */
import { ROUTE_DB_FILES, routeDbDirectory, migrateRouteDb } from '@/shared/storage/routeDbLocation';

const DOCS = '/var/mobile/Documents/';
const GROUP = '/var/mobile/Shared/AppGroup/ABC/';

interface FakeDisk {
  [path: string]: number;
}

function fileSystem(disk: FakeDisk, failOn?: string) {
  return {
    size: async (path: string) => disk[path] ?? null,
    copy: async (from: string, to: string) => {
      if (from === failOn) throw new Error('copy failed');
      if (disk[from] === undefined) throw new Error(`missing ${from}`);
      disk[to] = disk[from];
    },
    remove: async (path: string) => {
      delete disk[path];
    },
  };
}

describe('routeDbDirectory', () => {
  it('prefers the App Group container when there is one', () => {
    expect(routeDbDirectory(GROUP, DOCS)).toBe(GROUP);
  });

  it('falls back to documents when no App Group is available', () => {
    expect(routeDbDirectory(null, DOCS)).toBe(DOCS);
  });
});

describe('migrateRouteDb', () => {
  it('does nothing when the two directories are the same', async () => {
    const disk: FakeDisk = { [`${DOCS}routes.db`]: 100 };
    const fs = fileSystem(disk);
    await expect(migrateRouteDb(DOCS, DOCS, fs)).resolves.toBe(DOCS);
    expect(disk).toEqual({ [`${DOCS}routes.db`]: 100 });
  });

  it('does nothing when there is no database to move', async () => {
    const disk: FakeDisk = {};
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk))).resolves.toBe(GROUP);
    expect(disk).toEqual({});
  });

  it('carries the sidecars across and deletes the originals', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${DOCS}routes.db-wal`]: 512,
      [`${DOCS}routes.db-shm`]: 32,
    };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk))).resolves.toBe(GROUP);
    expect(disk).toEqual({
      [`${GROUP}routes.db`]: 4096,
      [`${GROUP}routes.db-wal`]: 512,
      [`${GROUP}routes.db-shm`]: 32,
    });
  });

  it('keeps the original when the copy fails, and reports the old directory', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${DOCS}routes.db-wal`]: 512,
    };
    const fs = fileSystem(disk, `${DOCS}routes.db`);
    await expect(migrateRouteDb(DOCS, GROUP, fs)).resolves.toBe(DOCS);
    expect(disk[`${DOCS}routes.db`]).toBe(4096);
    expect(disk[`${DOCS}routes.db-wal`]).toBe(512);
  });

  it('keeps the original when a sidecar fails to copy', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${DOCS}routes.db-wal`]: 512,
    };
    const fs = fileSystem(disk, `${DOCS}routes.db-wal`);
    await expect(migrateRouteDb(DOCS, GROUP, fs)).resolves.toBe(DOCS);
    expect(disk[`${DOCS}routes.db`]).toBe(4096);
  });

  it('does not delete the original until the copy reads back at the same size', async () => {
    const disk: FakeDisk = { [`${DOCS}routes.db`]: 4096 };
    const fs = {
      ...fileSystem(disk),
      copy: async (from: string, to: string) => {
        disk[to] = 1; // a truncated write
        void from;
      },
    };
    await expect(migrateRouteDb(DOCS, GROUP, fs)).resolves.toBe(DOCS);
    expect(disk[`${DOCS}routes.db`]).toBe(4096);
  });

  it('overwrites a half-finished earlier attempt rather than trusting it', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 12,
    };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk))).resolves.toBe(GROUP);
    expect(disk[`${GROUP}routes.db`]).toBe(4096);
    expect(disk[`${DOCS}routes.db`]).toBeUndefined();
  });

  it('leaves a stale sidecar from an abandoned attempt behind, not beside the new copy', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db-wal`]: 999,
    };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk))).resolves.toBe(GROUP);
    expect(disk[`${GROUP}routes.db-wal`]).toBeUndefined();
  });

  it('names the main file first, so a reader knows which one is authoritative', () => {
    expect(ROUTE_DB_FILES[0]).toBe('routes.db');
    expect(ROUTE_DB_FILES).toEqual(['routes.db', 'routes.db-wal', 'routes.db-shm']);
  });
});
