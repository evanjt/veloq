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
async function mountWith(initial: FitnessEntry) {
  let params = initial;
  const clearEntry = jest.fn(() => {
    params = NONE;
  });
  const hook = await renderHook(
    ({ entry }: { entry: FitnessEntry }) => useFitnessWindow(entry, clearEntry),
    { initialProps: { entry: params } }
  );
  const settle = async () => {
    for (let i = 0; i < 3; i += 1) await hook.rerender({ entry: params });
  };
  const navigate = async (entry: FitnessEntry) => {
    params = entry;
    await settle();
  };
  await settle();
  return { hook, navigate, clearEntry };
}

describe('the fitness window an insight opens', () => {
  it('keeps the day selected on a cold start once the params clear', async () => {
    const { hook, clearEntry } = await mountWith(HRV);

    expect(clearEntry).toHaveBeenCalled();
    expect(hook.result.current.timeRange).toBe('1m');
    expect(hook.result.current.selectedDate).toBe('2026-09-10');
  });

  it('applies the range and day to a screen that is already mounted', async () => {
    const { hook, navigate } = await mountWith(NONE);
    expect(hook.result.current.timeRange).toBe('6m');

    await navigate(HRV);

    expect(hook.result.current.timeRange).toBe('1m');
    expect(hook.result.current.selectedDate).toBe('2026-09-10');
  });

  it('applies a second entry over the first', async () => {
    const { hook, navigate } = await mountWith(HRV);

    await navigate({ range: '3m', date: '2026-08-01' });

    expect(hook.result.current.timeRange).toBe('3m');
    expect(hook.result.current.selectedDate).toBe('2026-08-01');
  });

  it('drops a pinned day when the entry names only a range', async () => {
    const { hook, navigate } = await mountWith(HRV);

    await navigate({ range: '3m', date: null });

    expect(hook.result.current.timeRange).toBe('3m');
    expect(hook.result.current.selectedDate).toBeNull();
  });

  it('drops the pinned day when the athlete picks another range', async () => {
    const { hook } = await mountWith(HRV);

    await act(() => hook.result.current.changeTimeRange('1y'));

    expect(hook.result.current.timeRange).toBe('1y');
    expect(hook.result.current.selectedDate).toBeNull();
  });
});
