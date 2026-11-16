// The names the app gives a sport and an upload state, read from the app's own
// strings so the page says what the phone says. A sport the app has no name
// for is written as the phone sent it.

import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { knownStatus } from './recordingStatus';

/** A sport type's name in the app's words. */
export function useSportName(): (sport: string) => string {
  const { t } = useTranslation();
  return (sport) => t(`activityTypes.${sport}` as ParseKeys, { defaultValue: sport });
}

/** An upload state's name in the app's library words. */
export function useUploadStatusName(): (status: string) => string {
  const { t } = useTranslation();
  return (status) => t(`recording.library.status.${knownStatus(status)}` as ParseKeys);
}
