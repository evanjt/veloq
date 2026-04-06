/**
 * Unified settings read/write that prefers SQLite (via Rust FFI) with
 * AsyncStorage fallback. During the transition period, writes go to both.
 *
 * After a full release cycle, the AsyncStorage fallback can be removed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRouteEngine } from '@/lib/native/routeEngine';

/**
 * Read a setting. Tries SQLite first, falls back to AsyncStorage.
 */
export async function getSetting(key: string): Promise<string | null> {
  const engine = getRouteEngine();
  if (engine) {
    const value = engine.getSetting(key);
    if (value !== undefined) return value;
  }
  // Fallback to AsyncStorage (pre-migration or engine not ready)
  return AsyncStorage.getItem(key);
}

/**
 * Write a setting to both SQLite and AsyncStorage (transition period).
 */
export async function setSetting(key: string, value: string): Promise<void> {
  const engine = getRouteEngine();
  if (engine) {
    engine.setSetting(key, value);
  }
  await AsyncStorage.setItem(key, value);
}

/**
 * Remove a setting from both SQLite and AsyncStorage.
 */
export async function removeSetting(key: string): Promise<void> {
  const engine = getRouteEngine();
  if (engine) {
    engine.deleteSetting(key);
  }
  await AsyncStorage.removeItem(key);
}
