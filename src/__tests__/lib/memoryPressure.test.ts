/**
 * Scenario: Android sends `onTrimMemory` before the low-memory killer takes the
 * process, and iOS sends one `memoryWarning`.
 * Expected behaviour: every reclaimer registered at or below the delivered level
 * runs exactly once, a throwing reclaimer does not stop the ones behind it, and
 * both platform signals reach the same dispatcher.
 */
import { AppState } from 'react-native';

import {
  TRIM_BACKGROUND,
  TRIM_COMPLETE,
  TRIM_MODERATE,
  TRIM_RUNNING_LOW,
  TRIM_UI_HIDDEN,
} from '@/shared/app/memoryPressure';

const mockTrimListeners: ((event: { level: number }) => void)[] = [];
const mockTrimRemove = jest.fn();
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    addListener: (_event: string, listener: (event: { level: number }) => void) => {
      mockTrimListeners.push(listener);
      return { remove: mockTrimRemove };
    },
  }),
}));

type Module = typeof import('@/shared/app/memoryPressure');

function load(): Module {
  let mod: Module;
  jest.isolateModules(() => {
    mod = require('@/shared/app/memoryPressure');
  });
  return mod!;
}

describe('memory pressure reclaimers', () => {
  it('runs a reclaimer at its threshold and above, never below', () => {
    const { registerReclaimer, dispatchMemoryPressure } = load();
    const release = jest.fn();
    registerReclaimer({ name: 'tiles', minLevel: TRIM_MODERATE, release });

    dispatchMemoryPressure(TRIM_BACKGROUND);
    expect(release).not.toHaveBeenCalled();

    dispatchMemoryPressure(TRIM_MODERATE);
    dispatchMemoryPressure(TRIM_COMPLETE);
    expect(release.mock.calls).toEqual([[TRIM_MODERATE], [TRIM_COMPLETE]]);
  });

  it('reports which reclaimers ran', () => {
    const { registerReclaimer, dispatchMemoryPressure } = load();
    registerReclaimer({ name: 'queries', minLevel: TRIM_UI_HIDDEN, release: jest.fn() });
    registerReclaimer({ name: 'tiles', minLevel: TRIM_MODERATE, release: jest.fn() });

    expect(dispatchMemoryPressure(TRIM_UI_HIDDEN)).toEqual(['queries']);
    expect(dispatchMemoryPressure(TRIM_COMPLETE)).toEqual(['queries', 'tiles']);
  });

  it('keeps going when one reclaimer throws', () => {
    const { registerReclaimer, dispatchMemoryPressure } = load();
    const second = jest.fn();
    registerReclaimer({
      name: 'broken',
      minLevel: TRIM_UI_HIDDEN,
      release: () => {
        throw new Error('gone');
      },
    });
    registerReclaimer({ name: 'second', minLevel: TRIM_UI_HIDDEN, release: second });

    expect(dispatchMemoryPressure(TRIM_COMPLETE)).toEqual(['second']);
    expect(second).toHaveBeenCalledWith(TRIM_COMPLETE);
  });

  it('unregisters', () => {
    const { registerReclaimer, dispatchMemoryPressure } = load();
    const release = jest.fn();
    const off = registerReclaimer({ name: 'tiles', minLevel: TRIM_RUNNING_LOW, release });
    off();

    expect(dispatchMemoryPressure(TRIM_COMPLETE)).toEqual([]);
    expect(release).not.toHaveBeenCalled();
  });

  it('registers a name only once', () => {
    const { registerReclaimer, dispatchMemoryPressure } = load();
    const release = jest.fn();
    registerReclaimer({ name: 'tiles', minLevel: TRIM_UI_HIDDEN, release });
    registerReclaimer({ name: 'tiles', minLevel: TRIM_UI_HIDDEN, release });

    expect(dispatchMemoryPressure(TRIM_COMPLETE)).toEqual(['tiles']);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('memory pressure listener', () => {
  it("dispatches iOS's memory warning at the hardest level", () => {
    const { registerReclaimer, startMemoryPressureListener } = load();
    const handlers: (() => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'memoryWarning') handlers.push(handler as () => void);
      return { remove: jest.fn() } as never;
    });
    const release = jest.fn();
    registerReclaimer({ name: 'queries', minLevel: TRIM_COMPLETE, release });

    const stop = startMemoryPressureListener();
    expect(handlers).toHaveLength(1);
    handlers[0]!();
    expect(release).toHaveBeenCalledWith(TRIM_COMPLETE);

    stop();
    spy.mockRestore();
  });

  it("dispatches Android's trim level as delivered", () => {
    const { registerReclaimer, startMemoryPressureListener } = load();
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove: jest.fn() }) as never);
    const release = jest.fn();
    registerReclaimer({ name: 'tiles', minLevel: TRIM_MODERATE, release });

    const stop = startMemoryPressureListener();
    const deliver = mockTrimListeners[mockTrimListeners.length - 1]!;
    deliver({ level: TRIM_BACKGROUND });
    expect(release).not.toHaveBeenCalled();

    deliver({ level: TRIM_COMPLETE });
    expect(release).toHaveBeenCalledWith(TRIM_COMPLETE);

    stop();
    expect(mockTrimRemove).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stops listening when torn down', () => {
    const { startMemoryPressureListener } = load();
    const remove = jest.fn();
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(() => ({ remove }) as never);

    startMemoryPressureListener()();
    expect(remove).toHaveBeenCalled();

    spy.mockRestore();
  });
});
