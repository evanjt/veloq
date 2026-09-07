/**
 * Scenario: the preview screen drives one sandboxed detection run. The hook
 * must merge only the five staged sliders over the live config, read progress
 * when the engine announces a phase rather than on a timer, settle on the
 * engine's finish event rather than on a status poll, take the result exactly
 * once, and read a refused start as suspension rather than failure.
 */

import { act, renderHook } from '@testing-library/react-native';
import {
  PREVIEW_LAPSE_AFTER_MS,
  PREVIEW_POLL_INTERVAL_MS,
  PREVIEW_TIMEOUT_MS,
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

function fireFinished() {
  act(() => {
    [...finishListeners].forEach((cb) => cb());
  });
}

function firePhase() {
  act(() => {
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
    startPreviewDetect: jest.fn(() => true),
    pollPreviewDetect: jest.fn((): PreviewPollStatus => 'running'),
    getPreviewProgress: jest.fn(() => null),
    takePreviewResult: jest.fn((): PreviewResult | null => null),
    cancelPreviewDetect: jest.fn(),
    getSectionConfig: jest.fn((): FfiSectionConfig | null => ({ ...LIVE_CONFIG })),
    setSectionConfig: jest.fn(),
    forceRedetectSections: jest.fn(() => true),
    ...over,
  };
}

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

  it('merges only the staged params over the live config', () => {
    const client = makeClient();
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });

    expect(client.startPreviewDetect).toHaveBeenCalledWith(10, 20, {
      ...LIVE_CONFIG,
      ...PARAMS,
    });
    expect(result.current.status).toBe('running');
  });

  it('reads progress when a phase is announced and surfaces a display name', () => {
    const client = makeClient({
      getPreviewProgress: jest.fn(() => ({
        phase: 'loading',
        completed: 3,
        total: 12,
        percent: 25,
      })),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    expect(client.subscribe).toHaveBeenCalledWith('previewPhase', expect.any(Function));
    expect(client.getPreviewProgress).not.toHaveBeenCalled();

    firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toMatchObject({
      phase: 'loading',
      displayName: 'Loading tracks',
      completed: 3,
      total: 12,
      percent: 25,
    });

    firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(2);
  });

  it('arms no timer, so a long run costs one read per announced phase', () => {
    const client = makeClient({
      getPreviewProgress: jest.fn(() => ({
        phase: 'analyzing',
        completed: 0,
        total: 40,
        percent: 5,
      })),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    act(() => {
      jest.advanceTimersByTime(600000);
    });

    expect(client.getPreviewProgress).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops reading phases once the run settles', () => {
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
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(1);

    fireFinished();
    expect(result.current.status).toBe('complete');
    expect(phaseListeners.size).toBe(0);

    firePhase();
    expect(client.getPreviewProgress).toHaveBeenCalledTimes(1);
  });

  it('reads nothing at all between the start and the finish event', () => {
    const client = makeClient();
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    act(() => {
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

  it('leaves the run live when the engine still reads running at the notice', () => {
    const poll = jest.fn((): PreviewPollStatus => 'running');
    const client = makeClient({ pollPreviewDetect: poll });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.status).toBe('running');
    expect(detaches).toBe(0);

    poll.mockReturnValue('complete');
    fireFinished();

    expect(result.current.status).toBe('complete');
    expect(poll).toHaveBeenCalledTimes(2);
    expect(detaches).toBe(2);
  });

  it('subscribes afresh for a second run', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();
    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(client.subscribe).toHaveBeenCalledTimes(4);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(2);
    expect(finishListeners.size).toBe(0);
    expect(phaseListeners.size).toBe(0);
    expect(detaches).toBe(4);
  });

  it('takes the result exactly once on the finish event and stops', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.status).toBe('complete');
    expect(result.current.result).toEqual(RESULT);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(1);
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);

    fireFinished();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(1);
    expect(client.getPreviewProgress).not.toHaveBeenCalled();
    expect(detaches).toBe(2);
  });

  it('reads a refused start as suspension, not failure', () => {
    const client = makeClient({ startPreviewDetect: jest.fn(() => false) });
    const { result } = renderHook(() => usePreviewDetect(client));

    let started = true;
    act(() => {
      started = result.current.start(10, 20, PARAMS);
    });

    expect(started).toBe(false);
    expect(result.current.suspended).toBe(true);
    expect(result.current.status).toBe('idle');
  });

  it('surfaces an engine error and stops', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'error'),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.status).toBe('error');
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
  });

  it('surfaces a refused pool from the finish event', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'pool_unusable'),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.status).toBe('pool_unusable');
    expect(result.current.progress).toBeNull();
  });

  it('reads idle mid-run as an error, never a clean finish', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'idle'),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.status).toBe('error');
    expect(result.current.result).toBeNull();
  });

  it('cancel tells the engine and lands in cancelled', () => {
    const client = makeClient();
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    act(() => {
      result.current.cancel();
    });

    expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('cancelled');

    // The worker still announces the run it was told to abandon.
    fireFinished();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();
    expect(result.current.status).toBe('cancelled');
    expect(detaches).toBe(2);
  });

  it('fails the start when no live config exists', () => {
    const client = makeClient({ getSectionConfig: jest.fn(() => null) });
    const { result } = renderHook(() => usePreviewDetect(client));

    let started = true;
    act(() => {
      started = result.current.start(10, 20, PARAMS);
    });

    expect(started).toBe(false);
    expect(client.startPreviewDetect).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
  });

  it('cancels a live run on unmount', () => {
    const client = makeClient();
    const { result, unmount } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    unmount();

    expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    expect(detaches).toBe(2);
    fireFinished();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();
  });

  it('reset clears the previous result and state', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();
    expect(result.current.result).toEqual(RESULT);

    act(() => {
      result.current.reset();
    });
    expect(result.current).toMatchObject({ status: 'idle', result: null, progress: null });
    expect(finishListeners.size).toBe(0);

    fireFinished();
    expect(result.current.status).toBe('idle');
  });

  it('keeps the finished diff on screen while the next run computes', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();
    expect(result.current.result).toEqual(RESULT);

    act(() => {
      result.current.start(10, 20, PARAMS);
    });

    expect(result.current.status).toBe('running');
    expect(result.current.result).toEqual(RESULT);
  });

  it('swaps the held result for the new one when the run settles', () => {
    const second: PreviewResult = { ...RESULT, elapsedMs: 999 };
    const takePreviewResult = jest.fn(() => RESULT);
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult,
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    takePreviewResult.mockReturnValue(second);
    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.result).toEqual(second);
  });

  it('leaves the last diff standing when a run is cancelled', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    act(() => {
      result.current.cancel();
    });

    expect(result.current.status).toBe('cancelled');
    expect(result.current.result).toEqual(RESULT);
  });

  it('leaves the last diff standing when a run fails', () => {
    const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'complete');
    const client = makeClient({
      takePreviewResult: jest.fn(() => RESULT),
      pollPreviewDetect,
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    pollPreviewDetect.mockReturnValue('error');
    act(() => {
      result.current.start(10, 20, PARAMS);
    });
    fireFinished();

    expect(result.current.status).toBe('error');
    expect(result.current.result).toEqual(RESULT);
  });

  // Scenario: the run's end arrives on an event and nothing else. A dropped
  // event, an observer that was never registered, or an engine that never
  // finishes all leave the same spinner, so the run carries its own budgets.
  describe('when the finish event never arrives', () => {
    it('settles from the poll when the event is lost', () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'running');
      const client = makeClient({
        pollPreviewDetect,
        takePreviewResult: jest.fn(() => RESULT),
      });
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS);
      });
      pollPreviewDetect.mockReturnValue('complete');
      act(() => {
        jest.advanceTimersByTime(PREVIEW_POLL_INTERVAL_MS);
      });

      expect(result.current.status).toBe('complete');
      expect(result.current.result).toEqual(RESULT);
    });

    it('leaves the run live while the poll still reads running', () => {
      const client = makeClient();
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS + PREVIEW_POLL_INTERVAL_MS * 5);
      });

      expect(result.current.status).toBe('running');
      expect(client.takePreviewResult).not.toHaveBeenCalled();
    });

    it('reads nothing at all before the lapse budget passes', () => {
      const client = makeClient();
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS - 1);
      });

      expect(client.pollPreviewDetect).not.toHaveBeenCalled();
      expect(result.current.status).toBe('running');
    });

    it('says the run is slow once its lapse budget passes, and keeps following', () => {
      const client = makeClient();
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      expect(result.current.lapsed).toBe(false);

      act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS);
      });

      expect(result.current.lapsed).toBe(true);
      expect(result.current.status).toBe('running');
    });

    it('gives up at the timeout, and cancels the run it stopped following', () => {
      const client = makeClient();
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_TIMEOUT_MS);
      });

      expect(result.current.status).toBe('error');
      expect(result.current.progress).toBeNull();
      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    });

    it('takes the poll answer at the timeout when the run had in fact ended', () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'running');
      const client = makeClient({
        pollPreviewDetect,
        takePreviewResult: jest.fn(() => RESULT),
      });
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      pollPreviewDetect.mockReturnValue('complete');
      act(() => {
        jest.advanceTimersByTime(PREVIEW_TIMEOUT_MS);
      });

      expect(result.current.status).toBe('complete');
      expect(client.cancelPreviewDetect).not.toHaveBeenCalled();
    });
  });

  // A settled run owns no timers. A budget that outlives its run would
  // overwrite the answer the user is already looking at.
  describe('budgets end with the run', () => {
    it('drops them when the finish event settles the run', () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'complete');
      const client = makeClient({
        pollPreviewDetect,
        takePreviewResult: jest.fn(() => RESULT),
      });
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      fireFinished();
      expect(result.current.status).toBe('complete');

      act(() => {
        jest.advanceTimersByTime(PREVIEW_TIMEOUT_MS * 2);
      });

      expect(result.current.status).toBe('complete');
      expect(result.current.lapsed).toBe(false);
      expect(client.cancelPreviewDetect).not.toHaveBeenCalled();
      expect(client.takePreviewResult).toHaveBeenCalledTimes(1);
    });

    it('drops them when the user cancels', () => {
      const client = makeClient();
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        result.current.cancel();
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_TIMEOUT_MS * 2);
      });

      expect(result.current.status).toBe('cancelled');
      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
    });

    it('drops them when the hook unmounts', () => {
      const client = makeClient();
      const { result, unmount } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      unmount();
      act(() => {
        jest.advanceTimersByTime(PREVIEW_TIMEOUT_MS * 2);
      });

      expect(client.cancelPreviewDetect).toHaveBeenCalledTimes(1);
      expect(client.pollPreviewDetect).not.toHaveBeenCalled();
    });

    it('clears the lapse when the run is reset', () => {
      const client = makeClient();
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS);
      });
      expect(result.current.lapsed).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.lapsed).toBe(false);
    });

    it('starts the budgets of a second run from zero', () => {
      const pollPreviewDetect = jest.fn((): PreviewPollStatus => 'complete');
      const client = makeClient({ pollPreviewDetect });
      const { result } = renderHook(() => usePreviewDetect(client));

      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      fireFinished();

      pollPreviewDetect.mockReturnValue('running');
      act(() => {
        result.current.start(10, 20, PARAMS);
      });
      act(() => {
        jest.advanceTimersByTime(PREVIEW_LAPSE_AFTER_MS - 1);
      });
      expect(result.current.lapsed).toBe(false);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(result.current.lapsed).toBe(true);
    });
  });
});
