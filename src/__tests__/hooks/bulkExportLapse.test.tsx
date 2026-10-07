/**
 * Scenario: a whole-library bulk export outlives the minute the pills wait on
 * it. Rust keeps writing on its own thread, and the athlete either stays on the
 * screen, leaves and comes back, or taps a pill again.
 *
 * Expected behaviour: the run is observed exactly once. A write that finishes
 * is shared whether the screen stayed open or was left, a write that fails is
 * alerted by its engine variant either way, and a second tap never starts a
 * second export or reads the first one as a failure.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useBulkExport } from '@/features/settings/hooks/useBulkExport';
import {
  forgetPendingBulkExport,
  hasPendingBulkExport,
  resumePendingBulkExport,
} from '@/features/settings/lib/bulkExport';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockRunBulkExport = jest.fn();
let mockProgress = { running: false, visited: 0, total: 0 };
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    runBulkExport: (...args: unknown[]) => mockRunBulkExport(...args),
    bulkExportProgress: () => mockProgress,
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockShare = jest.fn();
jest.mock('@/features/settings/lib/shareFile', () => ({
  shareExistingFile: (...args: unknown[]) => mockShare(...args),
}));

/** The foreground wait, plus the sampling interval it is checked on. */
const PAST_THE_WAIT_MS = 61_000;

/** A write whose ending this test decides. */
function controlledWrite() {
  let resolve!: (written: unknown) => void;
  let reject!: (err: unknown) => void;
  mockRunBulkExport.mockImplementationOnce(
    () =>
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      })
  );
  return {
    finish: (written: unknown) => resolve(written),
    fail: (err: unknown) => reject(err),
  };
}

const written = (
  counts: Partial<Record<'exported' | 'noTrack' | 'trimmed' | 'failed', number>>
) => ({
  exported: 0,
  noTrack: 0,
  trimmed: 0,
  failed: 0,
  totalBytes: 1024,
  ...counts,
});

const diskFull = { tag: 'Database', inner: { msg: 'disk full' } };

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockRunBulkExport.mockReset();
  mockShare.mockReset().mockResolvedValue(undefined);
  mockProgress = { running: false, visited: 0, total: 0 };
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alert.mockRestore();
  jest.useRealTimers();
});

/** Tap GPX and wait out the foreground minute. */
async function lapse(result: { current: ReturnType<typeof useBulkExport> }) {
  await act(async () => {
    const tapped = result.current.exportAll();
    await jest.advanceTimersByTimeAsync(PAST_THE_WAIT_MS);
    await tapped;
  });
  expect(result.current.stillRunning).toBe(true);
}

async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });
}

describe('a lapsed export that finishes while the screen stays open', () => {
  it('is shared on the screen and the still-running line goes', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());

    await lapse(result);
    expect(mockShare).not.toHaveBeenCalled();

    write.finish(written({ exported: 12 }));
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(result.current.stillRunning).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    unmount();
  });

  it('says what it skipped when it lands late, the same as on time', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());

    await lapse(result);
    write.finish(written({ exported: 12, noTrack: 2 }));
    await flush();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toContain('export.bulkSkippedNoTrack');
    unmount();
  });
});

describe('a lapsed export that finishes after the screen was left', () => {
  it('is shared once, by the screen that came back', async () => {
    const write = controlledWrite();
    const first = renderHook(() => useBulkExport());
    await lapse(first.result);
    first.unmount();

    const second = renderHook(() => useBulkExport());
    await flush();
    expect(second.result.current.stillRunning).toBe(true);

    write.finish(written({ exported: 12 }));
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(second.result.current.stillRunning).toBe(false);
    second.unmount();
  });

  it('is shared once when it had finished before the screen came back', async () => {
    const write = controlledWrite();
    const first = renderHook(() => useBulkExport());
    await lapse(first.result);
    first.unmount();

    write.finish(written({ exported: 12 }));
    await flush();
    expect(mockShare).not.toHaveBeenCalled();

    const second = renderHook(() => useBulkExport());
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(second.result.current.stillRunning).toBe(false);
    second.unmount();
  });
});

describe('a lapsed export that then fails in Rust', () => {
  it('is alerted by its variant while the screen stays open', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());

    await lapse(result);
    write.fail(diskFull);
    await flush();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toBe('engine.failure.database');
    expect(result.current.stillRunning).toBe(false);
    expect(mockShare).not.toHaveBeenCalled();
    unmount();
  });

  it('is alerted once when it fails after the screen came back', async () => {
    const write = controlledWrite();
    const first = renderHook(() => useBulkExport());
    await lapse(first.result);
    first.unmount();

    const second = renderHook(() => useBulkExport());
    await flush();
    expect(second.result.current.stillRunning).toBe(true);

    write.fail(diskFull);
    await flush();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toContain('engine.failure.database');
    expect(second.result.current.stillRunning).toBe(false);
    expect(mockShare).not.toHaveBeenCalled();
    second.unmount();
  });

  it('is alerted by its variant on return to the screen', async () => {
    const write = controlledWrite();
    const first = renderHook(() => useBulkExport());
    await lapse(first.result);
    first.unmount();

    write.fail(diskFull);
    await flush();
    expect(alert).not.toHaveBeenCalled();

    const second = renderHook(() => useBulkExport());
    await flush();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toBe('engine.failure.database');
    expect(second.result.current.stillRunning).toBe(false);
    second.unmount();
  });

  it('is alerted the same as a failure inside the first wait', async () => {
    mockRunBulkExport.mockRejectedValueOnce(diskFull);
    const { result, unmount } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAll();
    });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toBe('engine.failure.database');
    unmount();
  });
});

describe('a second tap during a lapsed export', () => {
  it.each([['GPX', 'exportAll'] as const, ['GeoJSON', 'exportAllGeoJson'] as const])(
    'on %s starts nothing and raises nothing',
    async (_pill, tap) => {
      const write = controlledWrite();
      // What Rust answers a second run while the first holds the slot.
      mockRunBulkExport.mockRejectedValue({ tag: 'Busy', inner: { msg: 'already running' } });
      const { result, unmount } = renderHook(() => useBulkExport());
      await lapse(result);

      await act(async () => {
        await result.current[tap]();
      });

      expect(mockRunBulkExport).toHaveBeenCalledTimes(1);
      expect(alert).not.toHaveBeenCalled();
      expect(result.current.stillRunning).toBe(true);
      expect(result.current.error).toBeNull();

      write.finish(written({ exported: 12 }));
      await flush();
      expect(mockShare).toHaveBeenCalledTimes(1);
      unmount();
    }
  );

  it('reads a Busy refusal as still running, not as a failure', async () => {
    mockRunBulkExport.mockRejectedValueOnce({ tag: 'Busy', inner: { msg: 'already running' } });
    mockProgress = { running: true, visited: 5, total: 10 };
    const { result, unmount } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAll();
    });

    expect(alert).not.toHaveBeenCalled();
    expect(result.current.stillRunning).toBe(true);
    expect(result.current.error).toBeNull();
    unmount();
  });
});

describe('a screen that comes back inside the first minute', () => {
  /** Tap GPX, then leave before the foreground wait lapses. */
  async function leaveEarly() {
    const first = renderHook(() => useBulkExport());
    await act(async () => {
      void first.result.current.exportAll();
      await jest.advanceTimersByTimeAsync(10_000);
    });
    first.unmount();
  }

  it('shows the run as still going, and clears once it is shared', async () => {
    const write = controlledWrite();
    await leaveEarly();

    const second = renderHook(() => useBulkExport());
    await flush();
    expect(second.result.current.stillRunning).toBe(true);

    write.finish(written({ exported: 12 }));
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(second.result.current.stillRunning).toBe(false);
    second.unmount();
  });

  it('alerts a failure once, and clears', async () => {
    const write = controlledWrite();
    await leaveEarly();
    const second = renderHook(() => useBulkExport());
    await flush();

    write.fail(diskFull);
    await flush();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(second.result.current.stillRunning).toBe(false);
    second.unmount();
  });

  it('answers a tap with the run already going rather than starting another', async () => {
    const write = controlledWrite();
    await leaveEarly();
    const second = renderHook(() => useBulkExport());
    await flush();

    await act(async () => {
      await second.result.current.exportAll();
    });

    expect(mockRunBulkExport).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    write.finish(written({ exported: 12 }));
    await flush();
    expect(mockShare).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('is shared once by the screen that came back when the run then outlives the wait', async () => {
    const write = controlledWrite();
    await leaveEarly();
    const second = renderHook(() => useBulkExport());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PAST_THE_WAIT_MS);
    });
    expect(second.result.current.stillRunning).toBe(true);

    write.finish(written({ exported: 12 }));
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(second.result.current.stillRunning).toBe(false);
    second.unmount();
  });
});

describe('a Busy refusal with no run this process knows of', () => {
  it('clears once the worker reports it has ended', async () => {
    mockRunBulkExport.mockRejectedValueOnce({ tag: 'Busy', inner: { msg: 'already running' } });
    mockProgress = { running: true, visited: 5, total: 10 };
    const { result, unmount } = renderHook(() => useBulkExport());
    await act(async () => {
      await result.current.exportAll();
    });
    expect(result.current.stillRunning).toBe(true);

    mockProgress = { running: false, visited: 0, total: 0 };
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });

    expect(result.current.stillRunning).toBe(false);
    unmount();
  });
});

describe('the share of a run that landed late', () => {
  it('says it is sharing while the share sheet is up', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());
    await lapse(result);
    let closeSheet!: () => void;
    mockShare.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          closeSheet = res;
        })
    );

    write.finish(written({ exported: 12 }));
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('sharing');
    closeSheet();
    await flush();
    unmount();
  });
});

describe('the row while a late share sheet is up', () => {
  function heldSheet() {
    let close!: () => void;
    mockShare.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          close = res;
        })
    );
    return () => close();
  }

  it('stays on sharing past the next progress read', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());
    await lapse(result);
    const close = heldSheet();

    write.finish(written({ exported: 12 }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('sharing');
    expect(result.current.stillRunning).toBe(true);
    close();
    await flush();
    expect(result.current.stillRunning).toBe(false);
    unmount();
  });

  it('stays up after a second tap on the lapsed run', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());
    await lapse(result);
    await act(async () => {
      await result.current.exportAll();
    });
    const close = heldSheet();

    write.finish(written({ exported: 12 }));
    await flush();

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(result.current.stillRunning).toBe(true);
    close();
    await flush();
    expect(result.current.stillRunning).toBe(false);
    unmount();
  });
});

describe('the count while the worker runs', () => {
  it('hands on the current and total the worker reports', async () => {
    const write = controlledWrite();
    mockProgress = { running: true, visited: 150, total: 402 };
    const { result, unmount } = renderHook(() => useBulkExport());

    await act(async () => {
      void result.current.exportAll();
      await jest.advanceTimersByTimeAsync(600);
    });

    expect(result.current.current).toBe(150);
    expect(result.current.total).toBe(402);

    write.finish(written({ exported: 402 }));
    await flush();
    unmount();
  });
});

describe('the count after the foreground wait lapses', () => {
  it('keeps reading the worker while the screen stays open', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());
    await lapse(result);

    mockProgress = { running: true, visited: 900, total: 1500 };
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });

    expect(result.current.current).toBe(900);
    expect(result.current.total).toBe(1500);

    write.finish(written({ exported: 1500 }));
    await flush();
    unmount();
  });

  it('reads the worker again on return, under the format that is running', async () => {
    const write = controlledWrite();
    const first = renderHook(() => useBulkExport());
    await act(async () => {
      const tapped = first.result.current.exportAllGeoJson();
      await jest.advanceTimersByTimeAsync(PAST_THE_WAIT_MS);
      await tapped;
    });
    first.unmount();

    mockProgress = { running: true, visited: 1200, total: 1500 };
    const second = renderHook(() => useBulkExport());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });

    expect(second.result.current.stillRunning).toBe(true);
    expect(second.result.current.format).toBe('geojson');
    expect(second.result.current.current).toBe(1200);
    expect(second.result.current.total).toBe(1500);

    write.finish(written({ exported: 1500 }));
    await flush();
    second.unmount();
  });
});

describe('the completion alert names each skip reason', () => {
  it('keeps trimmed and failed tracks apart from the ones with no GPS', async () => {
    mockRunBulkExport.mockResolvedValueOnce(
      written({ exported: 400, noTrack: 40, trimmed: 3, failed: 1 })
    );
    const { result, unmount } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAll();
    });

    expect(alert).toHaveBeenCalledTimes(1);
    const lines = (alert.mock.calls[0][1] as string).split('\n');
    expect(lines.find((line) => line.startsWith('export.bulkSkippedNoTrack'))).toContain(
      '"count":40'
    );
    expect(lines.find((line) => line.startsWith('export.bulkSkippedTrimmed'))).toContain(
      '"count":3'
    );
    expect(lines.find((line) => line.startsWith('export.bulkSkippedFailed'))).toContain(
      '"count":1'
    );
    expect(lines.filter((line) => line.includes('"count":3'))).toHaveLength(1);
    unmount();
  });

  it('names only the reasons that skipped something', async () => {
    mockRunBulkExport.mockResolvedValueOnce(written({ exported: 400, trimmed: 3 }));
    const { result, unmount } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAll();
    });

    const body = alert.mock.calls[0][1] as string;
    expect(body).toContain('export.bulkSkippedTrimmed');
    expect(body).not.toContain('export.bulkSkippedNoTrack');
    expect(body).not.toContain('export.bulkSkippedFailed');
    unmount();
  });

  it('raises nothing when nothing was skipped', async () => {
    mockRunBulkExport.mockResolvedValueOnce(written({ exported: 400 }));
    const { result, unmount } = renderHook(() => useBulkExport());

    await act(async () => {
      await result.current.exportAll();
    });

    expect(alert).not.toHaveBeenCalled();
    unmount();
  });
});

describe('a lapsed export from a library that was wiped', () => {
  it('is owed to no one, and the next athlete is told nothing is pending', async () => {
    const write = controlledWrite();
    const { result, unmount } = renderHook(() => useBulkExport());

    await lapse(result);
    expect(hasPendingBulkExport()).toBe(true);

    forgetPendingBulkExport();
    write.finish(written({ exported: 12 }));
    await flush();

    expect(hasPendingBulkExport()).toBe(false);
    await expect(resumePendingBulkExport()).resolves.toEqual({ state: 'nothing-pending' });
    expect(mockShare).not.toHaveBeenCalled();
    unmount();
  });
});
