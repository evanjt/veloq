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
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { CollapsibleSection, SignalStatus, signalColor, type SignalLevel } from '@/shared/ui';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useTheme } from '@/shared/app';
import { colors, colorWithOpacity, darkColors, spacing, layout, typography, brand } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/features/activity/lib/activityUtils';
import type { MaterialIconName } from '@/features/activity/lib/activityUtils';
import { ACTIVITY_CATEGORIES } from '@/features/recording/lib/recordingModes';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useCanRecord } from '@/features/recording/hooks/useCanRecord';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import {
  hasRecordingBackup,
  loadRecordingBackup,
  clearRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { BatteryOptimisationNudge } from '@/features/recording/components/BatteryOptimisationNudge';
import { GrantAccessButton } from '@/features/recording/components/GrantAccessButton';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { intervalsApi } from '@/api';
import { navigateTo } from '@/shared/app/navigation';
import { formatLocalDate, formatDuration } from '@/shared/format/format';
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
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([]);

  // GPS readiness state
  const [gpsState, setGpsState] = useState<'checking' | 'ready' | 'weak' | 'none'>('checking');

  // A session is already active (cold navigation, notification tap, FAB while
  // recording) - go straight back to the live screen instead of the picker.
  useEffect(() => {
    const { status, activityType } = useRecordingStore.getState();
    if ((status === 'recording' || status === 'paused') && activityType) {
      router.replace(`/recording/${activityType}`);
    }
  }, []);

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
      // An in-memory session owns the backup file - nothing to recover
      if (useRecordingStore.getState().status !== 'idle') return;
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

            const now = Date.now();
            // Load backup into store
            const store = useRecordingStore.getState();
            store.startRecording(
              backup.activityType,
              backup.mode,
              backup.pairedEventId ?? undefined
            );

            if (backup.status === 'stopped') {
              // Session was already stopped - restore straight to review
              useRecordingStore.setState({
                startTime: backup.startTime,
                stopTime: backup.stopTime ?? backup.savedAt,
                pausedDuration: backup.pausedDuration,
                streams: backup.streams,
                laps: backup.laps,
                status: 'stopped',
              });
              navigateTo('/recording/review');
              return;
            }

            // Credit the offline gap (savedAt → now) as paused time so moving
            // time does not inflate, and open the ongoing pause so the wait on
            // this prompt is credited too when the user resumes.
            useRecordingStore.setState({
              startTime: backup.startTime,
              pausedDuration: backup.pausedDuration + Math.max(0, now - backup.savedAt),
              streams: backup.streams,
              laps: backup.laps,
              status: 'paused', // Start paused so user can review before resuming
              _pauseStart: now,
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
        // Silently ignore - events section just won't show
      });
  }, []);

  const handleSelectType = useCallback((type: ActivityType, pairedEventId?: number) => {
    // Android 13+ suppresses the foreground-service notification without this;
    // fire-and-forget so a denial never blocks the recording itself.
    if (Platform.OS === 'android') {
      requestNotificationPermission().catch(() => {});
    }
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
            accessibilityRole="button"
            accessibilityLabel={t('common.back', 'Back')}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textPrimary }]}>
            {t('recording.startActivity', 'Start Activity')}
          </Text>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.permissionGate}>
          <MaterialCommunityIcons name="shield-lock-outline" size={48} color={colors.warning} />
          <Text style={[styles.permissionTitle, { color: textPrimary }]}>
            {t('recording.writePermissionRequired', 'Write permission required')}
          </Text>
          <Text style={[styles.permissionDescription, { color: textSecondary }]}>
            {t(
              'recording.writePermissionDescription',
              'Recording requires write permission. Tap below to grant access.'
            )}
          </Text>
          <GrantAccessButton
            testID="record-grant-access"
            onPress={upgradePermissions}
            loading={isUpgrading}
          />
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
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('recording.startActivity', 'Start Activity')}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          testID="record-library"
          onPress={() => navigateTo('/recordings')}
          style={styles.settingsButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('recording.library.title', 'My Recordings')}
        >
          <MaterialCommunityIcons name="folder-play-outline" size={22} color={textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          testID="record-settings"
          onPress={() => navigateTo('/recording-settings')}
          style={styles.settingsButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('settings.title', 'Settings')}
        >
          <MaterialCommunityIcons name="cog-outline" size={22} color={textSecondary} />
        </TouchableOpacity>
      </View>

      {/* GPS readiness line */}
      <View style={styles.gpsReadinessWrap}>
        <GpsReadinessBar state={gpsState} testID="record-gps-status" />
      </View>

      <BatteryOptimisationNudge />

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

        {/* Today's Workouts - only when something is planned */}
        {todayEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textSecondary }]}>
              {t('recording.todaysWorkouts', "Today's Workouts")}
            </Text>
            {todayEvents.map((event) => (
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
            ))}
          </View>
        )}

        {/* All Activities - tucked behind one expander */}
        <View style={styles.section}>
          <TouchableOpacity
            testID="record-all-activities"
            style={styles.allActivitiesHeader}
            onPress={() => setShowAllActivities((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.sectionTitle, { color: textSecondary }]}>
              {t('recording.allActivities', 'All Activities')}
            </Text>
            <MaterialCommunityIcons
              name={showAllActivities ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={textSecondary}
            />
          </TouchableOpacity>
          {showAllActivities &&
            Object.entries(ACTIVITY_CATEGORIES).map(([category, types]) => (
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

/** GPS readiness line for the pre-start screen */
function GpsReadinessBar({
  state,
  testID,
}: {
  state: 'checking' | 'ready' | 'weak' | 'none';
  testID?: string;
}) {
  const { t } = useTranslation();

  const configs: Record<
    string,
    {
      icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
      level: SignalLevel;
      text: string;
    }
  > = {
    checking: {
      icon: 'crosshairs-question',
      level: 'idle',
      text: t('recording.gpsAcquiring'),
    },
    ready: {
      icon: 'crosshairs-gps',
      level: 'ok',
      text: t('recording.gpsReady'),
    },
    weak: {
      icon: 'crosshairs',
      level: 'warn',
      text: t('recording.gpsWeakWarning'),
    },
    none: {
      icon: 'crosshairs-off',
      level: 'bad',
      text: t('recording.gpsNone', 'Location denied'),
    },
  };

  const config = configs[state];
  if (!config) return null;
  const tint = signalColor(config.level);

  return (
    <SignalStatus
      testID={testID}
      variant="line"
      level={config.level}
      icon={config.icon}
      label={config.text}
    >
      {state === 'checking' && <MaterialCommunityIcons name="loading" size={14} color={tint} />}
      {state === 'ready' && <MaterialCommunityIcons name="check-circle" size={14} color={tint} />}
      {state === 'none' && (
        <TouchableOpacity onPress={() => Linking.openSettings()}>
          <Text style={[styles.gpsSettingsLink, { color: tint }]}>
            {t('recording.gpsAlertSettings', 'Open Settings')}
          </Text>
        </TouchableOpacity>
      )}
    </SignalStatus>
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
  gpsReadinessWrap: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  allActivitiesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.minTapTarget,
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
  permissionError: {
    fontSize: 13,
    color: colors.errorDark,
    textAlign: 'center',
  },
});
