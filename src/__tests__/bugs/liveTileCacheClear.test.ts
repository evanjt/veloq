/**
 * Scenario: the athlete taps Clear tile cache in settings with a map open
 * behind the sheet.
 *
 * Expected behaviour: the pages that are up drop their buckets. The only
 * subscriber was the snapshot pool, which is torn down whenever the feed is
 * not focused, which is exactly when the settings screen is up, so the clear
 * reached nothing and the stats read back from the live page still counted the
 * tiles it was holding.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useLiveTileCacheClear } from '@/features/maps/hooks/useLiveTileCacheClear';
import { emitClearTileCache } from '@/features/maps/lib/terrainSnapshotEvents';
import { clearTileCachesScript } from '@/features/maps/lib/tileCacheBudget';

describe('a live page drops its tiles when settings asks', () => {
  it('injects the clear script', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheClear(inject));

    act(() => emitClearTileCache());

    expect(inject).toHaveBeenCalledWith(clearTileCachesScript());
  });

  it('takes every ask, not only the first', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheClear(inject));

    act(() => emitClearTileCache());
    act(() => emitClearTileCache());

    expect(inject).toHaveBeenCalledTimes(2);
  });

  it('stops when the page goes', () => {
    const inject = jest.fn();
    const { unmount } = renderHook(() => useLiveTileCacheClear(inject));

    unmount();
    act(() => emitClearTileCache());

    expect(inject).not.toHaveBeenCalled();
  });

  it('injects nothing until something asks', () => {
    const inject = jest.fn();
    renderHook(() => useLiveTileCacheClear(inject));

    expect(inject).not.toHaveBeenCalled();
  });
});
