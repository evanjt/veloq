/**
 * Expected behaviour: each registered reclaimer gives back only what it can rebuild,
 * and gives back more the closer the level is to the kill.
 */
import { registerTileCacheReclaimer } from '@/features/maps/lib/mapMemoryReclaimer';
import {
  dispatchMemoryPressure,
  TRIM_BACKGROUND,
  TRIM_COMPLETE,
  TRIM_MODERATE,
  TRIM_UI_HIDDEN,
} from '@/shared/app/memoryPressure';
import { registerQueryCacheReclaimer } from '@/shared/app/memoryReclaimers';
import { queryClient } from '@/shared/query/QueryProvider';

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  emitClearTileCache: jest.fn(),
}));

const { emitClearTileCache } = jest.requireMock('@/features/maps/lib/terrainSnapshotEvents');

describe('query cache reclaimer', () => {
  let off: () => void;

  beforeEach(() => {
    off = registerQueryCacheReclaimer();
    jest.spyOn(queryClient, 'removeQueries').mockImplementation(() => undefined);
    jest.spyOn(queryClient, 'clear').mockImplementation(() => undefined);
  });

  afterEach(() => {
    off();
    jest.restoreAllMocks();
  });

  it('holds everything while the process is still in the foreground', () => {
    dispatchMemoryPressure(TRIM_UI_HIDDEN - 1);
    expect(queryClient.removeQueries).not.toHaveBeenCalled();
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it('drops only the unobserved keys once the UI is hidden', () => {
    dispatchMemoryPressure(TRIM_BACKGROUND);
    expect(queryClient.removeQueries).toHaveBeenCalledWith({ type: 'inactive' });
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it('drops the whole cache at the last warning', () => {
    dispatchMemoryPressure(TRIM_COMPLETE);
    expect(queryClient.clear).toHaveBeenCalled();
    expect(queryClient.removeQueries).not.toHaveBeenCalled();
  });
});

describe('tile cache reclaimer', () => {
  let off: () => void;

  beforeEach(() => {
    off = registerTileCacheReclaimer();
    emitClearTileCache.mockClear();
  });

  afterEach(() => off());

  it('keeps the tiles until the process is a kill candidate', () => {
    dispatchMemoryPressure(TRIM_BACKGROUND);
    expect(emitClearTileCache).not.toHaveBeenCalled();
  });

  it('clears them from TRIM_MEMORY_MODERATE', () => {
    dispatchMemoryPressure(TRIM_MODERATE);
    expect(emitClearTileCache).toHaveBeenCalledTimes(1);
  });
});
