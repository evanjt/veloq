import { useEffect } from 'react';
import Constants from 'expo-constants';

import { useEngineStatus } from '@/features/routes';
import { useAuthStore } from '@/shared/app/AuthStore';

import { getSlidesSince } from '../components/whatsNew/slides';
import {
  launchSurfaces,
  quietPeriod,
  type LaunchAsk,
  type LaunchSurfaces,
} from '../lib/launchSurfaces';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

/**
 * The launch facts read from where each is held, put through `launchSurfaces`.
 * Every fact is session-wide, so each caller reads the same verdict. The ask the
 * verdict picks takes the session's slot.
 */
export function useLaunchSurfaces(): LaunchSurfaces {
  const taken = useWhatsNewStore((s) => s.launchModal);
  const restoreOffered = useWhatsNewStore((s) => s.restoreOffer !== null);
  const settingsLoaded = useWhatsNewStore((s) => s.isLoaded);
  const lastSeenVersion = useWhatsNewStore((s) => s.lastSeenVersion);
  const tourOpen = useWhatsNewStore((s) => s.tourState !== null);
  const usageLoaded = useWhatsNewStore((s) => s.usageLoaded);
  const useDays = useWhatsNewStore((s) => s.useDays);
  const firstSyncSettled = useWhatsNewStore((s) => s.firstSyncSettled);
  const launches = useWhatsNewStore((s) => s.launches);
  const sessionAsk = useWhatsNewStore((s) => s.sessionAsk);
  const eligibleAsks = useWhatsNewStore((s) => s.eligibleAsks);
  const takeSessionAsk = useWhatsNewStore((s) => s.takeSessionAsk);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const libraryRebuilt = useEngineStatus((s) => s.quarantineReport !== null);
  const currentVersion = Constants.expoConfig?.version ?? '';

  const surfaces = launchSurfaces({
    taken,
    settingsLoaded,
    // Demo is not a sign-in: opening the tour there would mark it seen before the first real one.
    tourEligible: isAuthenticated && !isDemoMode,
    lastSeenVersion,
    currentVersion,
    missedSlideCount: lastSeenVersion ? getSlidesSince(lastSeenVersion).length : 0,
    libraryRebuilt,
    restoreOffered,
    tourOpen,
    firstSyncSettled,
    useDays: usageLoaded ? useDays : null,
    launches: usageLoaded ? launches : null,
    sessionAsk,
    eligibleAsks,
  });

  const { ask } = surfaces;
  useEffect(() => {
    if (ask) takeSessionAsk(ask);
  }, [ask, takeSessionAsk]);

  return surfaces;
}

/**
 * Reports a card's own eligibility to the session's verdict and answers whether
 * the card holds the session's one ask. The report is withdrawn on unmount.
 */
export function useSessionAsk(ask: LaunchAsk, eligible: boolean): boolean {
  const setAskEligible = useWhatsNewStore((s) => s.setAskEligible);
  useEffect(() => {
    setAskEligible(ask, eligible);
  }, [ask, eligible, setAskEligible]);
  useEffect(() => () => setAskEligible(ask, false), [ask, setAskEligible]);
  return useLaunchSurfaces().ask === ask;
}

/** Whether the quiet period holds, or null before the days of use are counted. */
export function useQuietPeriod(): boolean | null {
  const usageLoaded = useWhatsNewStore((s) => s.usageLoaded);
  const useDays = useWhatsNewStore((s) => s.useDays);
  const firstSyncSettled = useWhatsNewStore((s) => s.firstSyncSettled);
  return quietPeriod({ firstSyncSettled, useDays: usageLoaded ? useDays : null });
}

/** The install's days of use, the record the quiet period is counted on. */
export function useDaysOfUse(): { firstUseDate: string | null; useDays: number } {
  const firstUseDate = useWhatsNewStore((s) => s.firstUseDate);
  const useDays = useWhatsNewStore((s) => s.useDays);
  return { firstUseDate, useDays };
}
