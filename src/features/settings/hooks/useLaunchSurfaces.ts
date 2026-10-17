import Constants from 'expo-constants';

import { useEngineStatus } from '@/features/routes';
import { useAuthStore } from '@/shared/app/AuthStore';

import { getSlidesSince } from '../components/whatsNew/slides';
import { launchSurfaces, type LaunchSurfaces } from '../lib/launchSurfaces';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

/**
 * The launch facts read from where each is held, put through `launchSurfaces`.
 * `libraryCount` matters only to the notification card, so a surface that is not
 * that card leaves it out.
 */
export function useLaunchSurfaces(libraryCount = 0): LaunchSurfaces {
  const taken = useWhatsNewStore((s) => s.launchModal);
  const restoreOffered = useWhatsNewStore((s) => s.restoreOffer !== null);
  const settingsLoaded = useWhatsNewStore((s) => s.isLoaded);
  const lastSeenVersion = useWhatsNewStore((s) => s.lastSeenVersion);
  const tourOpen = useWhatsNewStore((s) => s.tourState !== null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const libraryRebuilt = useEngineStatus((s) => s.quarantineReport !== null);
  const currentVersion = Constants.expoConfig?.version ?? '';

  return launchSurfaces({
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
    libraryCount,
  });
}
