/**
 * Achievement Toast component for celebrating milestones and personal records.
 *
 * Displays an animated toast notification with icon, title, and optional subtitle.
 * Uses React Native Reanimated for smooth entrance/exit animations.
 */

import React, { useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, darkColors, gradients, spacing, shadows } from '@/theme';

export type AchievementType =
  | 'pr'           // Personal Record
  | 'milestone'    // Activity milestone (100th ride, etc.)
  | 'streak'       // Training streak
  | 'peak_form'    // Peak fitness/form
  | 'distance'     // Distance milestone
  | 'elevation'    // Elevation milestone
  | 'custom';      // Custom achievement

interface Achievement {
  type: AchievementType;
  title: string;
  subtitle?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  gradientColors?: readonly [string, string, ...string[]];
}

interface AchievementToastProps {
  /** Position from top (default: uses safe area) */
  topOffset?: number;
  /** Duration to show the toast in ms (default: 4000) */
  displayDuration?: number;
  /** Whether to trigger haptic feedback (default: true) */
  hapticFeedback?: boolean;
}

export interface AchievementToastRef {
  /** Show an achievement toast */
  show: (achievement: Achievement) => void;
  /** Hide the current toast */
  hide: () => void;
}

const ACHIEVEMENT_CONFIG: Record<AchievementType, {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  gradient: readonly [string, string, ...string[]];
  label: string;
}> = {
  pr: {
    icon: 'trophy',
    gradient: gradients.primary,
    label: 'Personal Record',
  },
  milestone: {
    icon: 'flag-checkered',
    gradient: gradients.success,
    label: 'Milestone',
  },
  streak: {
    icon: 'fire',
    gradient: ['#FF6B2C', '#FF9800'] as const,
    label: 'Streak',
  },
  peak_form: {
    icon: 'chart-line-variant',
    gradient: gradients.fitness,
    label: 'Peak Form',
  },
  distance: {
    icon: 'map-marker-distance',
    gradient: gradients.ocean,
    label: 'Distance',
  },
  elevation: {
    icon: 'terrain',
    gradient: gradients.purple,
    label: 'Elevation',
  },
  custom: {
    icon: 'star',
    gradient: gradients.primary,
    label: 'Achievement',
  },
};

export const AchievementToast = forwardRef<AchievementToastRef, AchievementToastProps>(
  function AchievementToast(
    {
      topOffset,
      displayDuration = 4000,
      hapticFeedback = true,
    },
    ref
  ) {
    const insets = useSafeAreaInsets();
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

    const [achievement, setAchievement] = useState<Achievement | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    const translateY = useSharedValue(-150);
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.8);
    const iconScale = useSharedValue(0);
    const iconRotation = useSharedValue(-30);

    const show = useCallback((newAchievement: Achievement) => {
      setAchievement(newAchievement);
      setIsVisible(true);

      // Haptic feedback
      if (hapticFeedback) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }

      // Entrance animation
      translateY.value = withSpring(0, {
        damping: 15,
        stiffness: 300,
      });
      opacity.value = withTiming(1, { duration: 200 });
      scale.value = withSpring(1, {
        damping: 12,
        stiffness: 400,
      });

      // Icon pop animation
      iconScale.value = withDelay(
        150,
        withSpring(1, {
          damping: 8,
          stiffness: 400,
        })
      );
      iconRotation.value = withDelay(
        150,
        withSpring(0, {
          damping: 10,
          stiffness: 300,
        })
      );

      // Auto-hide after duration
      const hideTimeout = setTimeout(() => {
        hide();
      }, displayDuration);

      return () => clearTimeout(hideTimeout);
    }, [hapticFeedback, displayDuration, translateY, opacity, scale, iconScale, iconRotation]);

    const hide = useCallback(() => {
      // Exit animation
      translateY.value = withTiming(-150, {
        duration: 300,
        easing: Easing.in(Easing.cubic),
      });
      opacity.value = withTiming(0, { duration: 250 });
      scale.value = withTiming(0.8, { duration: 300 });
      iconScale.value = withTiming(0, { duration: 200 });

      // Clean up after animation
      setTimeout(() => {
        setIsVisible(false);
        setAchievement(null);
      }, 350);
    }, [translateY, opacity, scale, iconScale]);

    useImperativeHandle(ref, () => ({
      show,
      hide,
    }), [show, hide]);

    const animatedContainerStyle = useAnimatedStyle(() => ({
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    }));

    const animatedIconStyle = useAnimatedStyle(() => ({
      transform: [
        { scale: iconScale.value },
        { rotate: `${iconRotation.value}deg` },
      ],
    }));

    if (!isVisible || !achievement) {
      return null;
    }

    const config = ACHIEVEMENT_CONFIG[achievement.type];
    const icon = achievement.icon || config.icon;
    const gradient = achievement.gradientColors || config.gradient;

    return (
      <Animated.View
        style={[
          styles.container,
          { top: topOffset ?? insets.top + spacing.md },
          animatedContainerStyle,
        ]}
        pointerEvents="box-none"
      >
        <View style={[styles.toast, isDark && styles.toastDark]}>
          {/* Gradient accent bar */}
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientBar}
          />

          {/* Icon container */}
          <Animated.View style={[styles.iconContainer, animatedIconStyle]}>
            <LinearGradient
              colors={gradient}
              style={styles.iconBackground}
            >
              <MaterialCommunityIcons
                name={icon}
                size={24}
                color={colors.textOnPrimary}
              />
            </LinearGradient>
          </Animated.View>

          {/* Content */}
          <View style={styles.content}>
            <Text
              style={[styles.title, isDark && styles.titleDark]}
              numberOfLines={1}
            >
              {achievement.title}
            </Text>
            {achievement.subtitle && (
              <Text
                style={[styles.subtitle, isDark && styles.subtitleDark]}
                numberOfLines={1}
              >
                {achievement.subtitle}
              </Text>
            )}
          </View>

          {/* Trophy/Star accent */}
          <View style={styles.accentContainer}>
            <MaterialCommunityIcons
              name="star-four-points"
              size={16}
              color={isDark ? darkColors.textMuted : colors.chartYellow}
            />
          </View>
        </View>
      </Animated.View>
    );
  }
);

// Hook for using achievement toasts
export function useAchievementToast() {
  const toastRef = React.useRef<AchievementToastRef>(null);

  const showAchievement = useCallback((achievement: Achievement) => {
    toastRef.current?.show(achievement);
  }, []);

  const hideAchievement = useCallback(() => {
    toastRef.current?.hide();
  }, []);

  const ToastComponent = useCallback(
    (props: AchievementToastProps) => (
      <AchievementToast ref={toastRef} {...props} />
    ),
    []
  );

  return {
    showAchievement,
    hideAchievement,
    AchievementToastComponent: ToastComponent,
    toastRef,
  };
}

// Preset achievement creators
export const achievements = {
  personalRecord: (title: string, subtitle?: string): Achievement => ({
    type: 'pr',
    title,
    subtitle,
  }),
  milestone: (title: string, subtitle?: string): Achievement => ({
    type: 'milestone',
    title,
    subtitle,
  }),
  streak: (days: number): Achievement => ({
    type: 'streak',
    title: `${days} Day Streak!`,
    subtitle: 'Keep up the great work',
  }),
  peakForm: (subtitle?: string): Achievement => ({
    type: 'peak_form',
    title: 'Peak Form!',
    subtitle: subtitle || 'You\'re at your best',
  }),
  distanceMilestone: (distance: string): Achievement => ({
    type: 'distance',
    title: `${distance} Milestone!`,
    subtitle: 'Amazing distance achievement',
  }),
  elevationMilestone: (elevation: string): Achievement => ({
    type: 'elevation',
    title: `${elevation} Climbed!`,
    subtitle: 'Impressive elevation gain',
  }),
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 1001,
    elevation: 1001,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingLeft: spacing.sm,
    gap: spacing.sm,
    ...shadows.elevated,
    overflow: 'hidden',
    maxWidth: 400,
    width: '100%',
  },
  toastDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  gradientBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  iconContainer: {
    marginLeft: spacing.xs,
  },
  iconBackground: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    marginLeft: spacing.xs,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  accentContainer: {
    marginRight: spacing.xs,
  },
});
