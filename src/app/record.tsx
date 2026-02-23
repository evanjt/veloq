import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { CollapsibleSection } from '@/components/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import type { MaterialIconName } from '@/lib/utils/activityUtils';
import { ACTIVITY_CATEGORIES } from '@/lib/utils/recordingModes';
import { useRecordingPreferences } from '@/providers/RecordingPreferencesStore';
import { intervalsApi } from '@/api';
import { formatLocalDate, formatDuration } from '@/lib';
import type { ActivityType, CalendarEvent } from '@/types';

const DEFAULT_QUICK_TYPES: ActivityType[] = ['Ride', 'Run', 'Walk'];

const CATEGORY_LABELS: Record<string, string> = {
  cycling: 'Cycling',
  running: 'Running',
  swimming: 'Swimming',
  winter: 'Winter Sports',
  water: 'Water Sports',
  gym: 'Gym & Fitness',
  racket: 'Racket Sports',
  other: 'Other',
};

const CATEGORY_ICONS: Record<string, MaterialIconName> = {
  cycling: 'bike',
  running: 'run',
  swimming: 'swim',
  winter: 'snowflake',
  water: 'waves',
  gym: 'dumbbell',
  racket: 'tennis',
  other: 'dots-horizontal',
};

export default function RecordScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const recentTypes = useRecordingPreferences((s) => s.recentActivityTypes);
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);

  const quickTypes = useMemo(
    () => (recentTypes.length > 0 ? recentTypes : DEFAULT_QUICK_TYPES),
    [recentTypes]
  );

  useEffect(() => {
    if (!isLoaded) {
      useRecordingPreferences.getState().initialize();
    }
  }, [isLoaded]);

  // Fetch today's planned workouts
  useEffect(() => {
    const today = formatLocalDate(new Date());
    intervalsApi
      .getEvents(today, today)
      .then(setTodayEvents)
      .catch(() => {
        // Silently ignore — events section just won't show
      });
  }, []);

  const handleSelectType = useCallback((type: ActivityType, pairedEventId?: number) => {
    const params = pairedEventId ? `?pairedEventId=${pairedEventId}` : '';
    router.push(`/recording/${type}${params}` as never);
  }, []);

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('recording.startActivity', 'Start Activity')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Quick Start */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.quickStart', 'Quick Start')}
          </Text>
          <FlatList
            horizontal
            data={quickTypes}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickStartList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.quickTypeCard, { backgroundColor: surface, borderColor: border }]}
                onPress={() => handleSelectType(item)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={getActivityIcon(item)}
                  size={28}
                  color={getActivityColor(item)}
                />
                <Text style={[styles.quickTypeLabel, { color: textPrimary }]} numberOfLines={1}>
                  {t(`activityTypes.${item}`, item)}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Today's Workouts */}
        {todayEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textSecondary }]}>
              {t('recording.todaysWorkouts', "Today's Workouts")}
            </Text>
            {todayEvents.map((event) => (
              <TouchableOpacity
                key={event.id}
                style={[styles.eventCard, { backgroundColor: surface, borderColor: border }]}
                onPress={() => handleSelectType(event.type, event.id)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={getActivityIcon(event.type)}
                  size={24}
                  color={getActivityColor(event.type)}
                  style={styles.eventIcon}
                />
                <View style={styles.eventDetails}>
                  <Text style={[styles.eventName, { color: textPrimary }]} numberOfLines={1}>
                    {event.name}
                  </Text>
                  {event.moving_time != null && event.moving_time > 0 && (
                    <Text style={[styles.eventMeta, { color: textSecondary }]}>
                      {formatDuration(event.moving_time)}
                    </Text>
                  )}
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* All Activities */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.allActivities', 'All Activities')}
          </Text>
          {Object.entries(ACTIVITY_CATEGORIES).map(([category, types]) => (
            <CollapsibleSection
              key={category}
              title={t(`recording.categories.${category}`, CATEGORY_LABELS[category] ?? category)}
              icon={CATEGORY_ICONS[category]}
              expanded={expandedCategories[category] ?? false}
              onToggle={() => toggleCategory(category)}
              style={[styles.categorySection, { backgroundColor: surface, borderColor: border }]}
              subtitle={`${types.length} ${t('recording.types', 'types')}`}
            >
              <View style={styles.typeGrid}>
                {(types as readonly ActivityType[]).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeItem, { borderBottomColor: border }]}
                    onPress={() => handleSelectType(type)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={getActivityIcon(type)}
                      size={22}
                      color={getActivityColor(type)}
                      style={styles.typeIcon}
                    />
                    <Text style={[styles.typeLabel, { color: textPrimary }]}>
                      {t(`activityTypes.${type}`, type)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleSection>
          ))}
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.sectionTitle,
    marginLeft: spacing.xs,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  section: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  quickStartList: {
    gap: spacing.sm,
  },
  quickTypeCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 90,
  },
  quickTypeLabel: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  eventIcon: {
    marginRight: spacing.sm,
  },
  eventDetails: {
    flex: 1,
  },
  eventName: {
    ...typography.bodyBold,
  },
  eventMeta: {
    ...typography.caption,
    marginTop: 2,
  },
  categorySection: {
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  typeGrid: {
    paddingHorizontal: spacing.sm,
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minHeight: layout.minTapTarget,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeIcon: {
    marginRight: spacing.sm,
    width: 28,
    textAlign: 'center',
  },
  typeLabel: {
    ...typography.body,
  },
});
