import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

/**
 * Opens a session whose one ask is still free: one after the quiet period by
 * default, so any eligible card may hold it, or one inside it, where only the
 * restore offer may.
 */
export function openLaunchSession(quietPeriod = false): void {
  useWhatsNewStore.setState({
    usageLoaded: true,
    firstSyncSettled: !quietPeriod,
    useDays: quietPeriod ? 1 : 2,
    sessionAsk: null,
    eligibleAsks: [],
    tourOfferSettled: false,
  });
}
