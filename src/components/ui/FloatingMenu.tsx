/**
 * Floating bottom navigation menu.
 * Dark pill-shaped bar with icons, hides on scroll down, shows on scroll up.
 */
import React, { memo, useContext, useCallback, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View, useWindowDimensions, Platform } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ScrollVisibilityContext } from '@/providers/ScrollVisibilityContext';
import { colors } from '@/theme';

// Menu items with routes and icons (outline variants for clean look)
const MENU_ITEMS = [
  { key: 'feed', icon: 'home-outline', route: '/', label: 'Feed' },
  { key: 'fitness', icon: 'chart-line', route: '/fitness', label: 'Fitness' },
  { key: 'map', icon: 'map-outline', route: '/map', label: 'Map' },
  { key: 'training', icon: 'calendar-outline', route: '/training', label: 'Training' },
  { key: 'wellness', icon: 'heart-outline', route: '/wellness', label: 'Wellness' },
] as const;

// Responsive breakpoints
const NARROW_SCREEN_WIDTH = 375;

// Menu dimensions
const MENU_HEIGHT = 64; // Increased from 56
const MENU_BORDER_RADIUS = 32; // Half of height for pill shape
const BOTTOM_OFFSET_BASE = 20; // Increased from 12 - higher position

function FloatingMenuComponent() {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Get scroll visibility context (may be null if not in provider)
  const scrollContext = useContext(ScrollVisibilityContext);
  // Fallback shared value for when context is not available
  const fallbackTranslateY = useSharedValue(0);
  const translateY = scrollContext?.translateY ?? fallbackTranslateY;

  // Memoize responsive sizing calculations
  const { isNarrow, menuWidth, iconSize, tapTargetSize, bottomOffset } = useMemo(() => {
    const narrow = screenWidth < NARROW_SCREEN_WIDTH;
    return {
      isNarrow: narrow,
      menuWidth: narrow ? screenWidth * 0.9 : Math.min(screenWidth * 0.78, 320),
      iconSize: narrow ? 24 : 26,
      tapTargetSize: narrow ? 48 : 52,
      bottomOffset: Math.max(insets.bottom, 16) + BOTTOM_OFFSET_BASE,
    };
  }, [screenWidth, insets.bottom]);

  // Animated style for hide/show
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  // Memoize navigation handler - haptics fire-and-forget (no await)
  // Use navigate() to reuse existing screens from history when possible
  // Skip navigation if already on the target route
  const handlePress = useCallback(
    (route: string) => {
      // Check if already on this route - skip navigation to prevent remount
      const isCurrentRoute =
        route === '/' ? pathname === '/' || pathname === '/index' : pathname.startsWith(route);

      if (isCurrentRoute) {
        return; // Already here, don't navigate
      }

      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      // Use navigate() - reuses existing screen from history if available
      router.navigate(route as never);
    },
    [pathname]
  );

  // Memoize container style to avoid object recreation
  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        width: menuWidth,
        bottom: bottomOffset,
        left: (screenWidth - menuWidth) / 2,
      },
      animatedStyle,
    ],
    [menuWidth, bottomOffset, screenWidth, animatedStyle]
  );

  // Memoize tap target style
  const tapTargetStyle = useMemo(
    () => [styles.menuItem, { width: tapTargetSize, height: tapTargetSize }],
    [tapTargetSize]
  );

  return (
    <Animated.View style={containerStyle} pointerEvents="box-none">
      <View style={styles.menuBar}>
        {MENU_ITEMS.map((item) => {
          // Inline active check is fast - pathname comparison is O(1)
          const isActive =
            item.route === '/'
              ? pathname === '/' || pathname === '/index'
              : pathname.startsWith(item.route);
          return (
            <TouchableOpacity
              key={item.key}
              style={tapTargetStyle}
              onPress={() => handlePress(item.route)}
              activeOpacity={0.7}
              accessibilityLabel={item.label}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <View style={[styles.iconWrapper, isActive && styles.iconWrapperActive]}>
                <MaterialCommunityIcons
                  name={item.icon as never}
                  size={iconSize}
                  color={isActive ? '#FFFFFF' : '#888888'}
                />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

// Memoize the entire component to prevent re-renders from parent
export const FloatingMenu = memo(FloatingMenuComponent);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 1000,
  },
  menuBar: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    height: MENU_HEIGHT,
    borderRadius: MENU_BORDER_RADIUS,
    backgroundColor: 'rgba(20, 20, 20, 0.94)',
    // Shadow for elevation
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  menuItem: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  iconWrapperActive: {
    backgroundColor: colors.primary,
  },
});
