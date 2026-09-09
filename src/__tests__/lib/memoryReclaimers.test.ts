/**
 * Expected behaviour: each registered reclaimer gives back only what it can rebuild,
 * and gives back more the closer the level is to the kill.
 */
import { AppState } from 'react-native';

import {
  registerMapSurfaceReclaimer,
  registerTileCacheReclaimer,
} from '@/features/maps/lib/mapMemoryReclaimer';
import {
  dispatchMemoryPressure,
  TRIM_BACKGROUND,
  TRIM_COMPLETE,
  TRIM_MODERATE,
  TRIM_UI_HIDDEN,
} from '@/shared/app/memoryPressure';
import {
  registerImageCacheReclaimer,
  registerQueryCacheReclaimer,
} from '@/shared/app/memoryReclaimers';
import { queryClient } from '@/shared/query/QueryProvider';

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  emitClearTileCache: jest.fn(),
}));

jest.mock('@/features/maps/lib/mapSurfaceRegistry', () => ({
  releaseMountedSurfaces: jest.fn(() => 0),
  rebuildReleasedSurfaces: jest.fn(() => 0),
}));

jest.mock('@/shared/app/memoryPressure', () => ({
  ...jest.requireActual('@/shared/app/memoryPressure'),
  clearNativeImageCache: jest.fn(),
}));

const { emitClearTileCache } = jest.requireMock('@/features/maps/lib/terrainSnapshotEvents');
const { releaseMountedSurfaces, rebuildReleasedSurfaces } = jest.requireMock(
  '@/features/maps/lib/mapSurfaceRegistry'
);
const { clearNativeImageCache } = jest.requireMock('@/shared/app/memoryPressure');

function setAppState(state: string): void {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

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

describe('image cache reclaimer', () => {
  let off: () => void;

  beforeEach(() => {
    off = registerImageCacheReclaimer();
    clearNativeImageCache.mockClear();
  });

  afterEach(() => off());

  it('keeps the decoded images while the process is only backgrounded', () => {
    dispatchMemoryPressure(TRIM_BACKGROUND);
    expect(clearNativeImageCache).not.toHaveBeenCalled();
  });

  it('clears them from TRIM_MEMORY_MODERATE', () => {
    dispatchMemoryPressure(TRIM_MODERATE);
    expect(clearNativeImageCache).toHaveBeenCalledTimes(1);
  });
});

describe('map surface reclaimer', () => {
  let off: () => void;
  const handlers: ((state: string) => void)[] = [];

  beforeEach(() => {
    handlers.length = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'change') handlers.push(handler as (state: string) => void);
      return { remove: jest.fn() } as never;
    });
    releaseMountedSurfaces.mockClear();
    rebuildReleasedSurfaces.mockClear();
    off = registerMapSurfaceReclaimer();
  });

  afterEach(() => {
    off();
    jest.restoreAllMocks();
  });

  it('keeps the GL contexts until the process is a kill candidate', () => {
    setAppState('background');
    dispatchMemoryPressure(TRIM_BACKGROUND);
    expect(releaseMountedSurfaces).not.toHaveBeenCalled();
  });

  it('releases every mounted surface from TRIM_MEMORY_MODERATE in the background', () => {
    setAppState('background');
    dispatchMemoryPressure(TRIM_MODERATE);
    expect(releaseMountedSurfaces).toHaveBeenCalledTimes(1);
  });

  it("never tears down a map the athlete is looking at, which is iOS's warning", () => {
    setAppState('active');
    dispatchMemoryPressure(TRIM_COMPLETE);
    expect(releaseMountedSurfaces).not.toHaveBeenCalled();
  });

  it('rebuilds on the next foreground and not before', () => {
    setAppState('background');
    dispatchMemoryPressure(TRIM_COMPLETE);
    expect(handlers).toHaveLength(1);

    handlers[0]?.('inactive');
    expect(rebuildReleasedSurfaces).not.toHaveBeenCalled();

    handlers[0]?.('active');
    expect(rebuildReleasedSurfaces).toHaveBeenCalledTimes(1);
  });
});
