/**
 * Scenario: the athlete lowers the tile cache budget in settings while a map
 * is open behind the settings screen.
 *
 * Expected behaviour: the pages that are already up take the new ceiling.
 * Both interactive surfaces bake the budget into their HTML at build time and
 * nothing re-sent it, so the setting changed nothing until a relaunch. The
 * snapshot pool did subscribe, but it is torn down whenever the feed is not
 * focused, which is exactly when the settings screen is up.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useLiveTileCacheBudget } from '@/features/maps/hooks/useLiveTileCacheBudget';
import { emitTileCacheBudget } from '@/features/maps/lib/terrainSnapshotEvents';
import { applyTileCacheBudgetScript, tileCacheBudgets } from '@/features/maps/lib/tileCacheBudget';

describe('a live page takes a changed tile cache budget', () => {
  it('injects the new ceiling when the setting changes', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheBudget(inject));

    act(() => emitTileCacheBudget(120));

    expect(inject).toHaveBeenCalledWith(applyTileCacheBudgetScript(120));
  });

  /** The script has to carry the numbers, not just be a script. */
  it('carries the per-cache budgets the new ceiling implies', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheBudget(inject));

    act(() => emitTileCacheBudget(120));

    const script = inject.mock.calls[0][0] as string;
    for (const bytes of Object.values(tileCacheBudgets(120))) {
      expect(script).toContain(String(bytes));
    }
  });

  it('takes every change, not only the first', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheBudget(inject));

    act(() => emitTileCacheBudget(120));
    act(() => emitTileCacheBudget(40));

    expect(inject).toHaveBeenCalledTimes(2);
    expect(inject).toHaveBeenLastCalledWith(applyTileCacheBudgetScript(40));
  });

  it('stops when the page goes', () => {
    const inject = jest.fn();
    const { unmount } = renderHook(() => useLiveTileCacheBudget(inject));

    unmount();
    act(() => emitTileCacheBudget(40));

    expect(inject).not.toHaveBeenCalled();
  });

  it('injects nothing until something changes', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheBudget(inject));

    expect(inject).not.toHaveBeenCalled();
  });
});
