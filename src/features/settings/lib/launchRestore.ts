/**
 * The order the restores run in on a signed-in launch.
 *
 * A backup picked before signing in goes first and answers the offer, then one
 * opened into the app from outside while it launched. A library still empty
 * after both is offered the newest backup that can be seen, the device
 * backup's record zip among them, and nothing from any of them is applied
 * before the athlete taps Restore.
 */

import type { TFunction } from 'i18next';

import { applyHeldImport } from './heldImport';
import { applyOpenedBackup } from './openedBackup';
import { offerRestorePrompt } from './restorePrompt';

/** `launchCount` is the activity count read before the launch sync stores any. */
export async function runLaunchRestores(
  launchCount: number,
  t: TFunction,
  isCurrent: () => boolean
): Promise<void> {
  await applyHeldImport(t);
  await applyOpenedBackup(t);
  await offerRestorePrompt(launchCount, isCurrent);
}
