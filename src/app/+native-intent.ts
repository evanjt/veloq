/**
 * Every deep link the system hands the app passes through here before it is
 * routed, cold or warm.
 *
 * The native Android activity entry opens its activity by link, which never
 * reaches the tap handler, so the athlete check a tapped entry passes is made
 * here instead. A recording link is marked a quick start here, so a link from
 * another app cannot start a ride without a tap on Start. A null keeps the app where it is.
 */

import { openableSystemPath } from '@/features/insights';
import { armSystemRecordingPath } from '@/features/recording';
import { ensureCredentialsHydrated, getStoredCredentials } from '@/shared/app/AuthStore';

export async function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): Promise<string | null> {
  // Only a link naming an athlete turns on the athlete, and only it waits for one.
  if (openableSystemPath(path, null) === path) return armSystemRecordingPath(path);
  // A cold tap can beat the credential to memory.
  await ensureCredentialsHydrated();
  const openable = openableSystemPath(path, getStoredCredentials().athleteId);
  return openable === null ? null : armSystemRecordingPath(openable);
}
