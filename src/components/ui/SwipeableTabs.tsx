import React, { useCallback, useEffect } from 'react';
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
import { colors, spacing } from '@/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.2;
const VELOCITY_THRESHOLD = 400;

// Timing config for smooth, non-bouncy animation
const TIMING_CONFIG = {
  duration: 250,
  easing: Easing.out(Easing.cubic),
};

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

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const updateTab = useCallback((key: string) => {
    onTabChange(key);
  }, [onTabChange]);

  // Sync animation with activeTab state changes (e.g., from tab press)
  useEffect(() => {
    const targetX = activeTab === tabs[0].key ? 0 : -SCREEN_WIDTH;
    const targetIndicator = activeTab === tabs[0].key ? 0 : 1;
    translateX.value = withTiming(targetX, TIMING_CONFIG);
    indicatorProgress.value = withTiming(targetIndicator, TIMING_CONFIG);
  }, [activeTab, tabs, translateX, indicatorProgress]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onUpdate((event) => {
      'worklet';
      const currentOffset = activeTab === tabs[0].key ? 0 : -SCREEN_WIDTH;
      let newTranslateX = currentOffset + event.translationX;
      // Clamp between -SCREEN_WIDTH and 0
      newTranslateX = Math.max(-SCREEN_WIDTH, Math.min(0, newTranslateX));
      translateX.value = newTranslateX;
      // Update indicator based on content position
      indicatorProgress.value = interpolate(
        newTranslateX,
        [0, -SCREEN_WIDTH],
        [0, 1]
      );
    })
    .onEnd((event) => {
      'worklet';
      const velocity = event.velocityX;
      const currentOffset = activeTab === tabs[0].key ? 0 : -SCREEN_WIDTH;
      const distance = translateX.value - currentOffset;

      let targetTab = activeTab;

      // Determine target based on swipe distance or velocity
      if (Math.abs(distance) > SWIPE_THRESHOLD || Math.abs(velocity) > VELOCITY_THRESHOLD) {
        if (distance < 0 && velocity <= 0) {
          // Swiped left -> go to sections (second tab)
          targetTab = tabs[1].key;
        } else if (distance > 0 && velocity >= 0) {
          // Swiped right -> go to routes (first tab)
          targetTab = tabs[0].key;
        }
      }

      const targetX = targetTab === tabs[0].key ? 0 : -SCREEN_WIDTH;
      const targetIndicator = targetTab === tabs[0].key ? 0 : 1;
      translateX.value = withTiming(targetX, TIMING_CONFIG);
      indicatorProgress.value = withTiming(targetIndicator, TIMING_CONFIG);

      if (targetTab !== activeTab) {
        runOnJS(triggerHaptic)();
        runOnJS(updateTab)(targetTab);
      }
    });

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

  const handleTabPress = useCallback((key: string) => {
    if (key !== activeTab) {
      triggerHaptic();
      onTabChange(key);
    }
  }, [activeTab, onTabChange, triggerHaptic]);

  return (
    <View style={styles.container}>
      {/* Material-style Tab Bar */}
      <View style={[styles.tabBar, isDark && styles.tabBarDark]}>
        <Pressable
          style={styles.tab}
          onPress={() => handleTabPress(tabs[0].key)}
        >
          <MaterialCommunityIcons
            name={tabs[0].icon}
            size={18}
            color={activeTab === tabs[0].key ? colors.primary : (isDark ? '#888' : colors.textSecondary)}
          />
          <Text style={[
            styles.tabText,
            activeTab === tabs[0].key && styles.tabTextActive,
            isDark && !activeTab.includes(tabs[0].key) && styles.tabTextDark,
          ]}>
            {tabs[0].label}
          </Text>
          <View style={[
            styles.tabBadge,
            activeTab === tabs[0].key ? styles.tabBadgeActive : (isDark && styles.tabBadgeDark),
          ]}>
            <Text style={[
              styles.tabBadgeText,
              activeTab === tabs[0].key && styles.tabBadgeTextActive,
            ]}>
              {tabs[0].count}
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={styles.tab}
          onPress={() => handleTabPress(tabs[1].key)}
        >
          <MaterialCommunityIcons
            name={tabs[1].icon}
            size={18}
            color={activeTab === tabs[1].key ? colors.primary : (isDark ? '#888' : colors.textSecondary)}
          />
          <Text style={[
            styles.tabText,
            activeTab === tabs[1].key && styles.tabTextActive,
            isDark && !activeTab.includes(tabs[1].key) && styles.tabTextDark,
          ]}>
            {tabs[1].label}
          </Text>
          <View style={[
            styles.tabBadge,
            activeTab === tabs[1].key ? styles.tabBadgeActive : (isDark && styles.tabBadgeDark),
          ]}>
            <Text style={[
              styles.tabBadgeText,
              activeTab === tabs[1].key && styles.tabBadgeTextActive,
            ]}>
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
    borderBottomColor: '#E0E0E0',
    position: 'relative',
  },
  tabBarDark: {
    backgroundColor: '#121212',
    borderBottomColor: '#333',
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
    color: '#888',
  },
  tabBadge: {
    backgroundColor: '#E8E8E8',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  tabBadgeDark: {
    backgroundColor: '#333',
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
    color: '#FFFFFF',
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
