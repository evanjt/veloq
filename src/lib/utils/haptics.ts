/**
 * Centralized haptics utility for platform-aware haptic feedback.
 * Uses expo-haptics with iOS-optimized feedback patterns.
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Platform-aware haptic feedback functions.
 * iOS has richer haptic engine support, so we use more nuanced feedback there.
 */
export const haptics = {
  /**
   * Light impact - use for subtle UI feedback like selections
   */
  light: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  },

  /**
   * Medium impact - use for confirming actions like button presses
   */
  medium: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  },

  /**
   * Heavy impact - use for significant UI changes or completions
   */
  heavy: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  },

  /**
   * Soft impact (iOS only, falls back to light on Android)
   * Good for subtle, refined feedback
   */
  soft: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  },

  /**
   * Rigid impact (iOS only, falls back to heavy on Android)
   * Good for definitive, crisp feedback
   */
  rigid: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  },

  /**
   * Selection feedback - use when users make choices (tabs, pickers, toggles)
   */
  selection: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.selectionAsync();
    }
  },

  /**
   * Success notification - use when an action completes successfully
   */
  success: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  },

  /**
   * Warning notification - use to alert users of potential issues
   */
  warning: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  },

  /**
   * Error notification - use when an action fails
   */
  error: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  },

  /**
   * Pull-to-refresh trigger - called when refresh threshold is reached
   */
  refreshTrigger: () => {
    if (Platform.OS === 'ios') {
      // iOS: Use soft impact for refined feel
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  },

  /**
   * Zone crossing - use when crossing fitness zone thresholds
   */
  zoneCrossing: () => {
    if (Platform.OS === 'ios') {
      // iOS: Use rigid for definitive zone change
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  },

  /**
   * Chart interaction - use when activating crosshair on charts
   */
  chartActivate: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (Platform.OS === 'android') {
      Haptics.selectionAsync();
    }
  },

  /**
   * Slider tick - use for discrete slider positions
   */
  sliderTick: () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.selectionAsync();
    }
  },

  /**
   * Long press activated - use when long press gesture is recognized
   */
  longPress: () => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  },
};

/**
 * Hook for using haptics in components.
 * Returns the haptics object for easy destructuring.
 */
export function useHaptics() {
  return haptics;
}
