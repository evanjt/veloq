/**
 * Scenario: an iOS Notification Service Extension is a separate process and
 * cannot open anything under the app's Documents, so `routes.db` has to live
 * in the App Group container. Every released build put it in Documents.
 *
 * Expected behaviour: the database moves once, on upgrade, and the old copy
 * stays authoritative until a verified copy exists at the new location. A
 * library already at the new location is moved aside under a dated name and
 * never deleted, since the App Group container is shared by both app
 * identities and a library there is not this move's to overwrite.
 */
import {
  ROUTE_DB_FILES,
  routeDbDirectory,
  routeDbFilePaths,
  migrateRouteDb,
} from '@/shared/storage/routeDbLocation';

const DOCS = '/var/mobile/Documents/';
const GROUP = '/var/mobile/Shared/AppGroup/ABC/';
const STAMP = '20261001T080000Z';
const DISPLACED = `${GROUP}routes.db.displaced-${STAMP}`;

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
    move: async (from: string, to: string) => {
      if (disk[from] === undefined) throw new Error(`missing ${from}`);
      if (disk[to] !== undefined) throw new Error(`exists ${to}`);
      disk[to] = disk[from];
      delete disk[from];
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

  it('keeps Documents authoritative when removing its main file fails', async () => {
    const disk: FakeDisk = { [`${DOCS}routes.db`]: 4096 };
    const fs = {
      ...fileSystem(disk),
      remove: async (path: string) => {
        if (path === `${DOCS}routes.db`) throw new Error('delete failed');
        delete disk[path];
      },
    };

    await expect(migrateRouteDb(DOCS, GROUP, fs)).resolves.toBe(DOCS);
    expect(disk[`${GROUP}routes.db`]).toBeUndefined();
    disk[`${DOCS}routes.db`] = 8192;
    disk[`${GROUP}routes.db`] = 5000;
    await expect(migrateRouteDb(DOCS, GROUP, fs, STAMP)).resolves.toBe(DOCS);
    // The rejected copy is gone, and what sat at the target before is back.
    expect(disk[`${GROUP}routes.db`]).toBe(5000);
    expect(disk[DISPLACED]).toBeUndefined();
    expect(disk[`${DOCS}routes.db`]).toBe(8192);
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

  it('moves a half-finished earlier attempt aside rather than trusting it', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 12,
    };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk), STAMP)).resolves.toBe(GROUP);
    expect(disk[`${GROUP}routes.db`]).toBe(4096);
    expect(disk[DISPLACED]).toBe(12);
    expect(disk[`${DOCS}routes.db`]).toBeUndefined();
  });

  it('moves a library already at the target aside, sidecars and all, before the copy', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${DOCS}routes.db-wal`]: 512,
      [`${GROUP}routes.db`]: 9000,
      [`${GROUP}routes.db-wal`]: 700,
      [`${GROUP}routes.db-shm`]: 32,
    };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk), STAMP)).resolves.toBe(GROUP);
    expect(disk).toEqual({
      [`${GROUP}routes.db`]: 4096,
      [`${GROUP}routes.db-wal`]: 512,
      [DISPLACED]: 9000,
      [`${DISPLACED}-wal`]: 700,
      [`${DISPLACED}-shm`]: 32,
    });
  });

  it('puts the target library back when the source cannot be removed', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 9000,
      [`${GROUP}routes.db-wal`]: 700,
    };
    const fs = {
      ...fileSystem(disk),
      remove: async (path: string) => {
        if (path === `${DOCS}routes.db`) throw new Error('delete failed');
        delete disk[path];
      },
    };
    await expect(migrateRouteDb(DOCS, GROUP, fs, STAMP)).resolves.toBe(DOCS);
    expect(disk).toEqual({
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 9000,
      [`${GROUP}routes.db-wal`]: 700,
    });
  });

  it('puts the target library back when the copy fails', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${DOCS}routes.db-wal`]: 512,
      [`${GROUP}routes.db`]: 9000,
    };
    const fs = fileSystem(disk, `${DOCS}routes.db-wal`);
    await expect(migrateRouteDb(DOCS, GROUP, fs, STAMP)).resolves.toBe(DOCS);
    expect(disk).toEqual({
      [`${DOCS}routes.db`]: 4096,
      [`${DOCS}routes.db-wal`]: 512,
      [`${GROUP}routes.db`]: 9000,
    });
  });

  it('keeps Documents and touches nothing at the target when the move aside fails', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 9000,
    };
    const fs = {
      ...fileSystem(disk),
      move: async () => {
        throw new Error('move failed');
      },
    };
    await expect(migrateRouteDb(DOCS, GROUP, fs, STAMP)).resolves.toBe(DOCS);
    expect(disk).toEqual({
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 9000,
    });
  });

  it('does nothing on a second call after the move landed', async () => {
    const disk: FakeDisk = {
      [`${DOCS}routes.db`]: 4096,
      [`${GROUP}routes.db`]: 9000,
    };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk), STAMP)).resolves.toBe(GROUP);
    const landed = { ...disk };
    await expect(migrateRouteDb(DOCS, GROUP, fileSystem(disk), 'later')).resolves.toBe(GROUP);
    expect(disk).toEqual(landed);
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

describe('routeDbFilePaths', () => {
  it('names the database and both sidecars beside it', () => {
    expect(routeDbFilePaths(`${GROUP}routes.db`)).toEqual([
      `${GROUP}routes.db`,
      `${GROUP}routes.db-wal`,
      `${GROUP}routes.db-shm`,
    ]);
  });
});
