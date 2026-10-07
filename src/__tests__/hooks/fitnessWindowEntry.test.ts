/**
 * Scenario: the Fitness tab has been opened once and stays mounted. An HRV
 * card's View in detail sends `range=1m&date=…`, and the tab stayed on
 * whatever range it was left on with no day selected, because the params only
 * seeded its first render. On a cold start the range applied and the day was
 * cleared the moment the params were, because clearing them re-ran the reset.
 *
 * Expected behaviour: an entry applies its range and day whenever it arrives,
 * mounted or cold, and clearing the params afterwards leaves them in place. A
 * range the athlete picks still drops the day pinned in the old one.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useFitnessWindow } from '@/features/fitness/hooks/useFitnessWindow';
import type { FitnessEntry } from '@/shared/app/fitnessEntry';

const NONE: FitnessEntry = { range: null, date: null };
const HRV: FitnessEntry = { range: '1m', date: '2026-09-10' };

/** The screen as the router drives it: params in, cleared once consumed. */
function mountWith(initial: FitnessEntry) {
  let params = initial;
  const clearEntry = jest.fn(() => {
    params = NONE;
  });
  const hook = renderHook(
    ({ entry }: { entry: FitnessEntry }) => useFitnessWindow(entry, clearEntry),
    { initialProps: { entry: params } }
  );
  const settle = () => {
    for (let i = 0; i < 3; i += 1) hook.rerender({ entry: params });
  };
  const navigate = (entry: FitnessEntry) => {
    params = entry;
    settle();
  };
  settle();
  return { hook, navigate, clearEntry };
}

describe('the fitness window an insight opens', () => {
  it('keeps the day selected on a cold start once the params clear', () => {
    const { hook, clearEntry } = mountWith(HRV);

    expect(clearEntry).toHaveBeenCalled();
    expect(hook.result.current.timeRange).toBe('1m');
    expect(hook.result.current.selectedDate).toBe('2026-09-10');
  });

  it('applies the range and day to a screen that is already mounted', () => {
    const { hook, navigate } = mountWith(NONE);
    expect(hook.result.current.timeRange).toBe('6m');

    navigate(HRV);

    expect(hook.result.current.timeRange).toBe('1m');
    expect(hook.result.current.selectedDate).toBe('2026-09-10');
  });

  it('applies a second entry over the first', () => {
    const { hook, navigate } = mountWith(HRV);

    navigate({ range: '3m', date: '2026-08-01' });

    expect(hook.result.current.timeRange).toBe('3m');
    expect(hook.result.current.selectedDate).toBe('2026-08-01');
  });

  it('drops a pinned day when the entry names only a range', () => {
    const { hook, navigate } = mountWith(HRV);

    navigate({ range: '3m', date: null });

    expect(hook.result.current.timeRange).toBe('3m');
    expect(hook.result.current.selectedDate).toBeNull();
  });

  it('drops the pinned day when the athlete picks another range', () => {
    const { hook } = mountWith(HRV);

    act(() => hook.result.current.changeTimeRange('1y'));

    expect(hook.result.current.timeRange).toBe('1y');
    expect(hook.result.current.selectedDate).toBeNull();
  });
});
