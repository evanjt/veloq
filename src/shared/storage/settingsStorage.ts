/**
 * Unified settings read/write that prefers SQLite (via Rust FFI) with
 * AsyncStorage fallback. During the transition period, writes go to both.
 *
 * After a full release cycle, the AsyncStorage fallback can be removed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getEngine } from '@/shared/native/engine';

/**
 * Writes issued before the current tick ends, in the order their keys were
 * first written, each holding the last value given for that key.
 */
const pending = new Map<string, string>();
let flushing: Promise<void> | null = null;

/** One commit is two fsyncs, so the batch is what a launch pays instead of one per store. */
function commitPending(): void {
  if (pending.size === 0) return;
  const pairs = [...pending].map(([key, value]) => ({ key, value }));
  pending.clear();
  const engine = getEngine();
  if (!engine) return;
  try {
    // A native binary older than the batch export has no `setSettings`, and
    // dropping the writes there would lose every preference silently.
    if (typeof engine.setSettings === 'function') {
      engine.setSettings(pairs);
    } else {
      for (const { key, value } of pairs) engine.setSetting(key, value);
    }
  } catch {
    // Settings write failed - non-critical, AsyncStorage still holds the value
  }
}

/**
 * Read a setting. Tries SQLite first, falls back to AsyncStorage.
 */
export async function getSetting(key: string): Promise<string | null> {
  // A value written this tick has not reached SQLite yet, and a read that
  // missed it would answer with the value the write was replacing.
  const queued = pending.get(key);
  if (queued !== undefined) return queued;
  const engine = getEngine();
  if (engine) {
    const value = engine.getSetting(key);
    if (value !== undefined) return value;
  }
  // Fallback to AsyncStorage (pre-migration or engine not ready)
  return AsyncStorage.getItem(key);
}

/**
 * Write a setting to both SQLite and AsyncStorage (transition period).
 *
 * The SQLite half is batched: every write issued in the same tick commits
 * together, because a durable commit costs about 20 ms on the thread that
 * asked and a launch restores a dozen stores at once. The awaited promise
 * resolves once the value is stored on both sides.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  pending.set(key, value);
  await Promise.all([flushSettingWrites(), AsyncStorage.setItem(key, value)]);
}

/**
 * Commit whatever this tick has queued. Awaiting it is how a caller knows
 * the engine holds the value; callers of `setSetting` await it already.
 */
export function flushSettingWrites(): Promise<void> {
  flushing ??= Promise.resolve().then(() => {
    flushing = null;
    commitPending();
  });
  return flushing;
}

/**
 * Remove a setting from both SQLite and AsyncStorage.
 */
export async function removeSetting(key: string): Promise<void> {
  // A key queued for this tick and then removed must not be written after it.
  pending.delete(key);
  const engine = getEngine();
  if (engine) {
    engine.deleteSetting(key);
  }
  await AsyncStorage.removeItem(key);
}
