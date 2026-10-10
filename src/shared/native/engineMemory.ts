import { debug } from '@/shared/debug/debug';

import { getEngine } from './engine';

const log = debug.create('EngineMemory');

/**
 * Ask the engine to give back the memory it can rebuild. `hard` is the last
 * warning before the process is killed, where its caches go too. A trim
 * callback does not wait on it, so it never rejects: a failed release leaves
 * the memory where it was, which is no worse than not asking.
 */
export async function releaseEngineMemory(hard: boolean): Promise<void> {
  try {
    await getEngine()?.releaseMemory(hard);
  } catch (e) {
    log.warn('the engine did not release memory:', e);
  }
}
