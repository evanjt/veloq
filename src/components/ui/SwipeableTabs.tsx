import React, { useCallback, useEffect, useMemo } from 'react';
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
  count: number;
}

interface SwipeableTabsProps {
  tabs: [SwipeableTab, SwipeableTab];
  activeTab: string;
  onTabChange: (key: string) => void;
  isDark: boolean;
  children: [React.ReactNode, React.ReactNode];
}

export function SwipeableTabs({
  tabs,
  activeTab,
  onTabChange,
  isDark,
  children,
}: SwipeableTabsProps) {
  const translateX = useSharedValue(activeTab === tabs[0].key ? 0 : -SCREEN_WIDTH);
  const indicatorProgress = useSharedValue(activeTab === tabs[0].key ? 0 : 1);
  // Track active tab index in shared value for worklet access
  const activeTabIndex = useSharedValue(activeTab === tabs[0].key ? 0 : 1);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const updateTab = useCallback(
    (key: string) => {
      onTabChange(key);
    },
    [onTabChange]
  );

  // Sync animation with activeTab state changes (e.g., from tab press)
  useEffect(() => {
    const isFirstTab = activeTab === tabs[0].key;
    const targetX = isFirstTab ? 0 : -SCREEN_WIDTH;
    const targetIndicator = isFirstTab ? 0 : 1;
    activeTabIndex.value = isFirstTab ? 0 : 1;
    translateX.value = withTiming(targetX, TIMING_CONFIG);
    indicatorProgress.value = withTiming(targetIndicator, TIMING_CONFIG);
  }, [activeTab, tabs, translateX, indicatorProgress, activeTabIndex]);

  // Memoize pan gesture to prevent recreation on every render
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-GESTURE_ACTIVATION_OFFSET, GESTURE_ACTIVATION_OFFSET])
        .onUpdate((event) => {
          'worklet';
          const currentOffset = activeTabIndex.value === 0 ? 0 : -SCREEN_WIDTH;
          let newTranslateX = currentOffset + event.translationX;
          // Clamp between -SCREEN_WIDTH and 0
          newTranslateX = Math.max(-SCREEN_WIDTH, Math.min(0, newTranslateX));
          translateX.value = newTranslateX;
          // Update indicator based on content position
          indicatorProgress.value = interpolate(newTranslateX, [0, -SCREEN_WIDTH], [0, 1]);
        })
        .onEnd((event) => {
          'worklet';
          const velocity = event.velocityX;
          const currentOffset = activeTabIndex.value === 0 ? 0 : -SCREEN_WIDTH;
          const distance = translateX.value - currentOffset;

          let targetTabIndex = activeTabIndex.value;

          // Determine target based on swipe distance or velocity
          if (Math.abs(distance) > SWIPE_THRESHOLD || Math.abs(velocity) > VELOCITY_THRESHOLD) {
            if (distance < 0 && velocity <= 0) {
              // Swiped left -> go to second tab
              targetTabIndex = 1;
            } else if (distance > 0 && velocity >= 0) {
              // Swiped right -> go to first tab
              targetTabIndex = 0;
            }
          }

          const targetX = targetTabIndex === 0 ? 0 : -SCREEN_WIDTH;
          const targetIndicator = targetTabIndex === 0 ? 0 : 1;
          translateX.value = withTiming(targetX, TIMING_CONFIG);
          indicatorProgress.value = withTiming(targetIndicator, TIMING_CONFIG);

          if (targetTabIndex !== activeTabIndex.value) {
            runOnJS(triggerHaptic)();
            runOnJS(updateTab)(targetTabIndex === 0 ? tabs[0].key : tabs[1].key);
          }
        }),
    [translateX, indicatorProgress, activeTabIndex, triggerHaptic, updateTab, tabs]
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Animated underline indicator
  const indicatorStyle = useAnimatedStyle(() => {
    const tabWidth = (SCREEN_WIDTH - spacing.md * 2) / 2;
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
      {/* Material-style Tab Bar */}
      <View style={[styles.tabBar, isDark && styles.tabBarDark]}>
        <Pressable style={styles.tab} onPress={() => handleTabPress(tabs[0].key)}>
          <MaterialCommunityIcons
            name={tabs[0].icon}
            size={18}
            color={
              activeTab === tabs[0].key
                ? colors.primary
                : isDark
                  ? darkColors.textMuted
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.tabText,
              activeTab === tabs[0].key && styles.tabTextActive,
              isDark && !activeTab.includes(tabs[0].key) && styles.tabTextDark,
            ]}
          >
            {tabs[0].label}
          </Text>
          <View
            style={[
              styles.tabBadge,
              activeTab === tabs[0].key ? styles.tabBadgeActive : isDark && styles.tabBadgeDark,
            ]}
          >
            <Text
              style={[styles.tabBadgeText, activeTab === tabs[0].key && styles.tabBadgeTextActive]}
            >
              {tabs[0].count}
            </Text>
          </View>
        </Pressable>

        <Pressable style={styles.tab} onPress={() => handleTabPress(tabs[1].key)}>
          <MaterialCommunityIcons
            name={tabs[1].icon}
            size={18}
            color={
              activeTab === tabs[1].key
                ? colors.primary
                : isDark
                  ? darkColors.textMuted
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.tabText,
              activeTab === tabs[1].key && styles.tabTextActive,
              isDark && !activeTab.includes(tabs[1].key) && styles.tabTextDark,
            ]}
          >
            {tabs[1].label}
          </Text>
          <View
            style={[
              styles.tabBadge,
              activeTab === tabs[1].key ? styles.tabBadgeActive : isDark && styles.tabBadgeDark,
            ]}
          >
            <Text
              style={[styles.tabBadgeText, activeTab === tabs[1].key && styles.tabBadgeTextActive]}
            >
              {tabs[1].count}
            </Text>
          </View>
        </Pressable>

        {/* Animated underline indicator */}
        <Animated.View style={[styles.indicator, indicatorStyle]} />
      </View>

      {/* Swipeable Content */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.contentContainer, contentStyle]}>
          <View style={styles.page}>{children[0]}</View>
          <View style={styles.page}>{children[1]}</View>
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
    width: SCREEN_WIDTH * 2,
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
});
