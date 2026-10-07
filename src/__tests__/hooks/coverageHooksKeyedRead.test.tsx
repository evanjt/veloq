/**
 * Scenario: the two coverage hooks were written with the superseded shape, a
 * subscription counter listed as a dependency the body never reads, each with
 * its own `exhaustive-deps` disable. Doing what the rule says would remove the
 * key and freeze the read at mount, which is why the disable was there.
 *
 * Expected behaviour: both read through `useEngineRead`, so the dependency is
 * a reader the body calls, the disable is gone, and the read still re-runs when
 * an `activities` announcement lands.
 */

import { act, renderHook } from '@testing-library/react-native';
import { RangeCoverage } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useLibraryCoverage } from '@/shared/native/useLibraryCoverage';
import { useRangeCoverage } from '@/shared/native/useRangeCoverage';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const listeners: Record<string, (() => void)[]> = {};

const mockEngine = {
  subscribe: (event: string, cb: () => void) => {
    (listeners[event] ||= []).push(cb);
    return () => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
    };
  },
  rangeCoverage: jest.fn(),
  libraryCoverage: jest.fn(),
};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function announce(event: string): void {
  act(() => {
    for (const cb of listeners[event] ?? []) cb();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(listeners)) delete listeners[key];
  mockGetEngine.mockReturnValue(mockEngine as unknown as ReturnType<typeof getEngine>);
  mockEngine.rangeCoverage.mockReturnValue(RangeCoverage.NotFetched);
  mockEngine.libraryCoverage.mockReturnValue({
    upstream: 10,
    fetched: 2,
    tracksUpstream: 8,
    tracksStored: 1,
  });
});

describe('the coverage hooks', () => {
  it('re-reads the range when an activities announcement lands', () => {
    const { result } = renderHook(() => useRangeCoverage(42));
    expect(result.current).toBe(RangeCoverage.NotFetched);

    mockEngine.rangeCoverage.mockReturnValue(RangeCoverage.Loaded);
    announce('activities');

    expect(result.current).toBe(RangeCoverage.Loaded);
  });

  it('re-reads the library when an activities announcement lands', () => {
    const { result } = renderHook(() => useLibraryCoverage());
    expect(result.current?.fetched).toBe(2);

    mockEngine.libraryCoverage.mockReturnValue({
      upstream: 10,
      fetched: 10,
      tracksUpstream: 8,
      tracksStored: 8,
    });
    announce('activities');

    expect(result.current?.fetched).toBe(10);
  });

  it('re-reads the library when a track lands during a bulk pass', () => {
    const { result } = renderHook(() => useLibraryCoverage());
    expect(result.current?.tracksStored).toBe(1);

    mockEngine.libraryCoverage.mockReturnValue({
      upstream: 10,
      fetched: 2,
      tracksUpstream: 8,
      tracksStored: 2,
    });
    announce('gpsTrackStored');

    expect(result.current?.tracksStored).toBe(2);
  });

  /** A read that is switched off claims nothing, and asks the engine nothing. */
  it('asks the engine nothing when the range read is disabled', () => {
    const { result } = renderHook(() => useRangeCoverage(42, false));

    expect(result.current).toBe(RangeCoverage.NotFetched);
    expect(mockEngine.rangeCoverage).not.toHaveBeenCalled();
  });

  /** A census never pulled answers zeros, and the library reports nothing. */
  it('reports nothing for a library the engine answers zeros for', () => {
    mockEngine.libraryCoverage.mockReturnValue({
      upstream: 0,
      fetched: 0,
      tracksUpstream: 0,
      tracksStored: 0,
    });

    const { result } = renderHook(() => useLibraryCoverage());

    expect(result.current).toBeNull();
  });
});
