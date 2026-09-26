/**
 * Scenario: a ride is saved on a device with no connection, so intervals.icu
 * has never named it and cannot for hours.
 *
 * Expected behaviour: the engine holds a row for it from the save, keyed
 * under a key the device minted, with the track, the body the feed reads and
 * the metrics row the weekly summary counts. When the upload finally lands,
 * the server's id is written beside that key rather than the row being
 * rewritten, so the sync matches on it and the week does not count the ride
 * twice.
 */

import {
  writeProvisionalActivity,
  recordProvisionalUpload,
  reconcileProvisionalUploads,
} from '@/features/recording/lib/storage/provisionalActivity';
import {
  listRecordings,
  markRecordingReconciled,
} from '@/features/recording/lib/storage/recordingLibrary';
import { engine } from 'veloqrs';
import type { RecordingLibraryEntry, RecordingStreams } from '@/types';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: {
      ready: true,
      provisionalActivityId: jest.fn(() => 'local-deadbeef'),
      saveProvisionalActivity: jest.fn(() => true),
      addActivities: jest.fn(async () => {}),
      upsertActivityBodies: jest.fn(),
      setActivityMetrics: jest.fn(),
      recordActivityUpload: jest.fn(() => true),
    },
  })
);

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  listRecordings: jest.fn(async () => []),
  markRecordingReconciled: jest.fn(async () => null),
}));

const mockList = listRecordings as jest.Mock;
const mockMarkReconciled = markRecordingReconciled as jest.Mock;
const mint = engine.provisionalActivityId as unknown as jest.Mock;
const addActivities = engine.addActivities as unknown as jest.Mock;
const upsertBodies = engine.upsertActivityBodies as unknown as jest.Mock;
const setMetrics = engine.setActivityMetrics as unknown as jest.Mock;
const saveProvisional = engine.saveProvisionalActivity as unknown as jest.Mock;
const recordUpload = engine.recordActivityUpload as unknown as jest.Mock;

/** The stub's readiness, which is what the delegate's false actually means. */
function setReady(ready: boolean): void {
  (engine as unknown as { ready: boolean }).ready = ready;
}

const ENTRY: RecordingLibraryEntry = {
  id: '1757150000000-ab12cd',
  kind: 'fit',
  fitPath: 'file:///recordings/1757150000000-ab12cd.fit',
  activityType: 'Ride',
  name: 'Evening Ride',
  // 2026-03-08T18:30:00 local, as the recorder stamps it.
  startTime: new Date(2026, 2, 8, 18, 30, 0).getTime(),
  durationSeconds: 3600,
  distanceMeters: 28_400,
  elevationGain: 310,
  avgHeartrate: 141,
  createdAt: Date.now(),
  uploadStatus: 'localOnly',
  retryCount: 0,
};

function streams(points: [number, number][]): RecordingStreams {
  return {
    time: points.map((_, i) => i),
    latlng: points,
    altitude: points.map(() => 100),
    heartrate: points.map(() => 140),
    power: [],
    cadence: [],
    speed: points.map(() => 7.9),
    distance: points.map((_, i) => i * 8),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (engine as unknown as { ready: boolean }).ready = true;
  mint.mockReturnValue('local-deadbeef');
  saveProvisional.mockReset().mockReturnValue(true);
  recordUpload.mockReturnValue(true);
  mockList.mockResolvedValue([]);
});

describe('writeProvisionalActivity', () => {
  it('writes the track, the body and the metrics under a minted key', async () => {
    const key = await writeProvisionalActivity(
      ENTRY,
      streams([
        [-33.86, 151.2],
        [-33.87, 151.21],
      ])
    );

    expect(key).toBe('local-deadbeef');
    expect(saveProvisional).toHaveBeenCalledTimes(1);
    const [id, coords, row, metrics] = saveProvisional.mock.calls[0];
    expect(id).toBe('local-deadbeef');
    expect(coords).toEqual([-33.86, 151.2, -33.87, 151.21]);
    expect(row.activityId).toBe('local-deadbeef');
    expect(addActivities).not.toHaveBeenCalled();
    expect(upsertBodies).not.toHaveBeenCalled();
    expect(setMetrics).not.toHaveBeenCalled();
    const body = JSON.parse(row.raw);
    expect(body.id).toBe('local-deadbeef');
    expect(body.name).toBe('Evening Ride');
    expect(body.type).toBe('Ride');
    expect(body.start_date_local).toBe('2026-03-08T18:30:00');
    expect(body.moving_time).toBe(3600);
    expect(body.distance).toBe(28_400);
    expect(body.total_elevation_gain).toBe(310);
    expect(body.average_heartrate).toBe(141);

    expect(metrics.activityId).toBe('local-deadbeef');
    expect(metrics.date).toBe(Date.UTC(2026, 2, 8, 18, 30, 0) / 1000);
  });

  it('writes a row for an indoor ride that has no track at all', async () => {
    const key = await writeProvisionalActivity(
      { ...ENTRY, activityType: 'VirtualRide' },
      streams([])
    );

    expect(key).toBe('local-deadbeef');
    expect(addActivities).not.toHaveBeenCalled();
    expect(saveProvisional.mock.calls[0][1]).toEqual([]);
    expect(saveProvisional).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and answers null when the engine is not open', async () => {
    (engine as unknown as { ready: boolean }).ready = false;

    expect(await writeProvisionalActivity(ENTRY, streams([[-33.86, 151.2]]))).toBeNull();
    expect(addActivities).not.toHaveBeenCalled();
    expect(upsertBodies).not.toHaveBeenCalled();
    expect(setMetrics).not.toHaveBeenCalled();
  });

  it('answers null rather than throwing when a write fails, so the save still stands', async () => {
    saveProvisional.mockImplementationOnce(() => {
      throw new Error('engine closed mid-write');
    });

    expect(await writeProvisionalActivity(ENTRY, streams([[-33.86, 151.2]]))).toBeNull();
  });

  it('answers null when no key can be minted', async () => {
    mint.mockReturnValue('');

    expect(await writeProvisionalActivity(ENTRY, streams([[-33.86, 151.2]]))).toBeNull();
    expect(addActivities).not.toHaveBeenCalled();
  });

  it('waits for the worker to commit before answering a saved key', async () => {
    let commit!: (saved: boolean) => void;
    saveProvisional.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        commit = resolve;
      })
    );
    const saved = writeProvisionalActivity(ENTRY, null);
    let settled = false;
    void saved.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    commit(true);
    expect(await saved).toBe('local-deadbeef');
  });

  it('reuses the stored activity key on a retry', async () => {
    expect(
      await writeProvisionalActivity({ ...ENTRY, engineActivityId: 'local-existing' }, null)
    ).toBe('local-existing');
    expect(mint).not.toHaveBeenCalled();
    expect(saveProvisional.mock.calls[0][0]).toBe('local-existing');
  });

  it('can retry after an atomic write fails', async () => {
    saveProvisional.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(await writeProvisionalActivity(ENTRY, null)).toBeNull();
    expect(await writeProvisionalActivity(ENTRY, null)).toBe('local-deadbeef');
  });

  it('answers null when the engine closes before the atomic write', async () => {
    saveProvisional.mockReturnValueOnce(false);
    expect(await writeProvisionalActivity(ENTRY, null)).toBeNull();
  });

  it('uses the same key when the same recording is saved twice', async () => {
    const first = await writeProvisionalActivity(ENTRY, streams([[-33.86, 151.2]]));
    const second = await writeProvisionalActivity(ENTRY, streams([[-33.86, 151.2]]));
    expect([first, second]).toEqual(['local-deadbeef', 'local-deadbeef']);
    expect(mint).toHaveBeenNthCalledWith(1, ENTRY.id);
    expect(mint).toHaveBeenNthCalledWith(2, ENTRY.id);
  });
});

describe('recordProvisionalUpload', () => {
  it('writes the id the server gave the ride onto the provisional row', async () => {
    await recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, 'i4242');

    expect(recordUpload).toHaveBeenCalledWith('local-deadbeef', 'i4242');
    expect(mockMarkReconciled).toHaveBeenCalledWith(ENTRY.id);
  });

  it('does nothing for a recording that never got a provisional row', async () => {
    await recordProvisionalUpload(ENTRY, 'i4242');

    expect(recordUpload).not.toHaveBeenCalled();
    expect(mockMarkReconciled).not.toHaveBeenCalled();
  });

  it('does nothing when the upload came back without an id', async () => {
    await recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, undefined);

    expect(recordUpload).not.toHaveBeenCalled();
  });

  it('leaves the entry unreconciled when the engine refuses the write', async () => {
    recordUpload.mockImplementationOnce(() => {
      throw new Error('engine closed');
    });

    await expect(
      recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, 'i4242')
    ).resolves.toBe(false);
    expect(mockMarkReconciled).not.toHaveBeenCalled();
  });

  it('counts a row that already carries the id as reconciled', async () => {
    recordUpload.mockReturnValueOnce(false);

    await expect(
      recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, 'i4242')
    ).resolves.toBe(true);
    expect(mockMarkReconciled).toHaveBeenCalledWith(ENTRY.id);
  });

  /**
   * A closed engine is the case the reconcile pass exists for. The delegate
   * answers false there without reaching Rust, which reads exactly like Rust's
   * own "already carries an id", so settling on it loses the ride to a
   * duplicate on the next sync.
   */
  it('does not settle a ride the closed engine never took', async () => {
    setReady(false);

    await expect(
      recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, 'i4242')
    ).resolves.toBe(false);
    expect(recordUpload).not.toHaveBeenCalled();
    expect(mockMarkReconciled).not.toHaveBeenCalled();
  });

  it('settles a ride the engine did take', async () => {
    recordUpload.mockReturnValueOnce(true);

    await expect(
      recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, 'i4242')
    ).resolves.toBe(true);
    expect(mockMarkReconciled).toHaveBeenCalledWith(ENTRY.id);
  });

  /**
   * Rust's own false is settled: the row already carries an id or has gone.
   * The entry is done and must not be retried forever.
   */
  it('settles a ride whose row already carries the id', async () => {
    recordUpload.mockReturnValueOnce(false);

    await expect(
      recordProvisionalUpload({ ...ENTRY, engineActivityId: 'local-deadbeef' }, 'i4242')
    ).resolves.toBe(true);
    expect(mockMarkReconciled).toHaveBeenCalledWith(ENTRY.id);
  });
});

describe('reconcileProvisionalUploads', () => {
  const UPLOADED = {
    ...ENTRY,
    uploadStatus: 'uploaded' as const,
    engineActivityId: 'local-deadbeef',
    intervalsActivityId: 'i4242',
  };

  it('replays the write for an upload that landed but never reached the row', async () => {
    mockList.mockResolvedValue([UPLOADED]);

    await expect(reconcileProvisionalUploads()).resolves.toBe(1);
    expect(recordUpload).toHaveBeenCalledWith('local-deadbeef', 'i4242');
  });

  it('skips an entry already reconciled, so an old library costs nothing', async () => {
    mockList.mockResolvedValue([{ ...UPLOADED, engineReconciled: true }]);

    await expect(reconcileProvisionalUploads()).resolves.toBe(0);
    expect(recordUpload).not.toHaveBeenCalled();
  });

  it('skips an entry with only one of the two ids', async () => {
    mockList.mockResolvedValue([
      { ...UPLOADED, intervalsActivityId: undefined },
      { ...UPLOADED, id: 'rec-2', engineActivityId: undefined },
    ]);

    await expect(reconcileProvisionalUploads()).resolves.toBe(0);
    expect(recordUpload).not.toHaveBeenCalled();
  });

  it('carries on past an entry the engine refuses', async () => {
    recordUpload.mockImplementationOnce(() => {
      throw new Error('engine closed');
    });
    mockList.mockResolvedValue([UPLOADED, { ...UPLOADED, id: 'rec-2' }]);

    await expect(reconcileProvisionalUploads()).resolves.toBe(1);
    expect(recordUpload).toHaveBeenCalledTimes(2);
  });

  it('answers zero on an empty library', async () => {
    mockList.mockResolvedValue([]);

    await expect(reconcileProvisionalUploads()).resolves.toBe(0);
  });
});

describe('an unreconciled entry survives a closed engine', () => {
  it('is retried by the next pass once the engine is ready', async () => {
    const owed = {
      ...ENTRY,
      engineActivityId: 'local-deadbeef',
      intervalsActivityId: 'i4242',
      engineReconciled: false,
    };
    mockList.mockResolvedValue([owed]);
    setReady(false);

    await expect(reconcileProvisionalUploads()).resolves.toBe(0);
    expect(mockMarkReconciled).not.toHaveBeenCalled();

    setReady(true);
    recordUpload.mockReturnValueOnce(true);
    await expect(reconcileProvisionalUploads()).resolves.toBe(1);
    expect(mockMarkReconciled).toHaveBeenCalledWith(owed.id);
  });
});
