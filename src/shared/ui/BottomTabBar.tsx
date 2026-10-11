/**
 * Minimalist bottom navigation tab bar.
 * Gradient fade from content, subtle icons and labels.
 */
import { markTabPress } from '@/shared/debug/tabSwitchTiming';
import React, { memo, useCallback, useRef } from 'react';
import { StyleSheet, Pressable, View, Text } from 'react-native';

import { DENSE_TEXT_SCALE } from './DenseText';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useSegments } from 'expo-router';
import * as haptics from './haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { colorWithOpacity, colors, darkColors, ink, spacing, typography } from '@/theme';
import { PERF_DEBUG } from '@/shared/debug/renderTimer';
import { navigateTab } from '@/shared/app/navigation';
import { debug } from '@/shared/debug/debug';
import { SyncProgressStrip } from './SyncProgressStrip';
import { pressable, pressRipple } from './pressFeedback';
import { GRADIENT_HEIGHT, TAB_BAR_HEIGHT, isTabBarRoute } from './tabBarClearance';

const log = debug.create('BottomTabBar');

// Labels come from i18n, and each has to fit a fifth of a 320 dp phone at the 1.3 text cap.
const MENU_ITEMS = [
  { key: 'feed', icon: 'home-outline', route: '/' },
  { key: 'fitness', icon: 'chart-line', route: '/fitness' },
  { key: 'map', icon: 'map-outline', route: '/map' },
  { key: 'insights', icon: 'lightbulb-outline', route: '/insights' },
  { key: 'health', icon: 'heart-pulse', route: '/training' },
] as const;

const ICON_SIZE = 26;

// The labels are text and hold 4.5:1, the icons are marks and hold 3:1, both
// over the worst ground the bar can have: its densest scrim stop over content
// of the opposite extreme, #EBEBEB in light and #141414 in dark. An inactive
// tab is an operable control, so it answers to the bar as much as the active
// one. The active tab is told apart by its weight and its icon, with the brand
// carried by the icon: the label is `textPrimary`, 14.9:1 there, since the
// primary teal is 3.14:1 and passes only as the icon's mark.

function BottomTabBarComponent() {
  // Performance: Track render count
  const renderCount = useRef(0);
  renderCount.current++;
  if (PERF_DEBUG) {
    log.log(`[RENDER] BottomTabBar #${renderCount.current}`);
  }

  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const segments = useSegments();
  // Demo mode counts as a session, `enterDemoMode` sets `isAuthenticated`.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const palette = isDark ? darkColors : colors;
  const activeLabel = palette.textPrimary;
  const activeIcon = isDark ? palette.textPrimary : palette.primary;
  const inactiveColor = palette.textSecondary;

  // Gradient: smooth fade, slightly transparent at bottom (92% max)
  const gradientColors = isDark
    ? ([
        'transparent',
        colorWithOpacity(ink.black, 0.35),
        colorWithOpacity(ink.black, 0.6),
        colorWithOpacity(ink.black, 0.8),
        colorWithOpacity(ink.black, 0.9),
        colorWithOpacity(ink.black, 0.92),
      ] as const)
    : ([
        'transparent',
        colorWithOpacity(ink.white, 0.35),
        colorWithOpacity(ink.white, 0.6),
        colorWithOpacity(ink.white, 0.8),
        colorWithOpacity(ink.white, 0.9),
        colorWithOpacity(ink.white, 0.92),
      ] as const);

  const handlePress = useCallback(
    (route: string) => {
      const isCurrentRoute =
        route === '/' ? pathname === '/' || pathname === '/index' : pathname.startsWith(route);

      if (isCurrentRoute) return;

      // Performance: Log navigation start
      if (PERF_DEBUG) {
        log.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        log.log(`[NAV] ${pathname} → ${route}`);
        log.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      }

      haptics.selection();
      markTabPress(route);
      navigateTab(route);
    },
    [pathname]
  );

  // The bar is mounted at the layout root, above the Stack, so a signed-out
  // user would otherwise see five destinations none of them can reach, painted
  // over the login card's footer line.
  if (!isAuthenticated) return null;

  // Stack screens own their whole bottom edge. Drawing the bar over them hides
  // the last rows of a list and lets a stray touch leave a live recording.
  if (!isTabBarRoute(segments)) return null;

  const totalHeight = GRADIENT_HEIGHT + TAB_BAR_HEIGHT + insets.bottom;

  return (
    <>
      {/* The sync pill shows on the tab screens, floating at the top of the page */}
      <SyncProgressStrip />
      <View
        testID="bottom-tab-bar"
        style={[styles.container, { height: totalHeight }]}
        pointerEvents="box-none"
      >
        {/* Smooth gradient fade */}
        <LinearGradient
          colors={gradientColors}
          locations={[0, 0.1, 0.22, 0.38, 0.6, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Icons row - positioned at bottom above safe area */}
        <View accessibilityRole="tablist" style={[styles.tabRow, { marginBottom: insets.bottom }]}>
          {MENU_ITEMS.map((item) => {
            const isActive =
              item.route === '/'
                ? pathname === '/' || pathname === '/index'
                : pathname.startsWith(item.route);

            const label = t(`navigation.${item.key}`);

            return (
              <Pressable
                key={item.key}
                style={pressable(styles.tabItem)}
                android_ripple={pressRipple}
                onPress={() => handlePress(item.route)}
                accessibilityLabel={label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.iconContainer}>
                  <MaterialCommunityIcons
                    name={item.icon as never}
                    size={isActive ? ICON_SIZE + 2 : ICON_SIZE}
                    color={isActive ? activeIcon : inactiveColor}
                  />
                </View>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[
                    styles.label,
                    { color: isActive ? activeLabel : inactiveColor },
                    isActive && styles.labelActive,
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

export const BottomTabBar = memo(BottomTabBarComponent);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    justifyContent: 'flex-end',
  },
  tabRow: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: TAB_BAR_HEIGHT,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: ICON_SIZE + 2,
    width: ICON_SIZE + 2,
  },
  label: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  labelActive: {
    fontWeight: '700',
  },
});
