/**
 * Minimalist bottom navigation tab bar.
 * Gradient fade from content, subtle icons and labels.
 */
import React, { memo, useCallback, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { brand, colorWithOpacity, spacing } from '@/theme';
import { useInsightsStore } from '@/providers/InsightsStore';
import { PERF_DEBUG } from '@/lib/debug/renderTimer';
import { navigateTab } from '@/lib';

// Menu items with routes and icons (labels come from i18n)
const MENU_ITEMS = [
  { key: 'feed', icon: 'home-outline', route: '/' },
  { key: 'fitness', icon: 'chart-line', route: '/fitness' },
  { key: 'map', icon: 'map-outline', route: '/map' },
  { key: 'insights', icon: 'lightbulb-outline', route: '/routes' },
  { key: 'health', icon: 'heart-pulse', route: '/training' },
] as const;

// Dimensions
export const TAB_BAR_HEIGHT = 60; // Height for icons + labels
export const GRADIENT_HEIGHT = 20; // Small fade zone above icons
export const TAB_BAR_SAFE_PADDING = TAB_BAR_HEIGHT + GRADIENT_HEIGHT; // Total padding for content
const ICON_SIZE = 26;

// Colors - WCAG AA requires 3:1 for icons, 4.5:1 for text
const INACTIVE_COLOR_DARK = colorWithOpacity('#FFFFFF', 0.55); // Muted but visible
const INACTIVE_COLOR_LIGHT = colorWithOpacity('#000000', 0.45); // Muted but visible
const ACTIVE_COLOR_DARK = '#FFFFFF'; // Bright white - pops

function BottomTabBarComponent() {
  // Performance: Track render count
  const renderCount = useRef(0);
  renderCount.current++;
  if (PERF_DEBUG) {
    console.log(`[RENDER] BottomTabBar #${renderCount.current}`);
  }

  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const hasNewInsights = useInsightsStore((s) => s.hasNewInsights);

  // Colors with proper contrast for accessibility
  const activeColor = isDark ? ACTIVE_COLOR_DARK : brand.tealLight;
  const inactiveColor = isDark ? INACTIVE_COLOR_DARK : INACTIVE_COLOR_LIGHT;

  // Gradient: smooth fade, slightly transparent at bottom (92% max)
  const gradientColors = isDark
    ? ([
        'transparent',
        colorWithOpacity('#000000', 0.35),
        colorWithOpacity('#000000', 0.6),
        colorWithOpacity('#000000', 0.8),
        colorWithOpacity('#000000', 0.9),
        colorWithOpacity('#000000', 0.92),
      ] as const)
    : ([
        'transparent',
        colorWithOpacity('#FFFFFF', 0.35),
        colorWithOpacity('#FFFFFF', 0.6),
        colorWithOpacity('#FFFFFF', 0.8),
        colorWithOpacity('#FFFFFF', 0.9),
        colorWithOpacity('#FFFFFF', 0.92),
      ] as const);

  const handlePress = useCallback(
    (route: string) => {
      const isCurrentRoute =
        route === '/' ? pathname === '/' || pathname === '/index' : pathname.startsWith(route);

      if (isCurrentRoute) return;

      // Performance: Log navigation start
      if (PERF_DEBUG) {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`[NAV] ${pathname} → ${route}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      }

      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      navigateTab(route);
    },
    [pathname]
  );

  const totalHeight = GRADIENT_HEIGHT + TAB_BAR_HEIGHT + insets.bottom;

  return (
    <>
      <View style={[styles.container, { height: totalHeight }]} pointerEvents="box-none">
        {/* Smooth gradient fade */}
        <LinearGradient
          colors={gradientColors}
          locations={[0, 0.1, 0.22, 0.38, 0.6, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Icons row - positioned at bottom above safe area */}
        <View style={[styles.tabRow, { marginBottom: insets.bottom }]}>
          {MENU_ITEMS.map((item) => {
            const isActive =
              item.route === '/'
                ? pathname === '/' || pathname === '/index'
                : pathname.startsWith(item.route);

            const label = t(`navigation.${item.key}`);

            return (
              <TouchableOpacity
                key={item.key}
                style={styles.tabItem}
                onPress={() => handlePress(item.route)}
                activeOpacity={0.6}
                accessibilityLabel={label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.iconContainer}>
                  <MaterialCommunityIcons
                    name={item.icon as never}
                    size={isActive ? ICON_SIZE + 2 : ICON_SIZE}
                    color={isActive ? activeColor : inactiveColor}
                  />
                  {item.key === 'insights' && hasNewInsights && (
                    <View testID="tab-insights-badge" style={styles.notificationDot} />
                  )}
                </View>
                <Text
                  style={[
                    styles.label,
                    { color: isActive ? activeColor : inactiveColor },
                    isActive && styles.labelActive,
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
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
    fontSize: 11,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  labelActive: {
    fontWeight: '700',
  },
  notificationDot: {
    position: 'absolute',
    top: 0,
    right: -4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: brand.orange,
  },
});
