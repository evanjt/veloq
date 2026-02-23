/**
 * Minimalist bottom navigation tab bar.
 * Gradient fade from content, subtle icons and labels.
 * Map tab (center) supports long-press to start recording.
 * During recording, Map tab shows pulsing red dot and navigates to recording screen.
 */
import React, { memo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Platform, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { brand } from '@/theme';
import { PERF_DEBUG } from '@/lib/debug/renderTimer';
import { useRecordingStore } from '@/providers/RecordingStore';

// Menu items with routes and icons (labels come from i18n)
const MENU_ITEMS = [
  { key: 'feed', icon: 'home-outline', route: '/' },
  { key: 'fitness', icon: 'chart-line', route: '/fitness' },
  { key: 'map', icon: 'map-outline', route: '/map' },
  { key: 'routes', icon: 'map-marker-path', route: '/routes' },
  { key: 'health', icon: 'heart-pulse', route: '/training' },
] as const;

// Dimensions
export const TAB_BAR_HEIGHT = 60; // Height for icons + labels
export const GRADIENT_HEIGHT = 20; // Small fade zone above icons
export const TAB_BAR_SAFE_PADDING = TAB_BAR_HEIGHT + GRADIENT_HEIGHT; // Total padding for content
const ICON_SIZE = 26;
const RECORDING_DOT_SIZE = 8;

// Colors - WCAG AA requires 3:1 for icons, 4.5:1 for text
const INACTIVE_COLOR_DARK = 'rgba(255, 255, 255, 0.55)'; // Muted but visible
const INACTIVE_COLOR_LIGHT = 'rgba(0, 0, 0, 0.45)'; // Muted but visible
const ACTIVE_COLOR_DARK = '#FFFFFF'; // Bright white - pops
const ACTIVE_COLOR_LIGHT = '#000000'; // Solid black - pops

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

  const recordingStatus = useRecordingStore((s) => s.status);
  const recordingType = useRecordingStore((s) => s.activityType);
  const isRecording = recordingStatus === 'recording' || recordingStatus === 'paused';

  // Pulsing animation for recording dot
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (recordingStatus === 'recording') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
  }, [recordingStatus, pulseAnim]);

  // Colors with proper contrast for accessibility
  const activeColor = isDark ? ACTIVE_COLOR_DARK : brand.tealLight;
  const inactiveColor = isDark ? INACTIVE_COLOR_DARK : INACTIVE_COLOR_LIGHT;

  // Gradient: smooth fade, slightly transparent at bottom (92% max)
  const gradientColors = isDark
    ? ([
        'transparent',
        'rgba(0, 0, 0, 0.35)',
        'rgba(0, 0, 0, 0.6)',
        'rgba(0, 0, 0, 0.8)',
        'rgba(0, 0, 0, 0.9)',
        'rgba(0, 0, 0, 0.92)',
      ] as const)
    : ([
        'transparent',
        'rgba(255, 255, 255, 0.35)',
        'rgba(255, 255, 255, 0.6)',
        'rgba(255, 255, 255, 0.8)',
        'rgba(255, 255, 255, 0.9)',
        'rgba(255, 255, 255, 0.92)',
      ] as const);

  const handlePress = useCallback(
    (route: string, key: string) => {
      // During recording, Map tab navigates to recording screen instead
      if (key === 'map' && isRecording && recordingType) {
        router.navigate(`/recording/${recordingType}` as never);
        return;
      }

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
      router.navigate(route as never);
    },
    [pathname, isRecording, recordingType]
  );

  const handleMapLongPress = useCallback(() => {
    if (isRecording) return; // Already recording, don't open selector
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/record' as never);
  }, [isRecording]);

  const totalHeight = GRADIENT_HEIGHT + TAB_BAR_HEIGHT + insets.bottom;

  return (
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

          const isMapTab = item.key === 'map';
          const label = t(`navigation.${item.key}`);

          return (
            <TouchableOpacity
              key={item.key}
              style={styles.tabItem}
              onPress={() => handlePress(item.route, item.key)}
              onLongPress={isMapTab ? handleMapLongPress : undefined}
              delayLongPress={400}
              activeOpacity={0.6}
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.iconContainer}>
                {isMapTab && isRecording ? (
                  <Animated.View style={[styles.recordingDot, { opacity: pulseAnim }]} />
                ) : (
                  <MaterialCommunityIcons
                    name={item.icon as never}
                    size={isActive ? ICON_SIZE + 2 : ICON_SIZE}
                    color={isActive ? activeColor : inactiveColor}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  {
                    color:
                      isMapTab && isRecording ? '#FC4C02' : isActive ? activeColor : inactiveColor,
                  },
                  isActive && styles.labelActive,
                ]}
                numberOfLines={1}
              >
                {isMapTab && isRecording ? t('recording.recording') : label}
              </Text>
            </TouchableOpacity>
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
  recordingDot: {
    width: RECORDING_DOT_SIZE,
    height: RECORDING_DOT_SIZE,
    borderRadius: RECORDING_DOT_SIZE / 2,
    backgroundColor: '#FC4C02',
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
  },
  labelActive: {
    fontWeight: '700',
  },
});
