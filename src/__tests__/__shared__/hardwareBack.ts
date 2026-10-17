/**
 * Android's hardware back under Jest, which runs as iOS where `BackHandler`
 * keeps no listeners. `press` walks the listeners newest first and stops at the
 * first that handles the press, as the Android module does, and answers whether
 * any did.
 */
import { BackHandler } from 'react-native';

type HardwareBackPressEvent = Parameters<Parameters<typeof BackHandler.addEventListener>[1]>[0];

export interface HardwareBack {
  press: () => boolean;
  /** Listeners registered and not yet removed. */
  listeners: () => number;
  restore: () => void;
}

export function stubHardwareBack(): HardwareBack {
  const handlers: ((event: HardwareBackPressEvent) => boolean | null | undefined)[] = [];
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      },
    };
  });

  return {
    press: () => {
      const event: HardwareBackPressEvent = { type: 'hardwareBackPress', timeStamp: 0 };
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i]?.(event)) return true;
      }
      return false;
    },
    listeners: () => handlers.length,
    restore: () => spy.mockRestore(),
  };
}
