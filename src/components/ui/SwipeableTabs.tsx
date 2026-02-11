import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Dimensions, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, darkColors, spacing } from '@/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Gesture thresholds
const SWIPE_THRESHOLD_RATIO = 0.2; // 20% of screen width
const SWIPE_THRESHOLD = SCREEN_WIDTH * SWIPE_THRESHOLD_RATIO;
const VELOCITY_THRESHOLD = 400; // pixels per second

// Timing config for smooth, non-bouncy animation
const ANIMATION_DURATION_MS = 250;
const TIMING_CONFIG = {
  duration: ANIMATION_DURATION_MS,
  easing: Easing.out(Easing.cubic),
};

// Gesture activation offset (prevents accidental swipes)
const GESTURE_ACTIVATION_OFFSET = 10;

export interface SwipeableTab {
  key: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  count?: number;
}

interface SwipeableTabsProps {
  /** Array of tabs (supports 2+ tabs) */
  tabs: SwipeableTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  isDark: boolean;
  /** One child per tab */
  children: React.ReactNode[];
  /** Whether swipe gesture is enabled (default: true) */
  gestureEnabled?: boolean;
  /** Only mount tab content once visited (default: false for backward compatibility) */
  lazy?: boolean;
}

export function SwipeableTabs({
  tabs,
  activeTab,
  onTabChange,
  isDark,
  children,
  gestureEnabled = true,
  lazy = false,
}: SwipeableTabsProps) {
  const tabCount = tabs.length;
  const maxOffset = -SCREEN_WIDTH * (tabCount - 1);

  // Track which tabs have been visited (for lazy rendering)
  const visitedRef = useRef<Set<number>>(new Set([0])); // First tab always visited

  // Find initial tab index
  const getTabIndex = (key: string) => tabs.findIndex((t) => t.key === key);
  const initialIndex = Math.max(0, getTabIndex(activeTab));

  const translateX = useSharedValue(-SCREEN_WIDTH * initialIndex);
  const indicatorProgress = useSharedValue(initialIndex);
  // Track active tab index in shared value for worklet access
  const activeTabIndex = useSharedValue(initialIndex);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const updateTab = useCallback(
    (key: string) => {
      onTabChange(key);
    },
    [onTabChange]
  );

  // Mark current tab as visited synchronously during render
  // (must happen before the lazy check in the JSX below)
  const currentIndex = getTabIndex(activeTab);
  if (currentIndex >= 0) {
    visitedRef.current.add(currentIndex);
  }

  // Sync animation with activeTab state changes (e.g., from tab press)
  useEffect(() => {
    const targetIndex = getTabIndex(activeTab);
    if (targetIndex < 0) return;
    const targetX = -SCREEN_WIDTH * targetIndex;
    activeTabIndex.value = targetIndex;
    translateX.value = withTiming(targetX, TIMING_CONFIG);
    indicatorProgress.value = withTiming(targetIndex, TIMING_CONFIG);
  }, [activeTab, tabs, translateX, indicatorProgress, activeTabIndex]);

  // Memoize pan gesture to prevent recreation on every render
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(gestureEnabled)
        .activeOffsetX([-GESTURE_ACTIVATION_OFFSET, GESTURE_ACTIVATION_OFFSET])
        .onUpdate((event) => {
          'worklet';
          const currentOffset = -SCREEN_WIDTH * activeTabIndex.value;
          let newTranslateX = currentOffset + event.translationX;
          // Clamp between maxOffset and 0
          newTranslateX = Math.max(maxOffset, Math.min(0, newTranslateX));
          translateX.value = newTranslateX;
          // Update indicator based on content position (0 to tabCount-1)
          indicatorProgress.value = interpolate(newTranslateX, [0, maxOffset], [0, tabCount - 1]);
        })
        .onEnd((event) => {
          'worklet';
          const velocity = event.velocityX;
          const currentOffset = -SCREEN_WIDTH * activeTabIndex.value;
          const distance = translateX.value - currentOffset;

          let targetTabIndex = activeTabIndex.value;

          // Determine target based on swipe distance or velocity
          if (Math.abs(distance) > SWIPE_THRESHOLD || Math.abs(velocity) > VELOCITY_THRESHOLD) {
            if (distance < 0 && velocity <= 0) {
              // Swiped left -> go to next tab
              targetTabIndex = Math.min(tabCount - 1, activeTabIndex.value + 1);
            } else if (distance > 0 && velocity >= 0) {
              // Swiped right -> go to previous tab
              targetTabIndex = Math.max(0, activeTabIndex.value - 1);
            }
          }

          const targetX = -SCREEN_WIDTH * targetTabIndex;
          translateX.value = withTiming(targetX, TIMING_CONFIG);
          indicatorProgress.value = withTiming(targetTabIndex, TIMING_CONFIG);

          if (targetTabIndex !== activeTabIndex.value) {
            runOnJS(triggerHaptic)();
            runOnJS(updateTab)(tabs[targetTabIndex].key);
          }
        }),
    [
      translateX,
      indicatorProgress,
      activeTabIndex,
      triggerHaptic,
      updateTab,
      tabs,
      tabCount,
      maxOffset,
      gestureEnabled,
    ]
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Animated underline indicator - works with N tabs
  const indicatorStyle = useAnimatedStyle(() => {
    const tabWidth = (SCREEN_WIDTH - spacing.md * 2) / tabCount;
    return {
      transform: [{ translateX: indicatorProgress.value * tabWidth }],
      width: tabWidth,
    };
  });

  const handleTabPress = useCallback(
    (key: string) => {
      if (key !== activeTab) {
        triggerHaptic();
        onTabChange(key);
      }
    },
    [activeTab, onTabChange, triggerHaptic]
  );

  return (
    <View style={styles.container}>
      {/* Material-style Tab Bar - dynamically rendered */}
      <View style={[styles.tabBar, isDark && styles.tabBarDark]}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable key={tab.key} style={styles.tab} onPress={() => handleTabPress(tab.key)}>
              <MaterialCommunityIcons
                name={tab.icon}
                size={18}
                color={
                  isActive ? colors.primary : isDark ? darkColors.textMuted : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.tabText,
                  isActive && styles.tabTextActive,
                  isDark && !isActive && styles.tabTextDark,
                ]}
              >
                {tab.label}
              </Text>
              {tab.count !== undefined && (
                <View
                  style={[
                    styles.tabBadge,
                    isActive ? styles.tabBadgeActive : isDark && styles.tabBadgeDark,
                  ]}
                >
                  <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                    {tab.count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Animated underline indicator */}
        <Animated.View style={[styles.indicator, indicatorStyle]} />
      </View>

      {/* Swipeable Content - N pages */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[styles.contentContainer, { width: SCREEN_WIDTH * tabCount }, contentStyle]}
        >
          {React.Children.toArray(children).map((child, index) => (
            <View key={index} style={styles.page}>
              {lazy && !visitedRef.current.has(index) ? null : child}
            </View>
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    position: 'relative',
  },
  tabBarDark: {
    backgroundColor: darkColors.background,
    borderBottomColor: darkColors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  tabTextDark: {
    color: darkColors.textMuted,
  },
  tabBadge: {
    backgroundColor: colors.gray200,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  tabBadgeDark: {
    backgroundColor: darkColors.border,
  },
  tabBadgeActive: {
    backgroundColor: colors.primary,
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabBadgeTextActive: {
    color: colors.textOnPrimary,
  },
  indicator: {
    position: 'absolute',
    bottom: 0,
    left: spacing.md,
    height: 3,
    backgroundColor: colors.primary,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    // Width is set dynamically based on tab count
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
});
