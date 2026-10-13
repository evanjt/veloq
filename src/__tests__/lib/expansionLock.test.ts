/**
 * Scenario: the expansion latch set by a reset is released by the GPS sync
 * reaching a terminal state.
 * Expected behaviour: every way a run started after the reset can stop
 * releases it, not only a completed pass, or the Local Data Range slider stays
 * locked for the session. A terminal status left by a run from before the
 * reset releases nothing.
 */

import { syncSettledForExpansion } from '@/shared/app/expansionLock';
import {
  stampedProgressWriter,
  type SyncProgress,
} from '@/features/routes/hooks/useRouteSyncProgress';

const LOCKED_AT = 3;

describe('syncSettledForExpansion', () => {
  it('settles on a completed pass', () => {
    expect(
      syncSettledForExpansion({ status: 'complete', generation: LOCKED_AT }, 12, LOCKED_AT)
    ).toBe(true);
  });

  it('settles on a failed pass', () => {
    expect(syncSettledForExpansion({ status: 'error', generation: LOCKED_AT }, 12, LOCKED_AT)).toBe(
      true
    );
  });

  it('settles when there is nothing to sync, since no pass will ever run', () => {
    expect(syncSettledForExpansion({ status: 'idle' }, 0, LOCKED_AT)).toBe(true);
  });

  it('does not settle while a pass is running', () => {
    for (const status of ['fetching', 'processing', 'computing'] as const) {
      expect(syncSettledForExpansion({ status, generation: LOCKED_AT }, 12, LOCKED_AT)).toBe(false);
    }
  });

  it('does not settle before the activities are loaded', () => {
    expect(syncSettledForExpansion({ status: 'idle' }, null, LOCKED_AT)).toBe(false);
  });

  it('does not settle on an idle sync that has activities to run against', () => {
    expect(syncSettledForExpansion({ status: 'idle' }, 12, LOCKED_AT)).toBe(false);
  });

  it('does not settle on a terminal status left by a run from before the reset', () => {
    for (const status of ['complete', 'error'] as const) {
      expect(syncSettledForExpansion({ status, generation: LOCKED_AT - 1 }, 12, LOCKED_AT)).toBe(
        false
      );
    }
  });

  it('does not settle on a terminal status no run has stamped', () => {
    expect(syncSettledForExpansion({ status: 'complete' }, 12, LOCKED_AT)).toBe(false);
  });
});

describe('stampedProgressWriter', () => {
  const idle: SyncProgress = { status: 'idle', completed: 0, total: 0, percent: 0, message: '' };

  function apply(
    writes: Parameters<ReturnType<typeof stampedProgressWriter>>[0][],
    generation: number
  ) {
    let state = idle;
    const write = stampedProgressWriter((u) => {
      state = typeof u === 'function' ? u(state) : u;
    }, generation);
    for (const w of writes) write(w);
    return state;
  }

  it('stamps a plain write with the generation the run started at', () => {
    const done = apply([{ ...idle, status: 'complete' }], LOCKED_AT - 1);
    expect(done.generation).toBe(LOCKED_AT - 1);
    expect(syncSettledForExpansion(done, 12, LOCKED_AT)).toBe(false);
  });

  it('stamps a functional write too', () => {
    const done = apply([(prev) => ({ ...prev, status: 'error' })], LOCKED_AT);
    expect(done).toMatchObject({ status: 'error', generation: LOCKED_AT });
    expect(syncSettledForExpansion(done, 12, LOCKED_AT)).toBe(true);
  });
});
