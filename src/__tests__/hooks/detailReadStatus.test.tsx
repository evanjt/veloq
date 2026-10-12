/**
 * Scenario: the section or route detail read throws, the engine is closed, or the record
 * does not exist.
 *
 * Expected behaviour: each hook reports which of the three happened, so the screen shows
 * a failure state for a throw and the not-found text only for a missing record.
 */

import { renderHook } from '@testing-library/react-native';

import { useSectionDetailData } from '@/features/routes/hooks/useSectionDetailData';
import { useRouteDetailData } from '@/features/routes/hooks/useRouteDetailData';
import type { SectionDetailData } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

const failure = Object.assign(new Error('reader pool'), { tag: 'Database' });

describe('section detail read status', () => {
  afterEach(() => mockGetEngine.mockReset());

  it('reports a thrown read as failed and keeps the error', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => {
        throw failure;
      },
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.data).toBeNull();
    expect(result.current.status).toEqual({ kind: 'failed', error: failure });
  });

  it('reports a closed engine as closed', async () => {
    mockGetEngine.mockReturnValue(null);
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.status).toEqual({ kind: 'closed' });
  });

  it('reports a delegate answering undefined as closed', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => undefined,
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.status).toEqual({ kind: 'closed' });
  });

  it('reports a bundle with no section as missing', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => ({ activityCount: 0, section: undefined }),
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.status).toEqual({ kind: 'missing' });
  });

  it('carries the ledger departure of a missing section', async () => {
    const retirement = { kind: 'merged', at: '2026-08-01', into: 's2', intoName: 'Hill' };
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => ({ activityCount: 0, section: undefined, retirement }),
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.status).toEqual({ kind: 'missing' });
    expect(result.current.retirement).toEqual(retirement);
  });

  it('carries no departure for a missing section the ledger never saw', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => ({ activityCount: 0, section: undefined }),
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.retirement).toBeNull();
  });

  it('reports a found section as ok', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => ({ activityCount: 3, section: { id: 's1' } }),
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.status).toEqual({ kind: 'ok' });
    expect(result.current.data?.activityCount).toBe(3);
  });

  it('passes activity rows through with the engine speed and start time unchanged', async () => {
    const row = {
      activityId: 'ride-1',
      name: 'Morning ride',
      sportType: 'Ride',
      startTime: 1_700_000_000,
      distance: 1000,
      movingTime: 300,
      averageSpeed: 1000 / 300,
    };
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => ({
        activityCount: 1,
        section: { id: 's1' },
        activityRows: [row],
        mapSignatures: [],
      }),
    });

    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.data?.activityRows?.[0]).toBe(row);
  });

  it('does not read an unused nearby bundle', async () => {
    const shapeHasNoNearby: 'nearby' extends keyof SectionDetailData ? false : true = true;
    const nearby = jest.fn(() => {
      throw new Error('nearby geometry was decoded');
    });
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getSectionDetailData: () => ({
        activityCount: 3,
        section: { id: 's1' },
        get nearby() {
          return nearby();
        },
      }),
    });
    const { result } = await renderHook(() => useSectionDetailData('s1', 0));
    expect(result.current.status).toEqual({ kind: 'ok' });
    expect(nearby).not.toHaveBeenCalled();
    expect(shapeHasNoNearby).toBe(true);
  });
});

describe('route detail read status', () => {
  afterEach(() => mockGetEngine.mockReset());

  it('reports a thrown read as failed and keeps the error', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getRouteDetailData: () => {
        throw failure;
      },
    });
    const { result } = await renderHook(() => useRouteDetailData('g1', undefined));
    expect(result.current.data).toBeNull();
    expect(result.current.status).toEqual({ kind: 'failed', error: failure });
  });

  it('reports a closed engine as closed', async () => {
    mockGetEngine.mockReturnValue(null);
    const { result } = await renderHook(() => useRouteDetailData('g1', undefined));
    expect(result.current.status).toEqual({ kind: 'closed' });
  });

  it('reports a bundle with no group as missing', async () => {
    mockGetEngine.mockReturnValue({
      subscribe: () => () => {},
      getRouteDetailData: () => ({ activityCount: 0, group: undefined }),
    });
    const { result } = await renderHook(() => useRouteDetailData('g1', undefined));
    expect(result.current.status).toEqual({ kind: 'missing' });
  });
});
