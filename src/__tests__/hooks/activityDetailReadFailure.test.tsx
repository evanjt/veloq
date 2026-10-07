/**
 * Scenario: the engine throws while reading the activity detail bundle.
 *
 * Expected behaviour: the hook hands the thrown error back beside a null
 * bundle, so the screen can say the read failed instead of drawing an empty
 * library. A refresh that succeeds clears it, and one that fails after a good
 * read keeps the bundle and reports the error.
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  prefetchActivityDetailData,
  useActivityDetailData,
} from '@/features/activity/hooks/useActivityDetailData';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

type Listener = (payload?: unknown) => void;

const bundle = {
  activityCount: 1,
  sectionCount: 2,
  routeGroups: [],
  matchedSections: [],
  customSections: [],
  encounters: [],
  highlights: { indicators: [], routeHighlights: [] },
  sectionTraces: [],
  prSectionIds: [],
  maxHr: 180,
  hrZones: [],
};

const lockFailed = { tag: 'Database' };

function engineWith(read: jest.Mock) {
  const listeners: Record<string, Set<Listener>> = {};
  const engine = {
    subscribe: (event: string, listener: Listener) => {
      (listeners[event] ??= new Set()).add(listener);
      return () => listeners[event]?.delete(listener);
    },
    getActivityDetailData: read,
  };
  const emit = (event: string, payload?: unknown) =>
    act(() => listeners[event]?.forEach((listener) => listener(payload)));
  return { engine, emit };
}

afterEach(() => mockGetEngine.mockReset());

it('returns the thrown error with no bundle', () => {
  const { engine } = engineWith(
    jest.fn(() => {
      throw lockFailed;
    })
  );
  mockGetEngine.mockReturnValue(engine);

  const { result } = renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data).toBeNull();
  expect(result.current.error).toBe(lockFailed);
});

it('reports no error when the bundle reads', () => {
  const { engine } = engineWith(jest.fn(() => bundle));
  mockGetEngine.mockReturnValue(engine);

  const { result } = renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data?.sectionCount).toBe(2);
  expect(result.current.error).toBeUndefined();
});

it('reports no error for a missing engine or activity', () => {
  mockGetEngine.mockReturnValue(null);
  const { result } = renderHook(() => useActivityDetailData('a1'));
  expect(result.current.data).toBeNull();
  expect(result.current.error).toBeUndefined();
});

it('clears the error when a retry reads', () => {
  const read = jest
    .fn()
    .mockImplementationOnce(() => {
      throw lockFailed;
    })
    .mockImplementation(() => bundle);
  const { engine } = engineWith(read);
  mockGetEngine.mockReturnValue(engine);

  const { result } = renderHook(() => useActivityDetailData('a1'));
  expect(result.current.error).toBe(lockFailed);

  act(() => result.current.refresh());

  expect(result.current.error).toBeUndefined();
  expect(result.current.data?.sectionCount).toBe(2);
});

it('keeps the bundle and reports the error when a refresh throws', () => {
  const read = jest
    .fn()
    .mockImplementationOnce(() => bundle)
    .mockImplementation(() => {
      throw lockFailed;
    });
  const { engine } = engineWith(read);
  mockGetEngine.mockReturnValue(engine);

  const { result } = renderHook(() => useActivityDetailData('a1'));
  act(() => result.current.refresh());

  expect(result.current.data?.sectionCount).toBe(2);
  expect(result.current.error).toBe(lockFailed);
});

it('does not prefetch a throwing read', () => {
  const read = jest.fn(() => {
    throw lockFailed;
  });
  const { engine } = engineWith(read);
  mockGetEngine.mockReturnValue(engine);

  expect(() => prefetchActivityDetailData('a1')).not.toThrow();
});
