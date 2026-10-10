import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';

const log = debug.create('AppGroup');

interface VeloqAppGroupModule {
  containerPath(): string | null;
  beginBackgroundTask?(name: string): number | null;
  endBackgroundTask?(id: number): void;
  prepareEngineForSuspension?(deadlineMs: number): Promise<boolean>;
}

function appGroupModule(): VeloqAppGroupModule | null {
  if (Platform.OS !== 'ios') return null;
  return requireOptionalNativeModule<VeloqAppGroupModule>('VeloqAppGroup');
}

/**
 * The shared App Group container, as a plain path with a trailing slash.
 *
 * Null on Android, which has no such thing, and null on iOS when the
 * entitlement did not take. A caller treats null as "keep using Documents"
 * rather than as an error: the container is where an extension can reach the
 * database, not where the database has to be for the app itself to work.
 */
export function appGroupPath(): string | null {
  const mod = appGroupModule();
  if (!mod) return null;
  try {
    return mod.containerPath() ?? null;
  } catch (e) {
    log.warn('could not read the App Group container:', e);
    return null;
  }
}

/**
 * Ask iOS to keep the process running while `name` finishes, and answer the
 * task's id for `endBackgroundTask`. Null where there is no such thing: on
 * Android, without the native module, or when the system grants no time. The
 * native side ends the task itself if the system's time runs out first.
 */
export function beginBackgroundTask(name: string): number | null {
  const mod = appGroupModule();
  if (!mod?.beginBackgroundTask) return null;
  try {
    return mod.beginBackgroundTask(name) ?? null;
  } catch (e) {
    log.warn('could not begin a background task:', e);
    return null;
  }
}

/** End a task `beginBackgroundTask` began. Null and an id already ended are no-ops. */
export function endBackgroundTask(id: number | null): void {
  if (id === null) return;
  const mod = appGroupModule();
  try {
    mod?.endBackgroundTask?.(id);
  } catch (e) {
    log.warn('could not end a background task:', e);
  }
}

/**
 * Stop the engine writing and wait up to `deadlineMs` for the writes in flight
 * to end, resolving with whether none is left open. The native side calls the
 * engine's own suspension entry off the main thread. Null where there is no
 * shared container to protect: on Android, or without the native module.
 */
export async function prepareEngineForSuspension(deadlineMs: number): Promise<boolean | null> {
  const mod = appGroupModule();
  if (!mod?.prepareEngineForSuspension) return null;
  return mod.prepareEngineForSuspension(deadlineMs);
}
