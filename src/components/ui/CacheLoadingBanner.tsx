/**
 * Global banner showing cache loading and route processing progress.
 * Appears at the top of the app when syncing bounds cache or processing routes.
 * Tapping navigates to cache settings.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useActivityBoundsCache } from '@/hooks';
import { useAuthStore, useRouteMatchStore } from '@/providers';
import { colors } from '@/theme';

export function CacheLoadingBanner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParts = useSegments();
  const { progress: boundsProgress } = useActivityBoundsCache();
  const routeProgress = useRouteMatchStore((s) => s.progress);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Don't show on map screen - it has its own sync indicator
  const isOnMapScreen = routeParts.includes('map' as never);
  // Don't show on routes screen - it has its own indicator via TimelineSlider
  const isOnRoutesScreen = routeParts.includes('routes' as never);

  // Check if we're syncing bounds or processing routes
  const isSyncingBounds = boundsProgress.status === 'syncing';
  const isProcessingRoutes = routeProgress.status === 'processing' ||
                              routeProgress.status === 'fetching' ||
                              routeProgress.status === 'matching' ||
                              routeProgress.status === 'filtering';

  // Determine what to show - bounds syncing takes priority
  const showBanner = isAuthenticated && !isOnMapScreen && !isOnRoutesScreen && (isSyncingBounds || isProcessingRoutes);

  // Calculate display values based on what's happening
  const displayInfo = useMemo(() => {
    if (isSyncingBounds) {
      return {
        icon: 'cloud-sync-outline' as const,
        text: 'Syncing activities',
        completed: boundsProgress.completed,
        total: boundsProgress.total,
      };
    }
    if (isProcessingRoutes) {
      return {
        icon: 'map-marker-path' as const,
        text: 'Analyzing routes',
        completed: routeProgress.current,
        total: routeProgress.total,
      };
    }
    return null;
  }, [isSyncingBounds, isProcessingRoutes, boundsProgress, routeProgress]);

  // Animated values
  const heightAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Show/hide animation
  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: showBanner ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [showBanner, heightAnim]);

  // Progress animation
  useEffect(() => {
    if (displayInfo && displayInfo.total > 0) {
      const progressValue = displayInfo.completed / displayInfo.total;
      Animated.timing(progressAnim, {
        toValue: progressValue,
        duration: 150,
        useNativeDriver: false,
      }).start();
    }
  }, [displayInfo, progressAnim]);

  // Don't render at all if not showing
  if (!showBanner || !displayInfo) {
    return null;
  }

  const progressPercent = displayInfo.total > 0
    ? Math.round((displayInfo.completed / displayInfo.total) * 100)
    : 0;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Calculate banner height - use display cutout area on Android
  const bannerContentHeight = 36;
  const topPadding = Platform.OS === 'android' ? Math.max(insets.top, 24) : insets.top;

  const handlePress = () => {
    router.push('/settings');
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={[
        styles.container,
        {
          paddingTop: topPadding,
          backgroundColor: colors.primary,
        },
      ]}
    >
      <View style={[styles.content, { height: bannerContentHeight }]}>
        <MaterialCommunityIcons
          name={displayInfo.icon}
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.text}>
          {displayInfo.text}... {progressPercent}%
        </Text>
        <Text style={styles.countText}>
          {displayInfo.completed}/{displayInfo.total}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={16}
          color="rgba(255, 255, 255, 0.7)"
        />
      </View>
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            { width: progressWidth },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  countText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
});
