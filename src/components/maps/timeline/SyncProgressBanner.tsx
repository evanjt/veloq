import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';

interface SyncProgressBannerProps {
  completed: number;
  total: number;
  message?: string;
}

export function SyncProgressBanner({ completed, total, message }: SyncProgressBannerProps) {
  const { t } = useTranslation();
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Animate progress bar
  useEffect(() => {
    if (total > 0) {
      const progressValue = completed / total;
      Animated.timing(progressAnim, {
        toValue: progressValue,
        duration: 150,
        useNativeDriver: false,
      }).start();
    }
  }, [completed, total, progressAnim]);

  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Determine the display text
  const displayText =
    message ||
    (total > 0 ? t('maps.syncingActivities', { completed, total }) : t('common.loading'));

  return (
    <View style={styles.syncBanner}>
      <View style={styles.content}>
        <MaterialCommunityIcons name="cloud-sync-outline" size={16} color="#FFFFFF" />
        <Text style={styles.syncText}>
          {displayText}
          {total > 0 && ` ${progressPercent}%`}
        </Text>
        {total > 0 && (
          <Text style={styles.countText}>
            {completed}/{total}
          </Text>
        )}
      </View>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  syncBanner: {
    backgroundColor: colors.primary,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
  },
  syncText: {
    color: colors.textOnDark,
    fontSize: typography.bodyCompact.fontSize,
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
