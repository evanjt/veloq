/**
 * Minimalist bottom navigation tab bar.
 * Gradient fade from content, subtle icons and labels.
 * Map tab (center) shows red dot badge; hold + swipe up to start recording.
 * During recording, Map tab shows pulsing red dot and navigates to recording screen.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
  Platform,
  Animated as RNAnimated,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { brand } from '@/theme';
import { useInsightsStore } from '@/providers/InsightsStore';
import { PERF_DEBUG } from '@/lib/debug/renderTimer';
import { navigateTo, navigateTab } from '@/lib';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useRecordingPreferences } from '@/providers/RecordingPreferencesStore';
import { RecordSwipeTarget } from '@/components/recording/RecordSwipeTarget';

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
const RECORDING_DOT_SIZE = 8;
const ACTIVATION_THRESHOLD = 80;

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
  const hasNewInsights = useInsightsStore((s) => s.hasNewInsights);

  const recordingStatus = useRecordingStore((s) => s.status);
  const recordingType = useRecordingStore((s) => s.activityType);
  const isRecording = recordingStatus === 'recording' || recordingStatus === 'paused';

  // Swipe-up gesture shared values
  const overlayVisible = useSharedValue(0);
  const dragY = useSharedValue(0);
  const isActivated = useSharedValue(false);
  const hasTriggeredHaptic = useRef(false);

  // Pulsing animation for recording dot
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;
  useEffect(() => {
    if (recordingStatus === 'recording') {
      const pulse = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          RNAnimated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
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
        navigateTab(`/recording/${recordingType}`);
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
      navigateTab(route);
    },
    [pathname, isRecording, recordingType]
  );

  // Start recording with default sport type
  const startRecordingWithDefault = useCallback(() => {
    const recentTypes = useRecordingPreferences.getState().recentActivityTypes;
    const defaultType = recentTypes[0] ?? 'Ride';
    navigateTo(`/recording/${defaultType}`);
  }, []);

  const fireHeavyHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }, []);

  const fireMediumHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const dismissOverlay = useCallback(() => {
    overlayVisible.value = withTiming(0, { duration: 150 });
    dragY.value = withSpring(0);
    isActivated.value = false;
    hasTriggeredHaptic.current = false;
  }, [overlayVisible, dragY, isActivated]);

  // Map tab gestures: quick tap navigates, long hold shows swipe-to-record overlay.
  // Exclusive gives Tap priority — if finger lifts within 500ms, Tap wins.
  // Otherwise Pan activates at 500ms for the hold+drag gesture.
  const mapTapGesture = Gesture.Tap()
    .maxDuration(500)
    .onEnd(() => {
      runOnJS(handlePress)('/map', 'map');
    });

  const mapHoldPanGesture = Gesture.Pan()
    .activateAfterLongPress(500)
    .minDistance(0)
    .onStart(() => {
      if (isRecording) return;
      overlayVisible.value = withTiming(1, { duration: 200 });
      runOnJS(fireMediumHaptic)();
    })
    .onUpdate((e) => {
      if (overlayVisible.value < 0.5) return;
      dragY.value = e.translationY;

      if (e.translationY < -ACTIVATION_THRESHOLD && !isActivated.value) {
        isActivated.value = true;
        runOnJS(fireHeavyHaptic)();
      } else if (e.translationY >= -ACTIVATION_THRESHOLD && isActivated.value) {
        isActivated.value = false;
      }
    })
    .onEnd(() => {
      if (isActivated.value) {
        runOnJS(startRecordingWithDefault)();
      }
      runOnJS(dismissOverlay)();
    });

  const mapComposedGesture = Gesture.Exclusive(mapTapGesture, mapHoldPanGesture);

  const totalHeight = GRADIENT_HEIGHT + TAB_BAR_HEIGHT + insets.bottom;

  return (
    <>
      <RecordSwipeTarget visible={overlayVisible} dragY={dragY} isActivated={isActivated} />
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

            // Map tab uses gesture detector for swipe-up
            if (isMapTab && !isRecording) {
              const mapIconColor = isActive ? activeColor : inactiveColor;
              const sz = isActive ? ICON_SIZE + 2 : ICON_SIZE;
              return (
                <GestureDetector key={item.key} gesture={mapComposedGesture}>
                  <ReAnimated.View
                    style={styles.tabItem}
                    accessibilityLabel={label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                  >
                    <View style={styles.iconContainer}>
                      <MaterialCommunityIcons name="map-outline" size={sz} color={mapIconColor} />
                      <View style={styles.recordDot} />
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
                  </ReAnimated.View>
                </GestureDetector>
              );
            }

            return (
              <TouchableOpacity
                key={item.key}
                style={styles.tabItem}
                onPress={() => handlePress(item.route, item.key)}
                activeOpacity={0.6}
                accessibilityLabel={label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.iconContainer}>
                  {isMapTab && isRecording ? (
                    <RNAnimated.View style={[styles.recordingDot, { opacity: pulseAnim }]} />
                  ) : (
                    <>
                      <MaterialCommunityIcons
                        name={item.icon as never}
                        size={isActive ? ICON_SIZE + 2 : ICON_SIZE}
                        color={isActive ? activeColor : inactiveColor}
                      />
                      {item.key === 'insights' && hasNewInsights && (
                        <View style={styles.notificationDot} />
                      )}
                    </>
                  )}
                </View>
                <Text
                  style={[
                    styles.label,
                    {
                      color:
                        isMapTab && isRecording
                          ? '#FC4C02'
                          : isActive
                            ? activeColor
                            : inactiveColor,
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
  notificationDot: {
    position: 'absolute',
    top: 0,
    right: -4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FC4C02',
  },
  recordDot: {
    position: 'absolute',
    top: 0,
    right: -4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
});
