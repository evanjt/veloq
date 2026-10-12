/**
 * The places outside the app an athlete is sent for help, an update or a review,
 * and the crash log they can take with them. Settings, the feed's support card
 * and the engine banner all link here, so a moved forum thread or store id is
 * one edit.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { TFunction } from 'i18next';

import { openExternal } from '@/shared/app/openExternal';
import { getCrashLog, formatCrashLog } from '@/shared/debug/crashLog';
import { shareFile } from '@/features/settings/lib/shareFile';
import { inform } from '@/shared/ui/dialog';

export const FORUM_URL =
  'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283';
export const GITHUB_ISSUES_URL = 'https://github.com/evanjt/veloq/issues/new';
export const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/evanjt';
/** What leaves the device and why, linked from sign-in, notifications and About. */
export const VELOQ_PRIVACY_URL = 'https://veloq.fit/privacy';
const REPOSITORY_URL = 'https://github.com/evanjt/veloq';

const PLAY_STORE_URL = 'market://details?id=com.veloq.app';
const APP_STORE_URL = 'itms-apps://apps.apple.com/app/id6757836732';
const PLAY_STORE_WEB_URL = 'https://play.google.com/store/apps/details?id=com.veloq.app';
const APP_STORE_WEB_URL = 'https://apps.apple.com/app/id6757836732';

/**
 * Opens the app's store listing, at its review form when `review` is set. The
 * Play listing carries both, so only the App Store takes the action. A device
 * with no store app gets the web listing the app config publishes. Resolves
 * whether either opened.
 */
export function openStorePage({ review = false }: { review?: boolean } = {}): Promise<boolean> {
  const config = Constants.expoConfig;
  if (Platform.OS === 'android') {
    return openExternal(PLAY_STORE_URL, config?.android?.playStoreUrl ?? PLAY_STORE_WEB_URL);
  }
  if (Platform.OS === 'ios') {
    const action = review ? '?action=write-review' : '';
    const listing = config?.ios?.appStoreUrl ?? APP_STORE_WEB_URL;
    return openExternal(`${APP_STORE_URL}${action}`, `${listing}${action}`);
  }
  return openExternal(REPOSITORY_URL);
}

export function openForum(): Promise<boolean> {
  return openExternal(FORUM_URL);
}

/** Shares the on-device crash log, or says there is none to share. */
export async function shareCrashLog(t: TFunction): Promise<void> {
  const entries = await getCrashLog();
  if (!entries.length) {
    inform({ title: t('support.shareCrashLog'), message: t('support.noCrashLog') });
    return;
  }
  await shareFile({
    content: formatCrashLog(entries),
    filename: 'veloq-crash-log.txt',
    mimeType: 'text/plain',
  });
}
