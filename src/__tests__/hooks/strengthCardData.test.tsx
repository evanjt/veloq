/**
 * Scenario: the feed's highlights read hands over one row per strength
 * activity it holds.
 *
 * Expected behaviour: the rows with active sets become cards, a download still
 * owed is asked for once per activity, a reconnect asks again, and a re-read
 * that changes one activity leaves the other cards as the same objects.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useStrengthCardData } from '@/features/strength/hooks/useExerciseSets';
import { useAuthStore } from '@/shared/app/AuthStore';

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline }),
  useIsOnline: () => mockIsOnline,
}));

const mockFetch = jest.fn();
const mockSeed = jest.fn();
const mockEngine = {
  fetchAndParseExerciseSets: (...args: unknown[]) => mockFetch(...args),
  bulkInsertExerciseSets: (...args: unknown[]) => mockSeed(...args),
  subscribe: () => () => {},
};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

type Rows = Parameters<typeof useStrengthCardData>[0];

function row(activityId: string, over: Record<string, unknown> = {}) {
  return {
    activityId,
    settled: true,
    activeSetCount: 4,
    exerciseCount: 2,
    totalVolumeKg: 1200,
    muscles: [{ slug: 'chest', intensity: 2 }],
    ...over,
  };
}

const owed = (activityId: string) =>
  row(activityId, { settled: false, activeSetCount: 0, muscles: [] });

const render = (rows: unknown[]) =>
  renderHook(({ current }: { current: Rows }) => useStrengthCardData(current), {
    initialProps: { current: rows as Rows },
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline = true;
  useAuthStore.setState({ isDemoMode: false });
});

describe('useStrengthCardData', () => {
  it('turns a row with active sets into what the card paints', async () => {
    const { result } = await render([row('s1')]);

    expect(result.current.get('s1')).toEqual({
      muscles: [{ slug: 'chest', intensity: 2 }],
      exerciseCount: 2,
      setCount: 4,
      totalWeight: 1200,
    });
  });

  it('gives no entry to an activity without active sets, and asks for nothing settled', async () => {
    const { result } = await render([row('s1', { activeSetCount: 0, muscles: [] })]);

    expect(result.current.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('holds nothing for a feed with no strength activity', async () => {
    const { result } = await render([]);

    expect(result.current.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('asks once for a download that is still owed, however often the rows arrive', async () => {
    const { rerender } = await render([row('s1'), owed('s2')]);
    await rerender({ current: [row('s1'), owed('s2')] as Rows });
    await rerender({ current: [row('s1'), owed('s2')] as Rows });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('s2');
  });

  it('draws the card once the parse lands in the next rows', async () => {
    const { result, rerender } = await render([owed('s1')]);
    expect(result.current.size).toBe(0);

    await rerender({ current: [row('s1')] as Rows });

    expect(result.current.get('s1')?.setCount).toBe(4);
  });

  it('asks again for a download a dead connection lost, once the radio is back', async () => {
    mockIsOnline = false;
    const rows = [owed('s1')] as Rows;
    const { rerender } = await render(rows);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockIsOnline = true;
    await act(() => rerender({ current: rows }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a settled card as the same object when another activity parses', async () => {
    const { result, rerender } = await render([row('s1'), owed('s2')]);
    const before = result.current.get('s1');

    await rerender({ current: [row('s1'), row('s2')] as Rows });

    expect(result.current.get('s1')).toBe(before);
    expect(result.current.has('s2')).toBe(true);
  });

  it('replaces the card whose content moved', async () => {
    const { result, rerender } = await render([row('s1')]);
    const before = result.current.get('s1');

    await rerender({ current: [row('s1', { activeSetCount: 5 })] as Rows });

    expect(result.current.get('s1')).not.toBe(before);
    expect(result.current.get('s1')?.setCount).toBe(5);
  });

  it('seeds a demo activity instead of downloading it', async () => {
    useAuthStore.setState({ isDemoMode: true });
    await render([owed('demo-test-6')]);

    expect(mockSeed).toHaveBeenCalledTimes(1);
    expect(mockSeed.mock.calls[0][0]).toBe('demo-test-6');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
