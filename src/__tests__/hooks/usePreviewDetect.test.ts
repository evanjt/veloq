/**
 * Scenario: the preview screen drives one sandboxed detection run. The hook
 * must merge only the five staged sliders over the live config, read progress
 * when the engine announces a phase rather than on a timer, settle on the
 * engine's finish event rather than on a status poll, take the result exactly
 * once, and read a refused start as suspension rather than failure.
 */

import { act, renderHook } from '@testing-library/react-native';
import { isRetryableStart, StartOutcome, type StartVerdict } from 'veloqrs';
import {
  PREVIEW_DEBOUNCE_MS,
  PREVIEW_LAPSE_AFTER_MS,
  PREVIEW_POLL_INTERVAL_MS,
  usePreviewDetect,
} from '@/features/routes/hooks/usePreviewDetect';
import type {
  PreviewClient,
  PreviewParams,
  PreviewPollStatus,
  PreviewResult,
  PreviewSection,
} from '../../../modules/veloqrs/src/delegates/preview';
import type { FfiSectionConfig } from '../../../modules/veloqrs/src/generated/veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const LIVE_CONFIG: FfiSectionConfig = {
  proximityThreshold: 100,
  minSectionLength: 200,
  maxSectionLength: 10000,
  minActivities: 3,
  divergenceThreshold: 0.2,
};

const PARAMS: PreviewParams = {
  proximityThreshold: 50,
  minSectionLength: 400,
  maxSectionLength: 8000,
  minActivities: 5,
  divergenceThreshold: 0.1,
};

const RESULT: PreviewResult = {
  pool: { activities: 10, empty: 0, unreadable: 0 },
  elapsedMs: 1234,
  config: PARAMS,
  counts: { current: 2, proposed: 2, unchanged: 1, changed: 1, new: 0, gone: 0 },
  sections: [],
};

/** The `previewFinished` callbacks the hook has registered on the client. */
let finishListeners: Set<() => void>;
/** The `previewPhase` callbacks the hook has registered on the client. */
let phaseListeners: Set<() => void>;
/** How many registrations the hook has detached. */
let detaches: number;

async function fireFinished() {
  await act(() => {
    [...finishListeners].forEach((cb) => cb());
  });
}

async function firePhase() {
  await act(() => {
    [...phaseListeners].forEach((cb) => cb());
  });
}

function makeClient(over: Partial<PreviewClient> = {}) {
  return {
    subscribe: jest.fn((event: string, cb: () => void) => {
      const listeners =
        event === 'previewFinished'
          ? finishListeners
          : event === 'previewPhase'
            ? phaseListeners
            : null;
      if (!listeners) return () => {};
      listeners.add(cb);
      return () => {
        detaches += 1;
        listeners.delete(cb);
      };
    }),
    getPreviewCentres: jest.fn(() => []),
    getPreviewCurrentSections: jest.fn((): PreviewSection[] => []),
    startPreviewDetect: jest.fn(() => StartOutcome.Started),
    pollPreviewDetect: jest.fn((): PreviewPollStatus => 'running'),
    getPreviewProgress: jest.fn(() => null),
    takePreviewResult: jest.fn((): PreviewResult | null => null),
    cancelPreviewDetect: jest.fn(),
    getSectionConfig: jest.fn((): FfiSectionConfig | null => ({ ...LIVE_CONFIG })),
    setSectionConfig: jest.fn(),
    forceRedetectSections: jest.fn(() => StartOutcome.Started),
    ...over,
  };
}

const LONG_RUN_MS = 10 * 60_000;

describe('usePreviewDetect', () => {
  beforeEach(() => {
    finishListeners = new Set();
    phaseListeners = new Set();
    detaches = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('merges only the staged params over the live config', async () => {
    const client = makeClient();
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });

    expect(client.startPreviewDetect).toHaveBeenCalledWith(10, 20, {
      ...LIVE_CONFIG,
      ...PARAMS,
    });
    expect(result.current.status).toBe('running');
  });

  it('reads progress when a phase is announced and surfaces a display name', async () => {
    const client = makeClient({
      getPreviewProgress: jest.fn(() => ({
        phase: 'loading',
        completed: 3,
        total: 12,
        percent: 25,
      })),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    expect(client.subscribe).toHaveBeenCalledWith('previewPhase', expect.any(Function));
    expect(client.getPreviewProgress).not.toHaveBeenCalled();

    await firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toMatchObject({
      phase: 'loading',
      completed: 3,
      total: 12,
      percent: 25,
    });

    await firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(2);
  });

  it('arms no timer, so a long run costs one read per announced phase', async () => {
    const client = makeClient({
      getPreviewProgress: jest.fn(() => ({
        phase: 'analyzing',
        completed: 0,
        total: 40,
        percent: 5,
      })),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await act(() => {
      jest.advanceTimersByTime(600000);
    });

    expect(client.getPreviewProgress).not.toHaveBeenCalled();
    // Only the fallback status poll is left, and it carries no progress read.
    expect(jest.getTimerCount()).toBe(1);
  });

  it('stops reading phases once the run settles', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
      getPreviewProgress: jest.fn(() => ({
        phase: 'loading',
        completed: 1,
        total: 4,
        percent: 1,
      })),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(1);

    await fireFinished();
    expect(result.current.status).toBe('complete');
    expect(phaseListeners.size).toBe(0);

    await firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(1);
  });

  it('reads nothing at all between the start and the finish event', async () => {
    const client = makeClient();
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(client.subscribe).toHaveBeenCalledWith('previewFinished', expect.any(Function));
    expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();
    expect(client.takePreviewResult).not.toHaveBeenCalled();
    expect(client.cancelPreviewDetect).not.toHaveBeenCalled();
    expect(client.getPreviewCentres).not.toHaveBeenCalled();
    expect(client.getPreviewCurrentSections).not.toHaveBeenCalled();
    expect(result.current.status).toBe('running');
  });

  it('leaves the run live when the engine still reads running at the notice', async () => {
    const poll = jest.fn((): PreviewPollStatus => 'running');
    const client = makeClient({ pollPreviewDetect: poll });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.status).toBe('running');
    expect(detaches).toBe(0);

    poll.mockReturnValue('complete');
    await fireFinished();

    expect(result.current.status).toBe('complete');
    expect(poll).toHaveBeenCalledTimes(2);
    expect(detaches).toBe(2);
  });

  it('subscribes afresh for a second run', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();
    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(client.subscribe).toHaveBeenCalledTimes(4);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(2);
    expect(finishListeners.size).toBe(0);
    expect(phaseListeners.size).toBe(0);
    expect(detaches).toBe(4);
  });

  it('takes the result exactly once on the finish event and stops', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.status).toBe('complete');
    expect(result.current.result).toEqual(RESULT);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(1);
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);

    await fireFinished();
    await act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(1);
    expect(client.getPreviewProgress).not.toHaveBeenCalled();
    expect(detaches).toBe(2);
  });

  it("passes the engine's own refusal through rather than one standing for four", async () => {
    const client = makeClient({ startPreviewDetect: jest.fn(() => StartOutcome.Held) });
    const { result } = await renderHook(() => usePreviewDetect(client));

    let outcome: StartVerdict = StartOutcome.Started;
    await act(() => {
      outcome = result.current.start(10, 20, PARAMS);
    });

    expect(outcome).toBe(StartOutcome.Held);
    expect(result.current.refusal).toBe(StartOutcome.Held);
    expect(result.current.status).toBe('idle');
  });

  it('keeps the retry time of a refused preview start', async () => {
    const held = { outcome: StartOutcome.Held, retryAtMs: 1_500_000 };
    const client = makeClient({ startPreviewDetect: jest.fn(() => held) });
    const { result } = await renderHook(() => usePreviewDetect(client));

    let outcome: StartVerdict = StartOutcome.Started;
    await act(() => {
      outcome = result.current.start(10, 20, PARAMS);
    });

    expect(outcome).toEqual(held);
    expect(result.current.refusal).toEqual(held);
    expect(result.current.status).toBe('idle');
  });

  it('reads a run already in flight as busy, and still waiting', async () => {
    const client = makeClient({ startPreviewDetect: jest.fn(() => StartOutcome.Busy) });
    const { result } = await renderHook(() => usePreviewDetect(client));

    let outcome: StartVerdict = StartOutcome.Started;
    await act(() => {
      outcome = result.current.start(10, 20, PARAMS);
    });

    expect(outcome).toBe(StartOutcome.Busy);
    expect(result.current.refusal).toBe(StartOutcome.Busy);
  });

  it('does not read a point nothing covers as something that will lift', async () => {
    const client = makeClient({ startPreviewDetect: jest.fn(() => StartOutcome.NotOwed) });
    const { result } = await renderHook(() => usePreviewDetect(client));

    let outcome: StartVerdict = StartOutcome.Started;
    await act(() => {
      outcome = result.current.start(10, 20, PARAMS);
    });

    expect(outcome).toBe(StartOutcome.NotOwed);
    expect(result.current.refusal).toBe(StartOutcome.NotOwed);
    expect(result.current.status).toBe('idle');
  });

  it('keeps a not-ready refusal as its own outcome', async () => {
    const client = makeClient({ startPreviewDetect: jest.fn(() => StartOutcome.NotReady) });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });

    expect(result.current.refusal).toBe(StartOutcome.NotReady);
  });

  it('clears a refusal when the next start is accepted', async () => {
    const startPreviewDetect = jest
      .fn()
      .mockReturnValueOnce(StartOutcome.Held)
      .mockReturnValueOnce(StartOutcome.Started);
    const client = makeClient({ startPreviewDetect });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    expect(result.current.refusal).toBe(StartOutcome.Held);
    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    expect(result.current.refusal).toBeNull();
  });

  it('surfaces an engine error and stops', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'error'),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.status).toBe('error');
    await act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
  });

  it('surfaces a refused pool from the finish event', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'pool_unusable'),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.status).toBe('pool_unusable');
    expect(result.current.progress).toBeNull();
  });

  it('reads idle mid-run as an error, never a clean finish', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'idle'),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.status).toBe('error');
    expect(result.current.result).toBeNull();
  });

  it('cancel tells the engine and lands in cancelled', async () => {
    const client = makeClient();
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await act(() => {
      result.current.cancel();
    });

    expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('cancelled');

    // The cancel is cooperative, so the run is followed until the worker
    // announces its end, and nothing it produced is shown.
    expect(detaches).toBe(0);
    (client.pollPreviewDetect as jest.Mock).mockReturnValue('cancelled');
    await fireFinished();
    await act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.takePreviewResult).not.toHaveBeenCalled();
    expect(result.current.status).toBe('cancelled');
    expect(detaches).toBe(2);
  });

  it('fails the start when no live config exists, and says it will not lift', async () => {
    const client = makeClient({ getSectionConfig: jest.fn(() => null) });
    const { result } = await renderHook(() => usePreviewDetect(client));

    let outcome: StartVerdict = StartOutcome.Started;
    await act(() => {
      outcome = result.current.start(10, 20, PARAMS);
    });

    expect(outcome).toBe(StartOutcome.NotConfigured);
    expect(isRetryableStart(outcome)).toBe(false);
    expect(client.startPreviewDetect).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
  });

  it('cancels a live run on unmount', async () => {
    const client = makeClient();
    const { result, unmount } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await unmount();

    expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    expect(detaches).toBe(2);
    await fireFinished();
    await act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();
  });

  it('reset clears the previous result and state', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();
    expect(result.current.result).toEqual(RESULT);

    await act(() => {
      result.current.reset();
    });
    expect(result.current).toMatchObject({ status: 'idle', result: null, progress: null });
    expect(finishListeners.size).toBe(0);

    await fireFinished();
    expect(result.current.status).toBe('idle');
  });

  it('keeps the finished diff on screen while the next run computes', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();
    expect(result.current.result).toEqual(RESULT);

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });

    expect(result.current.status).toBe('running');
    expect(result.current.result).toEqual(RESULT);
  });

  it('swaps the held result for the new one when the run settles', async () => {
    const second: PreviewResult = { ...RESULT, elapsedMs: 999 };
    const takePreviewResult = jest.fn(() => RESULT);
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult,
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    takePreviewResult.mockReturnValue(second);
    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.result).toEqual(second);
  });

  it('leaves the last diff standing when a run is cancelled', async () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await act(() => {
      result.current.cancel();
    });

    expect(result.current.status).toBe('cancelled');
    expect(result.current.result).toEqual(RESULT);
  });

  it('leaves the last diff standing when a run fails', async () => {
    const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'complete');
    const client = makeClient({
      takePreviewResult: jest.fn(() => RESULT),
      pollPreviewDetect,
    });
    const { result } = await renderHook(() => usePreviewDetect(client));

    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    pollPreviewDetect.mockReturnValue('error');
    await act(() => {
      result.current.start(10, 20, PARAMS);
    });
    await fireFinished();

    expect(result.current.status).toBe('error');
    expect(result.current.result).toEqual(RESULT);
  });

  // Scenario: the run's end arrives on an event and nothing else. A dropped
  // event, an observer that was never registered, or an engine that never
  // finishes all leave the same spinner, so the run carries its own budgets.
  describe('when the finish event never arrives', () => {
    it('settles from the poll when the event is lost', async () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'running');
      const client = makeClient({
        pollPreviewDetect,
        takePreviewResult: jest.fn(() => RESULT),
      });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS);
      });
      pollPreviewDetect.mockReturnValue('complete');
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_POLL_INTERVAL_MS);
      });

      expect(result.current.status).toBe('complete');
      expect(result.current.result).toEqual(RESULT);
    });

    it('does not lapse on a suspension shorter than its budget in awake time', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.setSystemTime(Date.now() + PREVIEW_LAPSE_AFTER_MS * 4);
        jest.advanceTimersByTime(PREVIEW_POLL_INTERVAL_MS);
      });

      expect(result.current.lapsed).toBe(false);
      expect(client.pollPreviewDetect).not.toHaveBeenCalled();
    });

    it('leaves the run live while the poll still reads running', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS + PREVIEW_POLL_INTERVAL_MS * 5);
      });

      expect(result.current.status).toBe('running');
      expect(client.takePreviewResult).not.toHaveBeenCalled();
    });

    it('reads nothing at all before the lapse budget passes', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS - 1);
      });

      expect(client.pollPreviewDetect).not.toHaveBeenCalled();
      expect(result.current.status).toBe('running');
    });

    it('says the run is slow once its lapse budget passes, and keeps following', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      expect(result.current.lapsed).toBe(false);

      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS);
      });

      expect(result.current.lapsed).toBe(true);
      expect(result.current.status).toBe('running');
    });

    it('never cancels a run that is still running, however long it takes', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(LONG_RUN_MS);
      });

      expect(result.current.status).toBe('running');
      expect(result.current.lapsed).toBe(true);
      expect(client.cancelPreviewDetect).not.toHaveBeenCalled();
    });

    it('takes the result when a lapsed run finishes without its event', async () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'running');
      const client = makeClient({
        pollPreviewDetect,
        takePreviewResult: jest.fn(() => RESULT),
      });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(LONG_RUN_MS);
      });
      pollPreviewDetect.mockReturnValue('complete');
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_POLL_INTERVAL_MS);
      });

      expect(result.current.status).toBe('complete');
      expect(client.cancelPreviewDetect).not.toHaveBeenCalled();
    });
  });

  // A settled run owns no timers. A budget that outlives its run would
  // overwrite the answer the user is already looking at.
  describe('budgets end with the run', () => {
    it('drops them when the finish event settles the run', async () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'complete');
      const client = makeClient({
        pollPreviewDetect,
        takePreviewResult: jest.fn(() => RESULT),
      });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await fireFinished();
      expect(result.current.status).toBe('complete');

      await act(() => {
        jest.advanceTimersByTime(LONG_RUN_MS * 2);
      });

      expect(result.current.status).toBe('complete');
      expect(result.current.lapsed).toBe(false);
      expect(client.cancelPreviewDetect).not.toHaveBeenCalled();
      expect(client.takePreviewResult).toHaveBeenCalledTimes(1);
    });

    it('drops them when the user cancels', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.cancel();
      });
      await act(() => {
        jest.advanceTimersByTime(LONG_RUN_MS * 2);
      });

      expect(result.current.status).toBe('cancelled');
      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    });

    it('drops them when the hook unmounts', async () => {
      const client = makeClient();
      const { result, unmount } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await unmount();
      await act(() => {
        jest.advanceTimersByTime(LONG_RUN_MS * 2);
      });

      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
      expect(client.pollPreviewDetect).not.toHaveBeenCalled();
    });

    it('clears the lapse when the run is reset', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS);
      });
      expect(result.current.lapsed).toBe(true);

      await act(() => {
        result.current.reset();
      });

      expect(result.current.lapsed).toBe(false);
    });

    it('starts the budgets of a second run from zero', async () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'complete');
      const client = makeClient({ pollPreviewDetect });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await fireFinished();

      pollPreviewDetect.mockReturnValue('running');
      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS - 1);
      });
      expect(result.current.lapsed).toBe(false);

      await act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(result.current.lapsed).toBe(true);
    });
  });

  describe('regenerating on a settled slider', () => {
    const NEXT: PreviewParams = { ...PARAMS, minActivities: 7 };
    const LAST: PreviewParams = { ...PARAMS, minActivities: 9 };

    it('starts nothing until the values have stood still, then runs the last of them', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.request(10, 20, NEXT);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
      });
      await act(() => {
        result.current.request(10, 20, LAST);
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
      });
      expect(client.startPreviewDetect).not.toHaveBeenCalled();

      await act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
      expect(client.startPreviewDetect).toHaveBeenCalledWith(10, 20, { ...LIVE_CONFIG, ...LAST });
      expect(result.current.status).toBe('running');
    });

    it('cancels the run in flight and starts the new values once it has ended', async () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'running');
      const client = makeClient({ pollPreviewDetect });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.request(10, 20, NEXT);
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });

      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
      // The engine cancel is cooperative, so the old run still holds the slot
      // and a start now would be refused as busy.
      expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('running');

      pollPreviewDetect.mockReturnValue('cancelled');
      await fireFinished();

      expect(client.startPreviewDetect).toHaveBeenCalledTimes(2);
      expect(client.startPreviewDetect).toHaveBeenLastCalledWith(10, 20, {
        ...LIVE_CONFIG,
        ...NEXT,
      });
      expect(result.current.status).toBe('running');
    });

    it('discards a superseded run that completed rather than painting it', async () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'running');
      const takePreviewResult = jest.fn((): PreviewResult | null => RESULT);
      const client = makeClient({ pollPreviewDetect, takePreviewResult });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.request(10, 20, NEXT);
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      pollPreviewDetect.mockReturnValue('complete');
      await fireFinished();

      expect(takePreviewResult).not.toHaveBeenCalled();
      expect(result.current.result).toBeNull();
      expect(client.startPreviewDetect).toHaveBeenCalledTimes(2);

      const second = { ...RESULT, config: NEXT };
      takePreviewResult.mockReturnValue(second);
      await fireFinished();

      expect(result.current.status).toBe('complete');
      expect(result.current.result).toBe(second);
    });

    it('asks the engine to cancel once however many values land while it winds down', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.request(10, 20, NEXT);
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      await act(() => {
        result.current.request(10, 20, LAST);
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);

      (client.pollPreviewDetect as jest.Mock).mockReturnValue('cancelled');
      await fireFinished();

      expect(client.startPreviewDetect).toHaveBeenCalledTimes(2);
      expect(client.startPreviewDetect).toHaveBeenLastCalledWith(10, 20, {
        ...LIVE_CONFIG,
        ...LAST,
      });
    });

    it('starts nothing after the athlete cancels, whether the request was waiting or queued', async () => {
      const client = makeClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.request(10, 20, NEXT);
      });
      await act(() => {
        result.current.cancel();
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      expect(client.startPreviewDetect).not.toHaveBeenCalled();

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.request(10, 20, NEXT);
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      await act(() => {
        result.current.cancel();
      });
      (client.pollPreviewDetect as jest.Mock).mockReturnValue('cancelled');
      await fireFinished();

      expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('cancelled');
    });

    it('drops a waiting request on reset and on unmount', async () => {
      const client = makeClient();
      const { result, unmount } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.request(10, 20, NEXT);
        result.current.reset();
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      expect(client.startPreviewDetect).not.toHaveBeenCalled();

      await act(() => {
        result.current.request(10, 20, NEXT);
      });
      await unmount();
      jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      expect(client.startPreviewDetect).not.toHaveBeenCalled();
    });

    it('reads no progress from a superseded run', async () => {
      const getPreviewProgress = jest.fn(() => ({
        phase: 'loading',
        completed: 3,
        total: 12,
        percent: 25,
      }));
      const client = makeClient({ getPreviewProgress });
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.request(10, 20, NEXT);
        jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      });
      await firePhase();

      expect(getPreviewProgress).not.toHaveBeenCalled();
      expect(result.current.progress).toBeNull();
    });
  });

  describe('a run left behind by reset or cancel', () => {
    const NEXT_CENTRE = { lat: 30, lng: 40 };

    /**
     * An engine whose one slot stays held until the worker announces the run's
     * end, so a start before then is refused as busy, as the engine does.
     */
    function makeSlotClient() {
      let held = false;
      let polled: PreviewPollStatus = 'idle';
      const client = makeClient({
        startPreviewDetect: jest.fn(() => {
          if (held) return StartOutcome.Busy;
          held = true;
          polled = 'running';
          return StartOutcome.Started;
        }),
        pollPreviewDetect: jest.fn(() => polled),
        takePreviewResult: jest.fn(() => RESULT),
      });
      const endRun = async (status: PreviewPollStatus) => {
        held = false;
        polled = status;
        await fireFinished();
      };
      return { client, endRun };
    }

    it('reset cancels the live run and a Preview tapped before it ends starts once it has', async () => {
      const { client, endRun } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.reset();
      });
      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('idle');

      await act(() => {
        result.current.start(NEXT_CENTRE.lat, NEXT_CENTRE.lng, PARAMS);
      });
      expect(result.current.refusal).toBeNull();

      await endRun('cancelled');

      expect(client.takePreviewResult).not.toHaveBeenCalled();
      expect(client.startPreviewDetect).toHaveBeenLastCalledWith(NEXT_CENTRE.lat, NEXT_CENTRE.lng, {
        ...LIVE_CONFIG,
        ...PARAMS,
      });
      expect(result.current.refusal).toBeNull();
      expect(result.current.status).toBe('running');

      await endRun('complete');
      expect(result.current.status).toBe('complete');
      expect(result.current.result).toEqual(RESULT);
    });

    it('does not paint a reset run that completes before its cancel is noticed', async () => {
      const { client, endRun } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.reset();
      });
      await endRun('complete');

      expect(client.takePreviewResult).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ status: 'idle', result: null, refusal: null });
      expect(finishListeners.size).toBe(0);
    });

    it('does not say a reset run is slow while it winds down', async () => {
      const { client } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.reset();
      });
      await act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS * 2);
      });

      expect(result.current.lapsed).toBe(false);
      expect(result.current.status).toBe('idle');
    });

    it('a Preview tapped after cancel, before the run ends, starts once it has', async () => {
      const { client, endRun } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.cancel();
      });
      expect(result.current.status).toBe('cancelled');

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      expect(result.current.refusal).toBeNull();
      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);

      await endRun('cancelled');

      expect(client.startPreviewDetect).toHaveBeenCalledTimes(2);
      expect(client.startPreviewDetect).toHaveBeenLastCalledWith(10, 20, {
        ...LIVE_CONFIG,
        ...PARAMS,
      });
      expect(result.current.refusal).toBeNull();
      expect(result.current.status).toBe('running');
    });

    it('starts nothing after a cancel that nothing follows, and stays cancelled', async () => {
      const { client, endRun } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.cancel();
      });
      await endRun('complete');

      expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
      expect(client.takePreviewResult).not.toHaveBeenCalled();
      expect(result.current.status).toBe('cancelled');
      expect(finishListeners.size).toBe(0);
    });

    it('a second cancel drops a queued Preview and asks the engine nothing more', async () => {
      const { client, endRun } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.reset();
      });
      await act(() => {
        result.current.start(NEXT_CENTRE.lat, NEXT_CENTRE.lng, PARAMS);
      });
      await act(() => {
        result.current.cancel();
      });
      await endRun('cancelled');

      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
      expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('cancelled');
    });

    it('runs the last of several Preview taps made while the run winds down', async () => {
      const { client, endRun } = makeSlotClient();
      const { result } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.reset();
      });
      await act(() => {
        result.current.start(1, 2, PARAMS);
      });
      await act(() => {
        result.current.start(NEXT_CENTRE.lat, NEXT_CENTRE.lng, PARAMS);
      });
      await endRun('cancelled');

      expect(client.startPreviewDetect).toHaveBeenCalledTimes(2);
      expect(client.startPreviewDetect).toHaveBeenLastCalledWith(NEXT_CENTRE.lat, NEXT_CENTRE.lng, {
        ...LIVE_CONFIG,
        ...PARAMS,
      });
    });

    it('unmount during the wind-down asks the engine nothing more and starts nothing', async () => {
      const { client, endRun } = makeSlotClient();
      const { result, unmount } = await renderHook(() => usePreviewDetect(client));

      await act(() => {
        result.current.start(10, 20, PARAMS);
      });
      await act(() => {
        result.current.reset();
      });
      await act(() => {
        result.current.start(NEXT_CENTRE.lat, NEXT_CENTRE.lng, PARAMS);
      });
      await unmount();
      expect(finishListeners.size).toBe(0);
      await endRun('cancelled');

      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
      expect(client.startPreviewDetect).toHaveBeenCalledTimes(1);
    });
  });
});
