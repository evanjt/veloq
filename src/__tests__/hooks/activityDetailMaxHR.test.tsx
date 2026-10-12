/**
 * Scenario: the heart rate stat card and the zones chart divide by one max HR,
 * which TypeScript resolved from the activity's zones, the sport settings and
 * the local store. The activity detail screen read answers it now, so the
 * screen has to take it from there and re-read it when the detail body, which
 * carries the activity's own zones, lands after the screen opened.
 */

import { act, renderHook } from '@testing-library/react-native';

import { MaxHrSource } from 'veloqrs';
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

function engineAnswering(maxHr: () => number) {
  const listeners: Record<string, Set<Listener>> = {};
  const getActivityDetailData = jest.fn(() => ({
    activityCount: 1,
    sectionCount: 0,
    routeGroups: [],
    matchedSections: [],
    customSections: [],
    encounters: [],
    highlights: { indicators: [], routeHighlights: [], newGround: [], strengthCards: [] },
    sectionTraces: [],
    prSectionIds: [],
    maxHr: maxHr(),
    maxHrSource: MaxHrSource.SportSettings,
    hrZones: [],
    ledgerChanges: [{ eventId: 7, sectionId: 's1', relation: 'around' }],
  }));
  const engine = {
    subscribe: (event: string, listener: Listener) => {
      (listeners[event] ??= new Set()).add(listener);
      return () => listeners[event]?.delete(listener);
    },
    getActivityDetailData,
  };
  const emit = (event: string, payload?: unknown) =>
    act(() => listeners[event]?.forEach((listener) => listener(payload)));
  return { engine, emit, getActivityDetailData };
}

afterEach(() => mockGetEngine.mockReset());

it('carries the max HR the engine resolved and where it came from', async () => {
  const { engine } = engineAnswering(() => 185);
  mockGetEngine.mockReturnValue(engine);

  const { result } = await renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data?.maxHR).toBe(185);
  expect(result.current.data?.maxHrSource).toBe(MaxHrSource.SportSettings);
});

it('carries the section changes whose ledger rows name the activity', async () => {
  const { engine } = engineAnswering(() => 185);
  mockGetEngine.mockReturnValue(engine);

  const { result } = await renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data?.ledgerChanges.map((c) => c.eventId)).toEqual([7]);
});

it('re-reads when the detail body for this activity lands', async () => {
  let maxHr = 185;
  const { engine, emit } = engineAnswering(() => maxHr);
  mockGetEngine.mockReturnValue(engine);
  const { result } = await renderHook(() => useActivityDetailData('a1'));
  expect(result.current.data?.maxHR).toBe(185);

  // The detail body carries the activity's zones, topping out at 196.
  maxHr = 196;
  await emit('bodyStored', { kind: 'activity_detail', activityId: 'a1' });

  expect(result.current.data?.maxHR).toBe(196);
});

it('does not re-read for another activity or another kind of body', async () => {
  const { engine, emit, getActivityDetailData } = engineAnswering(() => 185);
  mockGetEngine.mockReturnValue(engine);
  await renderHook(() => useActivityDetailData('a1'));
  const reads = getActivityDetailData.mock.calls.length;

  await emit('bodyStored', { kind: 'activity_detail', activityId: 'a2' });
  await emit('bodyStored', { kind: 'power_curve', activityId: 'a1' });

  expect(getActivityDetailData.mock.calls.length).toBe(reads);
});

it('drops a bundle read on the tap when the detail body lands before the screen mounts', async () => {
  let maxHr = 185;
  const { engine, emit } = engineAnswering(() => maxHr);
  mockGetEngine.mockReturnValue(engine);

  prefetchActivityDetailData('a1');
  maxHr = 196;
  await emit('bodyStored', { kind: 'activity_detail', activityId: 'a1' });
  const { result } = await renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data?.maxHR).toBe(196);
});

describe('stream arrival', () => {
  const streamAnnouncements: [string, string, (id: string) => unknown][] = [
    ['bodyStored', 'streams body', (id) => ({ kind: 'streams', activityId: id })],
    ['timeStreamsStored', 'time stream', (id) => ({ activityIds: [id] })],
  ];

  it.each(streamAnnouncements)(
    'a mounted screen re-reads when %s announces this activity (%s)',
    async (event, _label, payload) => {
      let maxHr = 0;
      const { engine, emit } = engineAnswering(() => maxHr);
      mockGetEngine.mockReturnValue(engine);
      const { result } = await renderHook(() => useActivityDetailData('a1'));
      expect(result.current.data?.maxHR).toBe(0);

      maxHr = 196;
      await emit(event, payload('a1'));

      expect(result.current.data?.maxHR).toBe(196);
    }
  );

  it.each(streamAnnouncements)(
    'a bundle read on the tap is dropped when %s announces this activity (%s)',
    async (event, _label, payload) => {
      let maxHr = 0;
      const { engine, emit } = engineAnswering(() => maxHr);
      mockGetEngine.mockReturnValue(engine);

      prefetchActivityDetailData('a1');
      maxHr = 196;
      await emit(event, payload('a1'));
      const { result } = await renderHook(() => useActivityDetailData('a1'));

      expect(result.current.data?.maxHR).toBe(196);
    }
  );

  it.each(streamAnnouncements)(
    'ignores %s for another activity (%s)',
    async (event, _label, payload) => {
      const { engine, emit, getActivityDetailData } = engineAnswering(() => 185);
      mockGetEngine.mockReturnValue(engine);
      await renderHook(() => useActivityDetailData('a1'));
      const reads = getActivityDetailData.mock.calls.length;

      await emit(event, payload('a2'));

      expect(getActivityDetailData.mock.calls.length).toBe(reads);
    }
  );
});
