/**
 * The bottom navigation tab bar: an opaque surface with a hairline on top, five
 * tabs of a 24 dp glyph over a label. The selected tab fills its glyph and sets its
 * label heavy, the same on both platforms, and a press brightens the tab's glyph and
 * label to the selected colours with no ripple or fade. The bar departs on purpose from
 * the style guide's page, which draws an indicator behind the glyph on Android and one
 * label weight: the platform default is what the bar is not meant to look like.
 */
import { markTabPress } from '@/shared/debug/tabSwitchTiming';
import React, { memo, useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { DENSE_TEXT_SCALE } from './DenseText';
import { FitText } from './FitText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useSegments } from 'expo-router';
import * as haptics from './haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import {
  colors,
  darkColors,
  faceWeight,
  iconSize,
  layers,
  spacing,
  stroke,
  typography,
} from '@/theme';
import { PERF_DEBUG } from '@/shared/debug/renderTimer';
import { navigateTab } from '@/shared/app/navigation';
import { debug } from '@/shared/debug/debug';
import { PressTarget } from './PressTarget';
import { TAB_BAR_HEIGHT, isTabBarRoute } from './tabBarClearance';
import { emitTabReselect, type TabRoute } from './tabReselect';

const log = debug.create('BottomTabBar');

// Labels come from i18n, and each has to fit a fifth of a 320 dp phone at the 1.3 text cap.
// Settings reads a short label of its own: the screen's title is too wide for its slot in
// several locales. Each tab draws its outline glyph unselected and the filled twin selected, so
// every tab shows selection the same way.
const MENU_ITEMS = [
  { key: 'feed', icon: 'home-outline', selectedIcon: 'home', route: '/' },
  { key: 'fitness', icon: 'chart-box-outline', selectedIcon: 'chart-box', route: '/fitness' },
  { key: 'map', icon: 'map-outline', selectedIcon: 'map', route: '/map' },
  { key: 'insights', icon: 'lightbulb-outline', selectedIcon: 'lightbulb', route: '/insights' },
  { key: 'settingsTab', icon: 'cog-outline', selectedIcon: 'cog', route: '/settings' },
] as const satisfies readonly {
  key: string;
  icon: IconName;
  selectedIcon: IconName;
  route: TabRoute;
}[];

// The labels are text and hold 4.5:1 on the bar's `surface`, the glyphs are
// marks and hold 3:1. An unselected tab is an operable control, so it answers
// to the bar as much as the selected one: `textSecondary` for its label and
// `iconSecondary` for its glyph. The selected label is `textPrimary` and the
// selected glyph `controlOn`, the blue every selected control takes. Selection
// is never colour alone: the glyph fills and the label goes heavy, so any one of
// them can fail and the tab still reads as selected. A press takes the selected
// colours and nothing else, so the outline glyph and the light label brighten and
// the fill follows when the navigation lands.

// The shrink floor of a label: every label fits its fifth of a 320 dp phone at
// the text cap well above it.
const LABEL_MIN_FONT_SCALE = 0.8;

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

  const handlePress = useCallback(
    (route: TabRoute) => {
      const isCurrentRoute =
        route === '/' ? pathname === '/' || pathname === '/index' : pathname.startsWith(route);

      // A reselect neither navigates nor ticks: the tab's list goes back to the top.
      if (isCurrentRoute) {
        emitTabReselect(route);
        return;
      }

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

  const totalHeight = TAB_BAR_HEIGHT + insets.bottom;

  return (
    <View
      testID="bottom-tab-bar"
      style={[styles.container, { height: totalHeight }]}
      pointerEvents="box-none"
    >
      <View
        testID="bottom-tab-bar-surface"
        style={[
          styles.surface,
          { backgroundColor: palette.surface, borderTopColor: palette.border },
        ]}
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
            <PressTarget
              key={item.key}
              style={styles.tabItem}
              ripple="none"
              fade={false}
              onPress={() => handlePress(item.route)}
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              {({ pressed }) => {
                const lit = isActive || pressed;
                return (
                  <>
                    <View style={styles.iconContainer}>
                      <Icon
                        testID={`bottom-tab-${item.key}-glyph`}
                        name={isActive ? item.selectedIcon : item.icon}
                        size={iconSize.lg}
                        color={lit ? palette.controlOn : palette.iconSecondary}
                      />
                    </View>
                    <FitText
                      maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                      minimumFontScale={LABEL_MIN_FONT_SCALE}
                      style={[
                        styles.label,
                        isActive ? styles.labelSelected : styles.labelRest,
                        { color: lit ? palette.textPrimary : palette.textSecondary },
                      ]}
                    >
                      {label}
                    </FitText>
                  </>
                );
              }}
            </PressTarget>
          );
        })}
      </View>
    </View>
  );
}

export const BottomTabBar = memo(BottomTabBarComponent);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: layers.tabBar,
    justifyContent: 'flex-end',
  },
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: stroke.hairline,
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
    height: iconSize.lg,
    width: iconSize.lg,
  },
  // The badge style at two weights, light at rest and heavy selected, so the weight carries the
  // selection beside the glyph's fill and the colour. With bold text on each draws one face
  // heavier and the two still differ.
  label: {
    ...typography.badge,
    marginTop: spacing.xs,
  },
  labelRest: {
    fontWeight: faceWeight('400'),
  },
  labelSelected: {
    fontWeight: faceWeight('700'),
  },
});
