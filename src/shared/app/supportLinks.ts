/**
 * The places outside the app an athlete is sent for help, an update or a review,
 * and the crash log they can take with them. Settings, the feed's support card
 * and the engine banner all link here, so a moved forum thread or store id is
 * one edit.
 */

import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { TFunction } from 'i18next';

import { getCrashLog, formatCrashLog } from '@/shared/debug/crashLog';
import { shareFile } from '@/features/settings/lib/shareFile';
import { inform } from '@/shared/ui/dialog';

export const FORUM_URL =
  'https://forum.intervals.icu/t/veloq-route-and-section-matching-mapping-app/120283';
export const GITHUB_ISSUES_URL = 'https://github.com/evanjt/veloq/issues/new';
export const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/evanjt';
const REPOSITORY_URL = 'https://github.com/evanjt/veloq';

const PLAY_STORE_URL = 'market://details?id=com.veloq.app';
const APP_STORE_URL = 'itms-apps://apps.apple.com/app/id6757836732';

/**
 * Opens the app's store listing, at its review form when `review` is set. The
 * Play listing carries both, so only the App Store takes the action.
 */
export function openStorePage({ review = false }: { review?: boolean } = {}): void {
  if (Platform.OS === 'android') {
    Linking.openURL(PLAY_STORE_URL);
  } else if (Platform.OS === 'ios') {
    Linking.openURL(review ? `${APP_STORE_URL}?action=write-review` : APP_STORE_URL);
  } else {
    WebBrowser.openBrowserAsync(REPOSITORY_URL);
  }
}

export function openForum(): void {
  WebBrowser.openBrowserAsync(FORUM_URL);
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
