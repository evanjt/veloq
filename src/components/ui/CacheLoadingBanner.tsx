/**
 * Global banner showing cache loading progress.
 * Appears at the top of the app when syncing bounds cache.
 * Tapping navigates to cache settings.
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useActivityBoundsCache } from '@/hooks';
import { useAuthStore } from '@/providers';
import { colors } from '@/theme';

export function CacheLoadingBanner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParts = useSegments();
  const { progress } = useActivityBoundsCache();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Don't show on map screen - it has its own sync indicator
  const isOnMapScreen = routeParts.includes('map' as never);

  // Only show when authenticated, actively syncing, and not on map
  const isLoading = isAuthenticated && progress.status === 'syncing' && !isOnMapScreen;

  // Animated values
  const heightAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Show/hide animation
  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: isLoading ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isLoading, heightAnim]);

  // Progress animation
  useEffect(() => {
    if (progress.total > 0) {
      const progressValue = progress.completed / progress.total;
      Animated.timing(progressAnim, {
        toValue: progressValue,
        duration: 150,
        useNativeDriver: false,
      }).start();
    }
  }, [progress.completed, progress.total, progressAnim]);

  // Don't render at all if not syncing
  if (!isLoading) {
    return null;
  }

  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
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
          name="cloud-sync-outline"
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.text}>
          Syncing activities... {progressPercent}%
        </Text>
        <Text style={styles.countText}>
          {progress.completed}/{progress.total}
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
