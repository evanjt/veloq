import React from 'react';
import { View, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useActivity, useActivityStreams } from '@/hooks';
import { ActivityMapView, ElevationChart } from '@/components';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatSpeed,
  formatPace,
  formatDateTime,
  getActivityIcon,
  getActivityColor,
  isRunningActivity,
  decodePolyline,
  convertLatLngTuples,
} from '@/lib';
import { colors, spacing, layout, typography } from '@/theme';

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: activity, isLoading, error } = useActivity(id || '');
  const { data: streams } = useActivityStreams(id || '');

  // DEBUG: Log API responses to identify field names
  React.useEffect(() => {
    if (activity) {
      console.log('=== ACTIVITY DEBUG ===');
      console.log('Activity ID:', activity.id);
      console.log('Has polyline:', !!activity.polyline);
      console.log('Has start_latlng:', !!activity.start_latlng);
      console.log('Activity keys:', Object.keys(activity));
      // Log the whole activity to see all fields
      console.log('Full activity:', JSON.stringify(activity, null, 2));
    }
  }, [activity]);

  React.useEffect(() => {
    if (streams) {
      console.log('=== STREAMS DEBUG ===');
      console.log('Has latlng:', !!streams.latlng);
      console.log('latlng length:', streams.latlng?.length || 0);
      console.log('Streams keys:', Object.keys(streams));
      // Log first few latlng entries to check format
      if (streams.latlng && streams.latlng.length > 0) {
        console.log('First latlng entry:', streams.latlng[0]);
        console.log('latlng type:', typeof streams.latlng[0]);
      }
      console.log('Full streams:', JSON.stringify(streams, null, 2).slice(0, 2000));
    }
  }, [streams]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !activity) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton icon="arrow-left" onPress={() => router.back()} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Failed to load activity</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);
  const showPace = isRunningActivity(activity.type);

  // Get coordinates from streams or polyline
  const coordinates = streams?.latlng
    ? convertLatLngTuples(streams.latlng)
    : (activity.polyline ? decodePolyline(activity.polyline) : []);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <View style={styles.headerTitle}>
          <Text
            style={[styles.activityName, isDark && styles.textLight]}
            numberOfLines={1}
          >
            {activity.name}
          </Text>
          <Text style={styles.date}>{formatDateTime(activity.start_date_local)}</Text>
        </View>
        <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
          <MaterialCommunityIcons
            name={iconName as any}
            size={20}
            color="#FFFFFF"
          />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Interactive Map */}
        <ActivityMapView
          coordinates={coordinates}
          polyline={activity.polyline}
          activityType={activity.type}
          height={280}
        />

        {/* Primary stats */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <View style={styles.statRow}>
            <StatItem
              label="Distance"
              value={formatDistance(activity.distance)}
              isDark={isDark}
            />
            <StatItem
              label="Time"
              value={formatDuration(activity.moving_time)}
              isDark={isDark}
            />
            <StatItem
              label="Elevation"
              value={formatElevation(activity.total_elevation_gain)}
              isDark={isDark}
            />
          </View>
        </View>

        {/* Elevation Chart */}
        {streams?.altitude && streams.altitude.length > 0 && (
          <View style={[styles.statsCard, isDark && styles.cardDark]}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              Elevation Profile
            </Text>
            <ElevationChart
              altitude={streams.altitude}
              distance={streams.distance}
              height={150}
            />
          </View>
        )}

        {/* Performance stats */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Performance
          </Text>
          <View style={styles.statRow}>
            {showPace ? (
              <>
                <StatItem
                  label="Avg Pace"
                  value={formatPace(activity.average_speed)}
                  isDark={isDark}
                />
                <StatItem
                  label="Max Pace"
                  value={formatPace(activity.max_speed)}
                  isDark={isDark}
                />
              </>
            ) : (
              <>
                <StatItem
                  label="Avg Speed"
                  value={formatSpeed(activity.average_speed)}
                  isDark={isDark}
                />
                <StatItem
                  label="Max Speed"
                  value={formatSpeed(activity.max_speed)}
                  isDark={isDark}
                />
              </>
            )}
          </View>
          {(activity.icu_average_hr || activity.average_heartrate || activity.average_watts || activity.icu_average_watts) && (
            <View style={styles.statRow}>
              {(activity.average_heartrate || activity.icu_average_hr) && (
                <StatItem
                  label="Avg HR"
                  value={formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                  isDark={isDark}
                />
              )}
              {(activity.max_heartrate || activity.icu_max_hr) && (
                <StatItem
                  label="Max HR"
                  value={formatHeartRate(activity.max_heartrate || activity.icu_max_hr!)}
                  isDark={isDark}
                />
              )}
              {(activity.average_watts || activity.icu_average_watts) && (
                <StatItem
                  label="Avg Power"
                  value={formatPower(activity.average_watts || activity.icu_average_watts!)}
                  isDark={isDark}
                />
              )}
              {activity.max_watts && (
                <StatItem
                  label="Max Power"
                  value={formatPower(activity.max_watts)}
                  isDark={isDark}
                />
              )}
            </View>
          )}
          {activity.average_cadence && (
            <View style={styles.statRow}>
              <StatItem
                label="Avg Cadence"
                value={`${Math.round(activity.average_cadence)} ${showPace ? 'spm' : 'rpm'}`}
                isDark={isDark}
              />
              {activity.calories && (
                <StatItem
                  label="Calories"
                  value={`${Math.round(activity.calories)} kcal`}
                  isDark={isDark}
                />
              )}
            </View>
          )}
        </View>

        {/* Time stats */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Time
          </Text>
          <View style={styles.statRow}>
            <StatItem
              label="Moving Time"
              value={formatDuration(activity.moving_time)}
              isDark={isDark}
            />
            <StatItem
              label="Elapsed Time"
              value={formatDuration(activity.elapsed_time)}
              isDark={isDark}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, isDark && styles.textLight]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
    paddingRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
  },
  activityName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginTop: spacing.md,
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  sectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.statsValue,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.statsLabel,
    color: colors.textSecondary,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },
});
