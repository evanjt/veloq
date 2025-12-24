import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, Pressable } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouteMatchStore } from '@/providers';
import { useActivities } from '@/hooks';
import { RouteMapView } from '@/components/routes';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
} from '@/lib';
import { colors, spacing, layout } from '@/theme';
import type { Activity } from '@/types';

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  matchPercentage?: number;
  direction?: string;
}

function ActivityRow({ activity, isDark, matchPercentage, direction }: ActivityRowProps) {
  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  const activityColor = getActivityColor(activity.type);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        pressed && styles.activityRowPressed,
      ]}
    >
      <View style={[styles.activityIcon, { backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons
          name={getActivityIcon(activity.type)}
          size={18}
          color={activityColor}
        />
      </View>
      <View style={styles.activityInfo}>
        <View style={styles.activityNameRow}>
          <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
            {activity.name}
          </Text>
          {/* Match percentage badge */}
          {matchPercentage !== undefined && (
            <View style={[styles.matchBadge, { backgroundColor: colors.success + '15' }]}>
              <Text style={[styles.matchText, { color: colors.success }]}>
                {Math.round(matchPercentage)}%
              </Text>
              {direction === 'reverse' && (
                <MaterialCommunityIcons name="swap-horizontal" size={10} color={colors.success} />
              )}
            </View>
          )}
        </View>
        <Text style={[styles.activityDate, isDark && styles.textMuted]}>
          {formatRelativeDate(activity.start_date_local)}
        </Text>
      </View>
      <View style={styles.activityStats}>
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {formatDistance(activity.distance)}
        </Text>
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(activity.moving_time)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? '#555' : '#CCC'}
      />
    </Pressable>
  );
}

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const routeGroup = useRouteMatchStore((s) =>
    s.cache?.groups.find((g) => g.id === id) || null
  );

  // Get match data for all activities in this route
  const matches = useRouteMatchStore((s) => s.cache?.matches || {});

  // Fetch activities for this route
  const { data: allActivities, isLoading } = useActivities({
    oldest: routeGroup?.firstDate?.split('T')[0] || undefined,
    newest: routeGroup?.lastDate?.split('T')[0] || undefined,
    includeStats: false,
  });

  // Filter to only activities in this route group
  const routeActivities = React.useMemo(() => {
    if (!routeGroup || !allActivities) return [];
    const idsSet = new Set(routeGroup.activityIds);
    return allActivities.filter((a) => idsSet.has(a.id));
  }, [routeGroup, allActivities]);

  if (!routeGroup) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Route</Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-question-outline"
            size={48}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>
            Route not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const activityColor = getActivityColor(routeGroup.type);
  const iconName = getActivityIcon(routeGroup.type);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]} numberOfLines={1}>
          {routeGroup.name}
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Route summary card */}
        <View style={[styles.summaryCard, isDark && styles.summaryCardDark]}>
          <View style={[styles.accentBar, { backgroundColor: activityColor + '80' }]} />

          <View style={styles.summaryHeader}>
            <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
              <MaterialCommunityIcons
                name={iconName}
                size={24}
                color="#FFFFFF"
              />
            </View>
            <View style={styles.summaryInfo}>
              <Text style={[styles.routeName, isDark && styles.textLight]}>
                {routeGroup.name}
              </Text>
              <Text style={[styles.routeMeta, isDark && styles.textMuted]}>
                {formatDistance(routeGroup.signature.distance)}
              </Text>
            </View>
          </View>

          {/* Stats row */}
          <View style={[styles.statsRow, isDark && styles.statsRowDark]}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: activityColor }]}>
                {routeGroup.activityCount}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                Activities
              </Text>
            </View>
            <View style={[styles.statDivider, isDark && styles.statDividerDark]} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {formatRelativeDate(routeGroup.firstDate)}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                First
              </Text>
            </View>
            <View style={[styles.statDivider, isDark && styles.statDividerDark]} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {formatRelativeDate(routeGroup.lastDate)}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                Last
              </Text>
            </View>
          </View>
        </View>

        {/* Hero map */}
        {routeGroup.signature?.points && routeGroup.signature.points.length > 1 && (
          <View style={styles.mapSection}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              Route
            </Text>
            <RouteMapView routeGroup={routeGroup} height={180} />
          </View>
        )}

        {/* Activities list */}
        <View style={styles.activitiesSection}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Activities
          </Text>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : routeActivities.length === 0 ? (
            <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
              No activities found
            </Text>
          ) : (
            <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
              {routeActivities.map((activity, index) => {
                const match = matches[activity.id];
                // Representative activity doesn't have a match entry, show 100%
                const isRepresentative = routeGroup?.activityIds[0] === activity.id;
                const matchPercentage = match?.matchPercentage ?? (isRepresentative ? 100 : undefined);
                const direction = match?.direction ?? (isRepresentative ? 'same' : undefined);
                return (
                  <React.Fragment key={activity.id}>
                    <ActivityRow
                      activity={activity}
                      isDark={isDark}
                      matchPercentage={matchPercentage}
                      direction={direction}
                    />
                    {index < routeActivities.length - 1 && (
                      <View style={[styles.divider, isDark && styles.dividerDark]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryCardDark: {
    backgroundColor: '#1E1E1E',
  },
  accentBar: {
    height: 3,
    width: '100%',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: layout.cardPadding,
    gap: spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  routeMeta: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
    paddingVertical: spacing.md,
  },
  statsRowDark: {
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  statDividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  mapSection: {
    marginBottom: spacing.lg,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyActivities: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  activitiesCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  activitiesCardDark: {
    backgroundColor: '#1E1E1E',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  activityRowDark: {},
  activityRowPressed: {
    opacity: 0.7,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityInfo: {
    flex: 1,
  },
  activityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  activityName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 2,
  },
  matchText: {
    fontSize: 11,
    fontWeight: '600',
  },
  activityDate: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  activityStats: {
    alignItems: 'flex-end',
  },
  activityDistance: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    marginLeft: 36 + spacing.md + spacing.md,
  },
  dividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
