/**
 * Scenario: the preview screen drives one sandboxed detection run. The hook
 * must merge only the five staged sliders over the live config, follow the
 * engine's poll states on a 500 ms cadence, take the result exactly once,
 * and read a refused start as suspension rather than failure.
 */

import { act, renderHook } from '@testing-library/react-native';
import { usePreviewDetect } from '@/features/routes/hooks/usePreviewDetect';
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
  clusterTolerance: 50,
  samplePoints: 60,
  detectionMode: 'unified',
  includePotentials: false,
  preserveHierarchy: false,
  jaccardThreshold: 0.4,
  minRoutes: 2,
  enableDensitySplits: false,
  mergeDistanceMultiplier: 1.5,
  minCellVisits: 30,
  divergenceThreshold: 0.2,
  minCorridorTracks: 3,
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

function makeClient(over: Partial<PreviewClient> = {}) {
  return {
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

  it('polls on a 500 ms cadence and surfaces progress with a display name', () => {
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
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toMatchObject({
      phase: 'loading',
      displayName: 'Loading tracks',
      completed: 3,
      total: 12,
      percent: 25,
    });
  });

  it('takes the result exactly once on completion and stops polling', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'complete'),
      takePreviewResult: jest.fn(() => RESULT),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
      jest.advanceTimersByTime(500);
    });

    expect(result.current.status).toBe('complete');
    expect(result.current.result).toEqual(RESULT);
    expect(client.takePreviewResult).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
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

  it('surfaces an engine error and stops polling', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'error'),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
      jest.advanceTimersByTime(500);
    });

    expect(result.current.status).toBe('error');
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).toHaveBeenCalledTimes(1);
  });

  it('reads idle mid-run as an error, never a clean finish', () => {
    const client = makeClient({
      pollPreviewDetect: jest.fn((): PreviewPollStatus => 'idle'),
    });
    const { result } = renderHook(() => usePreviewDetect(client));

    act(() => {
      result.current.start(10, 20, PARAMS);
      jest.advanceTimersByTime(500);
    });

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

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(client.pollPreviewDetect).not.toHaveBeenCalled();
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
      jest.advanceTimersByTime(500);
    });
    expect(result.current.result).toEqual(RESULT);

    act(() => {
      result.current.reset();
    });
    expect(result.current).toMatchObject({ status: 'idle', result: null, progress: null });
  });
});
