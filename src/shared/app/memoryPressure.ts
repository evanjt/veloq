/**
 * Memory pressure reclaimers. Android delivers `onTrimMemory` levels, the last of
 * which is the signal immediately before the low-memory killer takes the process;
 * iOS delivers one undifferentiated `memoryWarning`. From API 34 Android sends no
 * level above `TRIM_MEMORY_BACKGROUND`, so that one is taken as the last. A
 * subsystem registers what it can rebuild, with the level from which losing it is
 * worth the rebuild.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppState, Platform } from 'react-native';

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

// The first API level that no longer sends TRIM_MEMORY_MODERATE or TRIM_MEMORY_COMPLETE.
const ANDROID_LAST_TRIM_IS_BACKGROUND = 34;

/** The level a delivered Android trim level is dispatched at on this OS version. */
function androidDispatchLevel(level: number): number {
  if (Platform.OS !== 'android' || Number(Platform.Version) < ANDROID_LAST_TRIM_IS_BACKGROUND) {
    return level;
  }
  return level >= TRIM_BACKGROUND ? TRIM_COMPLETE : level;
}

interface VeloqMemoryModule {
  addListener(
    event: 'onTrimMemory',
    listener: (event: { level: number }) => void
  ): { remove(): void };
  clearImageCache?(): void;
}

const VeloqMemory = requireOptionalNativeModule<VeloqMemoryModule>('VeloqMemory');

/**
 * Drops Fresco's decoded bitmaps. React Native clears them only when the last
 * activity is destroyed, and no trim level reaches the image pipeline from
 * JavaScript, so the native module does it. No-op where the module is absent.
 */
export function clearNativeImageCache(): void {
  VeloqMemory?.clearImageCache?.();
}

/**
 * Subscribes both platform signals. iOS gives no level and no second warning, so its
 * one warning is taken at the hardest level, and so is Android's last level on an OS
 * that sends no harder one.
 */
export function startMemoryPressureListener(): () => void {
  const warning = AppState.addEventListener('memoryWarning', () => {
    dispatchMemoryPressure(TRIM_COMPLETE);
  });
  const trim = VeloqMemory?.addListener('onTrimMemory', ({ level }) => {
    dispatchMemoryPressure(androidDispatchLevel(level));
  });
  return () => {
    warning.remove();
    trim?.remove();
  };
}
