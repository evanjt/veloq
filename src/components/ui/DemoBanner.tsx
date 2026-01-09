import React from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore, useSyncDateRange } from '@/providers';
import { clearAllGpsTracks, clearBoundsCache } from '@/lib/storage/gpsStorage';

// Lazy load native module to avoid bundler errors
function getRouteEngine() {
  try {
    return require('route-matcher-native').routeEngine;
  } catch {
    return null;
  }
}

export function DemoBanner() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const hideDemoBanner = useAuthStore((state) => state.hideDemoBanner);
  const exitDemoMode = useAuthStore((state) => state.exitDemoMode);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);

  // Don't render if not in demo mode or if banner is hidden
  if (!isDemoMode || hideDemoBanner) return null;

  const handlePress = async () => {
    // Clear ALL cached demo data:

    // 1. Clear TanStack Query in-memory cache
    queryClient.clear();

    // 2. Clear persisted query cache in AsyncStorage (critical!)
    await AsyncStorage.removeItem('veloq-query-cache');

    // 3. Clear Rust engine cache
    const routeEngine = getRouteEngine();
    if (routeEngine) routeEngine.clear();

    // 4. Clear FileSystem caches (GPS tracks and bounds)
    await Promise.all([clearAllGpsTracks(), clearBoundsCache()]);

    // 5. Reset sync date range to default 90 days
    resetSyncDateRange();

    // Exit demo mode (sets isAuthenticated to false)
    exitDemoMode();

    // Navigate to login - use replace to prevent going back to demo
    router.replace('/login' as Href);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        isDark && styles.containerDark,
        pressed && styles.pressed,
        { paddingTop: insets.top > 0 ? insets.top : 8 },
      ]}
    >
      <View style={styles.content}>
        <MaterialCommunityIcons name="information" size={18} color="#FFFFFF" style={styles.icon} />
        <Text style={styles.text}>{t('demo.banner', { defaultValue: 'Demo Mode' })}</Text>
        <Text style={styles.subtext}>
          {t('demo.tapToSignIn', { defaultValue: 'Tap to sign in' })}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={18}
          color="#FFFFFF"
          style={styles.chevron}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#5B9BD5', // Brand blue for demo mode
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  containerDark: {
    backgroundColor: '#3A7AB8', // Darker blue for dark mode
  },
  pressed: {
    opacity: 0.8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  subtext: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    marginLeft: 8,
  },
  chevron: {
    marginLeft: 4,
  },
});
