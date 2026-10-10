import { Platform } from 'react-native';

import { debug } from '@/shared/debug/debug';
import {
  beginBackgroundTask,
  endBackgroundTask,
  prepareEngineForSuspension,
} from '@/shared/native/appGroup';

const log = debug.create('EngineSuspension');

/**
 * How long work the background started is given before the engine stops
 * writing. iOS grants a background task about thirty seconds, and this and the
 * deadline below have to fit inside it together.
 */
const BACKGROUND_WORK_ALLOWANCE_MS = 12_000;

/**
 * How long the engine gives the writes already in flight to commit or roll
 * back. One that outlasts it is left to the system.
 */
const SUSPENSION_DEADLINE_MS = 8_000;

/**
 * Stop the engine writing before iOS suspends the app.
 *
 * The library sits in the App Group container, and the system terminates a
 * suspended app that still holds a lock on a file there. So the engine is
 * asked to stop, inside a background task that keeps the process alive while
 * the writes in flight end. `pending` is background work that still needs the
 * engine, given its allowance first, since its writes would be refused once
 * the engine has stopped. The app delegate resumes the engine on the way back
 * to the foreground. Nothing happens on Android, where the database is not in
 * a shared container.
 */
export async function quietEngineForSuspension(pending?: Promise<void>): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const task = beginBackgroundTask('veloq-engine-suspension');
  let allowance: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        allowance = setTimeout(resolve, BACKGROUND_WORK_ALLOWANCE_MS);
      }),
    ]);
    const quiet = await prepareEngineForSuspension(SUSPENSION_DEADLINE_MS);
    if (quiet === false) log.warn('the engine was not quiet when the app was suspended');
  } catch (e) {
    log.warn('could not stop the engine writing for the suspension:', e);
  } finally {
    clearTimeout(allowance);
    endBackgroundTask(task);
  }
}
