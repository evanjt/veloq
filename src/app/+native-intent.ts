/**
 * Every deep link the system hands the app passes through here before it is
 * routed, cold or warm.
 *
 * The native Android activity entry opens its activity by link, which never
 * reaches the tap handler, so the athlete check a tapped entry passes is made
 * here instead. A link to a route the app does not publish as an entry, a
 * sheet above all, opens nothing, and the developer screens open only once the
 * athlete has unlocked them or in the development build. A recording link is marked a quick start here, so a link from
 * another app cannot start a ride without a tap on Start. A null keeps the app where it is.
 *
 * On Android the router stops waiting for the launch link after 150 ms and
 * starts at the root instead, and a cold start whose activity resumes later than
 * that, a widget tap on a killed app, loses its link and opens the Feed. So a
 * cold Android launch at the root asks the system once more, with a longer wait.
 */

import Constants from 'expo-constants';
import * as ExpoLinking from 'expo-linking';
import { Linking, Platform } from 'react-native';

import { openableSystemPath } from '@/features/insights';
import { armSystemRecordingPath } from '@/features/recording';
import { useDebugStore } from '@/features/settings';
import { ensureCredentialsHydrated, getStoredCredentials } from '@/shared/app/AuthStore';

/** The application id of the development build, which the test flows drive. */
const DEV_APP_ID = 'com.veloq.app.dev';

/** Whether a developer screen may open: unlocked in settings, or the development build. */
function developerLinksOpen(): boolean {
  const config = Constants.expoConfig;
  const appId = Platform.OS === 'ios' ? config?.ios?.bundleIdentifier : config?.android?.package;
  return appId === DEV_APP_ID || useDebugStore.getState().unlocked;
}

/** How long a cold start waits for the system's launch link after the router gave up on it. */
const LAUNCH_LINK_WAIT_MS = 3_000;

async function launchLink(path: string, initial: boolean): Promise<string> {
  if (!initial || Platform.OS !== 'android' || path !== ExpoLinking.createURL('/')) return path;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LAUNCH_LINK_WAIT_MS);
  });
  try {
    return (await Promise.race([Linking.getInitialURL(), gaveUp])) ?? path;
  } catch {
    return path;
  } finally {
    clearTimeout(timer);
  }
}

export async function redirectSystemPath({
  path: received,
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string | null> {
  const path = await launchLink(received, initial);
  const developer = developerLinksOpen();
  // Only a link naming an athlete turns on the athlete, and only it waits for one.
  if (openableSystemPath(path, null, developer) === path) return armSystemRecordingPath(path);
  // A cold tap can beat the credential to memory.
  await ensureCredentialsHydrated();
  const openable = openableSystemPath(path, getStoredCredentials().athleteId, developer);
  return openable === null ? null : armSystemRecordingPath(openable);
}
