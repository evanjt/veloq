import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  I18nManager,
  View,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import { Text } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { Badge, type BadgeTone } from './Badge';
import { Icon } from './Icon';
import * as haptics from './haptics';
import {
  colors,
  colorWithOpacity,
  darkColors,
  duration,
  easing,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { PressTarget } from '@/shared/ui/PressTarget';
import { layoutTabStrip, scrollOffsetToShow } from '@/shared/ui/tabStripLayout';
import { pagerPanDecision } from '@/shared/ui/pagerPanDecision';
import { pageAccessibility } from './pagerAccessibility';
import { isReduceMotionOn } from './reduceMotion';
import { composeAccessibilityLabel } from './accessibilityLabel';
import { useGestureCallback } from './useGestureCallback';

// Gesture thresholds
const SWIPE_THRESHOLD_RATIO = 0.2; // 20% of screen width
const VELOCITY_THRESHOLD = 400; // pixels per second

// Timing config for smooth, non-bouncy animation
const TIMING_CONFIG = {
  duration: duration.standard,
  easing: easing.standard,
};

// Horizontal padding inside each tab, either side of its content
const TAB_PADDING = spacing.sm;

export interface SwipeableTab {
  key: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  /** A tab names a place, so its badge is a count at most; a result lives on its page. */
  count?: number;
}

/** A tab's name with the count it draws. */
function tabAccessibilityLabel(tab: SwipeableTab): string {
  return composeAccessibilityLabel(tab.label, tab.count);
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

/** The ink a tab draws its icon and its label in, one per state. */
function tabInk(isActive: boolean, isDark: boolean): string {
  const palette = isDark ? darkColors : colors;
  return isActive ? palette.textPrimary : palette.textSecondary;
}

/** A count is a count on the selected tab and quiet on the others. */
function tabBadgeTone(isActive: boolean): BadgeTone {
  return isActive ? 'count' : 'neutral';
}

function TabContent({
  tab,
  isActive,
  isDark,
  testID,
  onLayout,
}: {
  tab: SwipeableTab;
  isActive: boolean;
  isDark: boolean;
  testID: string;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ink = tabInk(isActive, isDark);
  return (
    <View testID={testID} style={styles.tabContent} onLayout={onLayout}>
      <Icon name={tab.icon} size={iconSize.md} color={ink} />
      <Text
        // The tabs share the width with `flex: 1`, so a label wider than its
        // share used to wrap mid-word and the icon ended up between the halves:
        // five tabs at 1080 wide gave "Insight" over "s". Truncating says the
        // same thing and stays a row.
        numberOfLines={1}
        style={[styles.tabText, isActive && styles.tabTextActive, { color: ink }]}
      >
        {tab.label}
      </Text>
      {tab.count !== undefined ? (
        <Badge
          tone={tabBadgeTone(isActive)}
          size="sm"
          text={tab.count}
          isDark={isDark}
          testID={`tab-badge-${tab.key}`}
        />
      ) : null}
    </View>
  );
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
  const { width: windowWidth } = useWindowDimensions();
  // A page is as wide as the pager's host, which a readable column or a split window makes
  // narrower than the window. The window stands in until the host is first measured.
  const [hostWidth, setHostWidth] = useState<number | null>(null);
  const pageWidth = hostWidth ?? windowWidth;
  const handleHostLayout = useCallback((event: LayoutChangeEvent) => {
    setHostWidth(event.nativeEvent.layout.width);
  }, []);
  const swipeThreshold = pageWidth * SWIPE_THRESHOLD_RATIO;
  const maxOffset = -pageWidth * (tabCount - 1);

  // Track which tabs have been visited (for lazy rendering)
  const visitedRef = useRef<Set<number>>(new Set([0])); // First tab always visited

  // Find initial tab index
  const getTabIndex = useCallback((key: string) => tabs.findIndex((t) => t.key === key), [tabs]);
  const initialIndex = Math.max(0, getTabIndex(activeTab));

  const translateX = useSharedValue(-pageWidth * initialIndex);
  const indicatorProgress = useSharedValue(initialIndex);
  // Track active tab index in shared value for worklet access
  const activeTabIndex = useSharedValue(initialIndex);
  // Where the current touch began, in window coordinates, and whether the
  // pager has taken it
  const touchStartX = useSharedValue(0);
  const panTaken = useSharedValue(false);
  const isRTL = I18nManager.isRTL;

  // Width each tab needs for its icon, label and badge, reported by the hidden
  // measuring row, where nothing constrains a tab and every label takes the
  // selected weight, so a selection never moves the strip between layouts.
  const [contentWidths, setContentWidths] = useState<number[]>([]);
  const available = pageWidth - spacing.md * 2;
  const stripLayout = useMemo(
    () =>
      layoutTabStrip(
        tabs.map((_, i) => (contentWidths[i] ?? 0) + TAB_PADDING * 2),
        available
      ),
    [tabs, contentWidths, available]
  );
  const { scrolls, widths: tabWidths, offsets: tabOffsets, contentWidth } = stripLayout;
  const scrollRef = useRef<ScrollViewInstance>(null);

  const handleContentLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setContentWidths((prev) => {
      if (prev[index] === width) return prev;
      const next = prev.slice();
      next[index] = width;
      return next;
    });
  }, []);

  const triggerHaptic = useCallback(() => {
    haptics.selection();
  }, []);

  // A swipe settles by index, so the worklet captures neither the tabs nor
  // the screen's callback.
  const settleOnTab = useGestureCallback(
    useCallback(
      (index: number) => {
        const tab = tabs[index];
        if (!tab) return;
        triggerHaptic();
        onTabChange(tab.key);
      },
      [tabs, onTabChange, triggerHaptic]
    )
  );

  // Mark current tab as visited synchronously during render
  // (must happen before the lazy check in the JSX below)
  const currentIndex = getTabIndex(activeTab);
  if (currentIndex >= 0) {
    visitedRef.current.add(currentIndex);
  }
  const exposedIndex = Math.max(0, currentIndex);

  // Sync animation with activeTab state changes (e.g., from tab press), and
  // with the host, since the page offset is a multiple of its width.
  useEffect(() => {
    const targetIndex = getTabIndex(activeTab);
    if (targetIndex < 0) return;
    const targetX = -pageWidth * targetIndex;
    activeTabIndex.value = targetIndex;
    translateX.value = withTiming(targetX, TIMING_CONFIG);
    indicatorProgress.value = withTiming(targetIndex, TIMING_CONFIG);
  }, [activeTab, getTabIndex, pageWidth, translateX, indicatorProgress, activeTabIndex]);

  // In the scrolling strip, bring the active tab into view when it changes or
  // when measuring moves it.
  useEffect(() => {
    if (!scrolls) return;
    const index = getTabIndex(activeTab);
    const offset = tabOffsets[index];
    const width = tabWidths[index];
    if (offset === undefined || width === undefined) return;
    const x = scrollOffsetToShow(
      spacing.md + offset,
      width,
      pageWidth,
      contentWidth + spacing.md * 2
    );
    scrollRef.current?.scrollTo({ x, animated: !isReduceMotionOn() });
  }, [scrolls, activeTab, getTabIndex, tabOffsets, tabWidths, contentWidth, pageWidth]);

  // Memoize pan gesture to prevent recreation on every render
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(gestureEnabled)
        // Decided by hand so a swipe the pager cannot use, or one from the
        // leading edge, fails and is left to the system back swipe.
        .manualActivation(true)
        .onTouchesDown((e) => {
          'worklet';
          // A second finger joins the touch already being decided.
          const touch = e.allTouches[0];
          if (!touch || e.allTouches.length > 1) return;
          touchStartX.value = touch.absoluteX;
          panTaken.value = false;
        })
        .onTouchesMove((e, mgr) => {
          'worklet';
          const touch = e.allTouches[0];
          if (panTaken.value || !touch) return;
          const decision = pagerPanDecision({
            index: activeTabIndex.value,
            tabCount,
            startX: touchStartX.value,
            translationX: touch.absoluteX - touchStartX.value,
            // The touch is in window coordinates, and so is the system's back-swipe edge.
            screenWidth: windowWidth,
            isRTL,
          });
          if (decision === 'activate') {
            panTaken.value = true;
            mgr.activate();
          } else if (decision === 'fail') mgr.fail();
        })
        .onUpdate((event) => {
          'worklet';
          const currentOffset = -pageWidth * activeTabIndex.value;
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
          const currentOffset = -pageWidth * activeTabIndex.value;
          const distance = translateX.value - currentOffset;

          let targetTabIndex = activeTabIndex.value;

          // Determine target based on swipe distance or velocity
          if (Math.abs(distance) > swipeThreshold || Math.abs(velocity) > VELOCITY_THRESHOLD) {
            if (distance < 0 && velocity <= 0) {
              // Swiped left -> go to next tab
              targetTabIndex = Math.min(tabCount - 1, activeTabIndex.value + 1);
            } else if (distance > 0 && velocity >= 0) {
              // Swiped right -> go to previous tab
              targetTabIndex = Math.max(0, activeTabIndex.value - 1);
            }
          }

          const targetX = -pageWidth * targetTabIndex;
          translateX.value = withTiming(targetX, TIMING_CONFIG);
          indicatorProgress.value = withTiming(targetTabIndex, TIMING_CONFIG);

          if (targetTabIndex !== activeTabIndex.value) {
            runOnJS(settleOnTab)(targetTabIndex);
          }
        }),
    [
      translateX,
      indicatorProgress,
      activeTabIndex,
      touchStartX,
      panTaken,
      isRTL,
      settleOnTab,
      tabCount,
      maxOffset,
      pageWidth,
      windowWidth,
      swipeThreshold,
      gestureEnabled,
    ]
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // The underline marks the selected tab, so it is the on role of the theme.
  const indicatorFill = isDark ? darkColors.controlOn : colors.controlOn;
  const stripGround = isDark ? darkColors.surfacePage : colors.surfacePage;
  // Animated underline indicator: follows the measured left edge and width of
  // the tab under it, equal shares or content widths alike.
  const indicatorStyle = useAnimatedStyle(() => {
    if (tabCount < 2) return { width: tabWidths[0] ?? 0 };
    const indexes = tabWidths.map((_, i) => i);
    return {
      transform: [
        {
          translateX: interpolate(
            indicatorProgress.value,
            indexes,
            tabOffsets,
            Extrapolation.CLAMP
          ),
        },
      ],
      width: interpolate(indicatorProgress.value, indexes, tabWidths, Extrapolation.CLAMP),
    };
  }, [tabCount, tabWidths, tabOffsets]);

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
    <View testID="swipeable-tabs" style={styles.container} onLayout={handleHostLayout}>
      {/* Material-style Tab Bar - equal tabs while every label fits, else a scrolling strip of content-sized tabs */}
      <View
        accessibilityRole="tablist"
        style={[styles.tabBar, scrolls && styles.tabBarScrolling, isDark && styles.tabBarDark]}
      >
        {/* Each tab at its natural width, measured where no share can squeeze it */}
        <ScrollView
          testID="tab-measure-row"
          horizontal
          scrollEnabled={false}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.measureRow}
        >
          {tabs.map((tab, index) => (
            <TabContent
              key={tab.key}
              tab={tab}
              isActive
              isDark={isDark}
              testID={`tab-measure-${tab.key}`}
              onLayout={(event) => handleContentLayout(index, event)}
            />
          ))}
        </ScrollView>
        {scrolls ? (
          <>
            <ScrollView
              ref={scrollRef}
              testID="tab-strip-scroll"
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabScrollContent}
            >
              {tabs.map((tab, index) => {
                const isActive = activeTab === tab.key;
                return (
                  <PressTarget
                    key={tab.key}
                    testID={`tab-${tab.key}`}
                    style={{ ...styles.tab, flex: 0, width: tabWidths[index] }}
                    onPress={() => handleTabPress(tab.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={tabAccessibilityLabel(tab)}
                  >
                    <TabContent
                      tab={tab}
                      isActive={isActive}
                      isDark={isDark}
                      testID={`tab-content-${tab.key}`}
                    />
                  </PressTarget>
                );
              })}
              {/* Animated underline indicator */}
              <Animated.View
                testID="tab-indicator"
                style={[styles.indicator, { backgroundColor: indicatorFill }, indicatorStyle]}
              />
            </ScrollView>
            <LinearGradient
              testID="tab-strip-fade"
              colors={[colorWithOpacity(stripGround, 0), stripGround]}
              start={{ x: isRTL ? 1 : 0, y: 0 }}
              end={{ x: isRTL ? 0 : 1, y: 0 }}
              style={styles.trailingFade}
              pointerEvents="none"
            />
          </>
        ) : (
          <>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <PressTarget
                  key={tab.key}
                  testID={`tab-${tab.key}`}
                  style={styles.tab}
                  onPress={() => handleTabPress(tab.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={tabAccessibilityLabel(tab)}
                >
                  <TabContent
                    tab={tab}
                    isActive={isActive}
                    isDark={isDark}
                    testID={`tab-content-${tab.key}`}
                  />
                </PressTarget>
              );
            })}
            {/* Animated underline indicator */}
            <Animated.View
              testID="tab-indicator"
              style={[styles.indicator, { backgroundColor: indicatorFill }, indicatorStyle]}
            />
          </>
        )}
      </View>

      {/* Swipeable Content - N pages */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[styles.contentContainer, { width: pageWidth * tabCount }, contentStyle]}
        >
          {React.Children.toArray(children).map((child, index) => (
            <View
              key={index}
              testID={`tab-page-${tabs[index]?.key ?? index}`}
              style={{ width: pageWidth }}
              {...pageAccessibility(index, exposedIndex)}
            >
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
    backgroundColor: colors.surfacePage,
    borderBottomWidth: stroke.one,
    borderBottomColor: colors.border,
    position: 'relative',
  },
  tabBarScrolling: {
    paddingHorizontal: 0,
  },
  tabScrollContent: {
    paddingHorizontal: spacing.md,
  },
  measureRow: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    opacity: 0,
  },
  trailingFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    end: 0,
    width: spacing.lg,
  },
  tabBarDark: {
    backgroundColor: darkColors.surfacePage,
    borderBottomColor: darkColors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.smPlus,
    paddingHorizontal: TAB_PADDING,
    minHeight: layout.minTapTarget,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  tabText: {
    ...typography.bodySmall,
  },
  tabTextActive: {
    fontWeight: typography.bodySmallBold.fontWeight,
  },
  indicator: {
    position: 'absolute',
    bottom: 0,
    left: spacing.md,
    height: stroke.three,
    borderTopLeftRadius: layout.borderRadiusXs,
    borderTopRightRadius: layout.borderRadiusXs,
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    // Width is set dynamically based on tab count
  },
});
