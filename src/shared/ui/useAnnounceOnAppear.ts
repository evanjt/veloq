import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Speaks `message` through the screen reader when the calling component mounts
 * or the message changes. Android speaks a view's `accessibilityLiveRegion` by
 * itself and the prop does nothing on iOS, so this announces on iOS only, and
 * a banner carries both.
 */
export function useAnnounceOnAppear(message: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== 'ios' || !message) return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
