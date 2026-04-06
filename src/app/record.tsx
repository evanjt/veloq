import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { CollapsibleSection } from '@/components/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import type { MaterialIconName } from '@/lib/utils/activityUtils';
import { ACTIVITY_CATEGORIES, getRecordingMode } from '@/lib/utils/recordingModes';
import { useRecordingPreferences } from '@/providers/RecordingPreferencesStore';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useCanRecord } from '@/hooks/recording/useCanRecord';
import { usePermissionUpgrade } from '@/hooks/recording/usePermissionUpgrade';
import {
  hasRecordingBackup,
  loadRecordingBackup,
  clearRecordingBackup,
} from '@/lib/storage/recordingBackup';
import { intervalsApi } from '@/api';
import { formatLocalDate, formatDuration, navigateTo } from '@/lib';
import type { ActivityType, CalendarEvent } from '@/types';

const DEFAULT_QUICK_TYPES: ActivityType[] = [
  'Ride',
  'Run',
  'Walk',
  'Swim',
  'Hike',
  'WeightTraining',
];

const GPS_READINESS_TIMEOUT_MS = 15_000;

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
  const insets = useSafeAreaInsets();
  const { canRecord, reason } = useCanRecord();
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();
  const recentTypes = useRecordingPreferences((s) => s.recentActivityTypes);
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);

  // GPS readiness state
  const [gpsState, setGpsState] = useState<'checking' | 'ready' | 'weak' | 'none'>('checking');

  const quickTypes = useMemo(
    () => (recentTypes.length > 0 ? recentTypes : DEFAULT_QUICK_TYPES),
    [recentTypes]
  );

  useEffect(() => {
    if (!isLoaded) {
      useRecordingPreferences.getState().initialize();
    }
  }, [isLoaded]);

  // GPS readiness gate
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          // Request permission
          const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
          if (newStatus !== 'granted') {
            if (!cancelled) setGpsState('none');
            return;
          }
        }

        // Set timeout for weak GPS
        timeoutId = setTimeout(() => {
          if (!cancelled) setGpsState('weak');
        }, GPS_READINESS_TIMEOUT_MS);

        // Try to get a single location fix
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!cancelled) {
          if (timeoutId) clearTimeout(timeoutId);
          setGpsState(
            location.coords.accuracy != null && location.coords.accuracy <= 20 ? 'ready' : 'weak'
          );
        }
      } catch {
        if (!cancelled) setGpsState('weak');
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // Crash recovery check
  useEffect(() => {
    (async () => {
      const hasBackup = await hasRecordingBackup();
      if (!hasBackup) return;

      Alert.alert(t('recording.resumePrevious'), t('recording.resumePreviousMessage'), [
        {
          text: t('recording.discard'),
          style: 'destructive',
          onPress: () => clearRecordingBackup(),
        },
        {
          text: t('recording.controls.resume'),
          onPress: async () => {
            const backup = await loadRecordingBackup();
            if (!backup) return;

            // Load backup into store
            const store = useRecordingStore.getState();
            store.startRecording(
              backup.activityType,
              backup.mode,
              backup.pairedEventId ?? undefined
            );
            // Override streams and timing from backup
            useRecordingStore.setState({
              startTime: backup.startTime,
              pausedDuration: backup.pausedDuration,
              streams: backup.streams,
              laps: backup.laps,
              status: 'paused', // Start paused so user can review before resuming
            });

            navigateTo(`/recording/${backup.activityType}`);
          },
        },
      ]);
    })();
  }, [t]);

  // Fetch today's planned workouts
  useEffect(() => {
    const today = formatLocalDate(new Date());
    intervalsApi
      .getCalendarEvents({ oldest: today, newest: today })
      .then(setTodayEvents)
      .catch(() => {
        // Silently ignore — events section just won't show
      });
  }, []);

  const handleSelectType = useCallback((type: ActivityType, pairedEventId?: number) => {
    const params = pairedEventId ? `?pairedEventId=${pairedEventId}` : '';
    navigateTo(`/recording/${type}${params}`);
  }, []);

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  // Permission gate: show upgrade screen instead of activity picker
  if (!canRecord && reason === 'no_permission') {
    return (
      <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
        <View style={styles.header}>
          <TouchableOpacity
            testID="record-back"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textPrimary }]}>
            {t('recording.startActivity', 'Start Activity')}
          </Text>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.permissionGate}>
          <MaterialCommunityIcons name="shield-lock-outline" size={48} color="#F59E0B" />
          <Text style={[styles.permissionTitle, { color: textPrimary }]}>
            {t('recording.writePermissionRequired', 'Write permission required')}
          </Text>
          <Text style={[styles.permissionDescription, { color: textSecondary }]}>
            {t(
              'recording.writePermissionDescription',
              'Recording requires write permission. Tap below to grant access.'
            )}
          </Text>
          <TouchableOpacity
            testID="record-grant-access"
            style={styles.permissionButton}
            onPress={upgradePermissions}
            disabled={isUpgrading}
            activeOpacity={0.7}
          >
            {isUpgrading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.permissionButtonText}>
                {t('recording.grantAccess', 'Grant Access')}
              </Text>
            )}
          </TouchableOpacity>
          {upgradeError ? (
            <Text style={styles.permissionError} numberOfLines={2}>
              {upgradeError}
            </Text>
          ) : null}
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="record-back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('recording.startActivity', 'Start Activity')}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          testID="record-settings"
          onPress={() => navigateTo('/recording-settings')}
          style={styles.settingsButton}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="cog-outline" size={22} color={textSecondary} />
        </TouchableOpacity>
      </View>

      {/* GPS Readiness Indicator — full-width prominent bar */}
      <GpsReadinessBar state={gpsState} isDark={isDark} testID="record-gps-status" prominent />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
      >
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
                testID={`record-type-${item}`}
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
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textSecondary }]}>
            {t('recording.todaysWorkouts', "Today's Workouts")}
          </Text>
          {todayEvents.length > 0 ? (
            todayEvents.map((event) => (
              <TouchableOpacity
                key={event.id}
                testID={`record-event-${event.id}`}
                style={[styles.eventCard, { backgroundColor: surface, borderColor: border }]}
                onPress={() => handleSelectType(event.type as ActivityType, event.id)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={getActivityIcon(event.type as ActivityType)}
                  size={24}
                  color={getActivityColor(event.type as ActivityType)}
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
            ))
          ) : (
            <Text style={[styles.noWorkoutsText, { color: textSecondary }]}>
              {t('recording.noWorkoutsPlanned', 'No workouts planned for today')}
            </Text>
          )}
        </View>

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
                    testID={`record-type-${type}`}
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

/** GPS readiness indicator bar */
function GpsReadinessBar({
  state,
  isDark,
  testID,
  prominent,
}: {
  state: 'checking' | 'ready' | 'weak' | 'none';
  isDark: boolean;
  testID?: string;
  prominent?: boolean;
}) {
  const { t } = useTranslation();

  const configs: Record<
    string,
    {
      icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
      color: string;
      text: string;
      bgColor: string;
    }
  > = {
    checking: {
      icon: 'crosshairs-question',
      color: '#9CA3AF',
      text: t('recording.gpsAcquiring'),
      bgColor: 'rgba(156, 163, 175, 0.1)',
    },
    ready: {
      icon: 'crosshairs-gps',
      color: '#22C55E',
      text: t('recording.gpsReady'),
      bgColor: 'rgba(34, 197, 94, 0.1)',
    },
    weak: {
      icon: 'crosshairs',
      color: '#F59E0B',
      text: t('recording.gpsWeakWarning'),
      bgColor: 'rgba(245, 158, 11, 0.1)',
    },
    none: {
      icon: 'crosshairs-off',
      color: '#EF4444',
      text: t('recording.gpsNone', 'Location denied'),
      bgColor: 'rgba(239, 68, 68, 0.1)',
    },
  };

  const config = configs[state];
  if (!config) return null;

  return (
    <View
      testID={testID}
      style={[
        styles.gpsReadinessBar,
        prominent && styles.gpsReadinessBarProminent,
        {
          backgroundColor: prominent
            ? config.bgColor
            : isDark
              ? darkColors.surface
              : colors.surface,
        },
      ]}
    >
      <MaterialCommunityIcons name={config.icon} size={prominent ? 18 : 16} color={config.color} />
      <Text
        style={[
          styles.gpsReadinessText,
          prominent && styles.gpsReadinessTextProminent,
          { color: config.color },
        ]}
      >
        {config.text}
      </Text>
      {state === 'checking' && prominent && (
        <View style={styles.gpsSpinner}>
          <MaterialCommunityIcons name="loading" size={14} color={config.color} />
        </View>
      )}
      {state === 'ready' && prominent && (
        <MaterialCommunityIcons name="check-circle" size={14} color={config.color} />
      )}
      {state === 'none' && prominent && (
        <TouchableOpacity onPress={() => Linking.openSettings()}>
          <Text style={[styles.gpsSettingsLink, { color: config.color }]}>
            {t('recording.gpsAlertSettings', 'Open Settings')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
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
  settingsButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsReadinessBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: layout.borderRadiusSm,
  },
  gpsReadinessBarProminent: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: layout.borderRadius,
  },
  gpsReadinessText: {
    fontSize: 13,
    fontWeight: '500',
  },
  gpsReadinessTextProminent: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  gpsSpinner: {
    marginLeft: spacing.xs,
  },
  noWorkoutsText: {
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  gpsSettingsLink: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  scrollContent: {},
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
  permissionGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  permissionDescription: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: 8,
    backgroundColor: '#F59E0B',
    minWidth: 140,
    alignItems: 'center',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  permissionError: {
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
});
