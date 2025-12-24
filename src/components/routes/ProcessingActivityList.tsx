/**
 * Animated list showing route processing progress.
 * Shows each activity being checked with live match/no-match feedback.
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, useColorScheme, Animated, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import type { ProcessedActivityStatus } from '@/types';

interface ProcessingActivityListProps {
  activities: ProcessedActivityStatus[];
  matchesFound: number;
  totalProcessed: number;
  total: number;
}

function ActivityRow({ activity, index }: { activity: ProcessedActivityStatus; index: number }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    // Stagger animation based on index
    const delay = Math.min(index * 50, 200);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        delay,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
    ]).start();
  }, [fadeAnim, slideAnim, scaleAnim, index]);

  const getStatusIcon = () => {
    switch (activity.status) {
      case 'checking':
        return (
          <Animated.View style={{ transform: [{ rotate: '0deg' }] }}>
            <MaterialCommunityIcons name="loading" size={18} color={colors.primary} />
          </Animated.View>
        );
      case 'matched':
        return <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />;
      case 'no-match':
        return <MaterialCommunityIcons name="close-circle-outline" size={18} color={isDark ? '#666' : '#999'} />;
      case 'error':
        return <MaterialCommunityIcons name="alert-circle" size={18} color={colors.error} />;
      default:
        return <MaterialCommunityIcons name="circle-outline" size={18} color={isDark ? '#444' : '#DDD'} />;
    }
  };

  const getActivityIcon = () => {
    const type = activity.type?.toLowerCase() || '';
    if (type.includes('ride') || type.includes('cycling')) return 'bike';
    if (type.includes('run')) return 'run';
    if (type.includes('swim')) return 'swim';
    if (type.includes('walk') || type.includes('hike')) return 'walk';
    return 'map-marker';
  };

  const isActive = activity.status === 'checking' || activity.status === 'matched';
  const isMatched = activity.status === 'matched';

  return (
    <Animated.View
      style={[
        styles.activityRow,
        isDark && styles.activityRowDark,
        isMatched && styles.activityRowMatched,
        isMatched && isDark && styles.activityRowMatchedDark,
        {
          opacity: fadeAnim,
          transform: [
            { translateX: slideAnim },
            { scale: scaleAnim },
          ],
        },
      ]}
    >
      <View style={styles.activityIcon}>
        <MaterialCommunityIcons
          name={getActivityIcon()}
          size={16}
          color={isActive ? colors.primary : (isDark ? '#666' : '#999')}
        />
      </View>

      <View style={styles.activityInfo}>
        <Text
          style={[
            styles.activityName,
            isDark && styles.textLight,
            !isActive && !isMatched && styles.textMuted,
          ]}
          numberOfLines={1}
        >
          {activity.name}
        </Text>
        {isMatched && activity.matchedWith && (
          <Text style={[styles.matchedWith, isDark && styles.textMuted]} numberOfLines={1}>
            Matches: {activity.matchedWith}
          </Text>
        )}
      </View>

      <View style={styles.statusIcon}>
        {getStatusIcon()}
      </View>
    </Animated.View>
  );
}

export function ProcessingActivityList({
  activities,
  matchesFound,
  totalProcessed,
  total,
}: ProcessingActivityListProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const scrollViewRef = useRef<ScrollView>(null);

  // Auto-scroll to bottom when new items are added
  useEffect(() => {
    if (scrollViewRef.current && activities.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [activities.length]);

  // Show most recent activities (last 10)
  const recentActivities = activities.slice(-10);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Stats header */}
      <View style={styles.statsHeader}>
        <View style={styles.statItem}>
          <MaterialCommunityIcons
            name="check-circle"
            size={20}
            color={colors.success}
          />
          <Text style={[styles.statValue, { color: colors.success }]}>
            {matchesFound}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textMuted]}>
            matches
          </Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <MaterialCommunityIcons
            name="progress-check"
            size={20}
            color={colors.primary}
          />
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {totalProcessed}/{total}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textMuted]}>
            checked
          </Text>
        </View>
      </View>

      {/* Activity list */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {recentActivities.map((activity, index) => (
          <ActivityRow
            key={activity.id}
            activity={activity}
            index={index}
          />
        ))}
      </ScrollView>

      {activities.length > 10 && (
        <Text style={[styles.moreText, isDark && styles.textMuted]}>
          + {activities.length - 10} more activities processed
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 12,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    maxHeight: 350,
  },
  containerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
    marginBottom: spacing.sm,
    gap: spacing.lg,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.xs,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  activityRowDark: {
    backgroundColor: 'transparent',
  },
  activityRowMatched: {
    backgroundColor: 'rgba(76, 175, 80, 0.08)',
  },
  activityRowMatchedDark: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  activityInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  activityName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  matchedWith: {
    fontSize: 11,
    color: colors.success,
    marginTop: 2,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  statusIcon: {
    width: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
