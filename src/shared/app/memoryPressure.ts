/**
 * Memory pressure reclaimers. Android delivers `onTrimMemory` levels, the last of
 * which is the signal immediately before the low-memory killer takes the process;
 * iOS delivers one undifferentiated `memoryWarning`. A subsystem registers what it
 * can rebuild, with the level from which losing it is worth the rebuild.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState } from 'react-native';

import { debug } from '@/shared/debug/debug';

const log = debug.create('Memory');

// android.content.ComponentCallbacks2
export const TRIM_RUNNING_MODERATE = 5;
export const TRIM_RUNNING_LOW = 10;
export const TRIM_RUNNING_CRITICAL = 15;
export const TRIM_UI_HIDDEN = 20;
export const TRIM_BACKGROUND = 40;
export const TRIM_MODERATE = 60;
export const TRIM_COMPLETE = 80;

export interface Reclaimer {
  name: string;
  minLevel: number;
  release: (level: number) => void;
}

const reclaimers = new Map<string, Reclaimer>();

/** Registering a name that is already held keeps the first registration. */
export function registerReclaimer(reclaimer: Reclaimer): () => void {
  if (!reclaimers.has(reclaimer.name)) {
    reclaimers.set(reclaimer.name, reclaimer);
  }
  return () => {
    reclaimers.delete(reclaimer.name);
  };
}

/** Runs every reclaimer at or below `level`, in registration order. Returns the names that ran. */
export function dispatchMemoryPressure(level: number): string[] {
  const released: string[] = [];
  for (const reclaimer of reclaimers.values()) {
    if (level < reclaimer.minLevel) continue;
    try {
      reclaimer.release(level);
      released.push(reclaimer.name);
    } catch (e) {
      log.warn(`${reclaimer.name} failed to release:`, e);
    }
  }
  return released;
}

interface VeloqMemoryModule {
  addListener(
    event: 'onTrimMemory',
    listener: (event: { level: number }) => void
  ): { remove(): void };
}

const VeloqMemory = requireOptionalNativeModule<VeloqMemoryModule>('VeloqMemory');

/**
 * Subscribes both platform signals. iOS gives no level and no second warning, so its
 * one warning is taken at the hardest level.
 */
export function startMemoryPressureListener(): () => void {
  const warning = AppState.addEventListener('memoryWarning', () => {
    dispatchMemoryPressure(TRIM_COMPLETE);
  });
  const trim = VeloqMemory?.addListener('onTrimMemory', ({ level }) => {
    dispatchMemoryPressure(level);
  });
  return () => {
    warning.remove();
    trim?.remove();
  };
}
