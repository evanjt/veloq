import React from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/providers';
import { activitySyncManager } from '@/lib';

export function DemoBanner() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const isDemoMode = useAuthStore((state) => state.isDemoMode);
  const exitDemoMode = useAuthStore((state) => state.exitDemoMode);
  const queryClient = useQueryClient();

  // Don't render if not in demo mode
  if (!isDemoMode) return null;

  const handlePress = async () => {
    // Clear cached demo data - TanStack Query cache
    queryClient.clear();
    // Clear activity sync manager cache (bounds, GPS tracks, routes)
    await activitySyncManager.clearCache();
    // Reset sync manager state so it can re-initialize with real data
    activitySyncManager.reset();
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
    backgroundColor: '#FF9800', // Orange for demo mode
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  containerDark: {
    backgroundColor: '#F57C00', // Slightly darker for dark mode
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
