import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import {
  Button,
  ScreenSafeAreaView,
  TAB_BAR_SAFE_PADDING,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { SignalStatus, signalColor, type SignalLevel } from '@/shared/ui';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';
import {
  getRecordingMode,
  defaultEntrySport,
  entrySportChips,
  recordingEntryHref,
  type EntryGpsState,
  useRecordingStore,
  useEntryLocation,
  BatteryOptimisationNudge,
  RecordingGate,
  RecordingMap,
  useCanRecord,
  useRecordingPreferences,
  usePermissionUpgrade,
  useUploadPermissionStore,
  promptInterruptedRecording,
  sessionReturnRoute,
} from '@/features/recording';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { getEngine } from '@/shared/native/engine';
import { readCalendarEvents } from '@/features/home';
import { navigateTo, replaceTo } from '@/shared/app/navigation';
import { formatLocalDate, formatDuration } from '@/shared/format/format';
import type { ActivityTypeSheetInput } from '@/app/sheets/activity-type';
import type { ActivityType, CalendarEvent } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const NO_TRACK: [number, number][] = [];

/**
 * The record entry screen: the recording, before it begins.
 *
 * The map is the screen, with the live position and its accuracy acquiring.
 * One Start begins the sport it names, the recent sports sit beside it as
 * chips with the full list behind More, and today's planned workout is a card
 * only when there is one. An indoor or manual sport swaps the map for its own
 * surface and keeps the layout.
 *
 * Start only navigates. The recording screen begins the ride on arrival with
 * the map in view, and every prompt this screen needs is raised on arrival
 * rather than by the tap.
 */
function RecordScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { canRecord, reason } = useCanRecord();
  const ridingWithoutScope = useUploadPermissionStore((s) => s.recordingWithoutScope);
  const continueWithoutScope = useUploadPermissionStore((s) => s.continueWithoutScope);
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();
  const recentTypes = useRecordingPreferences((s) => s.recentActivityTypes);
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const sessionStatus = useRecordingStore((s) => s.status);

  // Null until the athlete chooses, so the default follows the recent list
  // once preferences load rather than freezing on the first empty read.
  const [chosenSport, setChosenSport] = useState<ActivityType | null>(null);
  const sport = chosenSport ?? defaultEntrySport(recentTypes);
  const mode = getRecordingMode(sport);
  const chips = useMemo(() => entrySportChips(recentTypes, sport), [recentTypes, sport]);
  const [gpsWarningDismissed, setGpsWarningDismissed] = useState(false);

  // Read at first render rather than in an effect. An engine that is not open
  // yet answers empty either way, and the subscriptions below recover it.
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>(() => {
    const today = formatLocalDate(new Date());
    return readCalendarEvents(today, today);
  });

  const gps = useEntryLocation(mode === 'gps' && sessionStatus === 'idle');

  // A session is already in the store (cold navigation, notification tap, FAB
  // while recording, or a stopped ride not saved yet) - go straight back to it
  // instead of the entry screen.
  useEffect(() => {
    const auth = useAuthStore.getState();
    const session = useRecordingStore.getState();
    if (!auth.isAuthenticated || !auth.athleteId || session.athleteId !== auth.athleteId) return;
    const route = sessionReturnRoute(session);
    if (route) replaceTo(route);
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      useRecordingPreferences.getState().initialize();
    }
  }, [isLoaded]);

  // Android 13+ suppresses the foreground-service notification without this.
  // Asked here once the location question is behind the athlete, since Android
  // shows one dialog at a time, and never by Start: a dialog raised by the tap
  // lands over the recording it began. A denial never blocks the recording.
  // A live session sends the athlete straight back to it, so it asks nothing.
  const notificationsAsked = useRef(false);
  useEffect(() => {
    if (!gps.promptSettled || sessionStatus !== 'idle' || notificationsAsked.current) return;
    notificationsAsked.current = true;
    if (Platform.OS === 'android') requestNotificationPermission().catch(() => {});
  }, [gps.promptSettled, sessionStatus]);

  // Crash recovery check
  useEffect(() => {
    void promptInterruptedRecording();
  }, []);

  // Today's planned workouts. The stored day is read in the initialiser above,
  // so the first paint has it; this asks Rust to refresh the day. The refresh
  // stores a `calendar` body and announces that alone, and a full sync rewrites
  // the calendar and settles on `activities`, so both re-read.
  useEffect(() => {
    const today = formatLocalDate(new Date());
    const engine = getEngine();
    if (!engine) return undefined;
    const reread = () => setTodayEvents(readCalendarEvents(today, today));
    const offCalendar = engine.subscribe('bodyStored', (payload) => {
      if ((payload as { kind?: string } | undefined)?.kind !== 'calendar') return;
      reread();
    });
    const offActivities = engine.subscribe('activities', reread);
    engine.syncCalendarEvents(today, today);
    return () => {
      offCalendar();
      offActivities();
    };
  }, []);

  const start = useCallback((type: ActivityType, pairedEventId?: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    navigateTo(recordingEntryHref(type, pairedEventId));
  }, []);

  const openSheet = useSheetOpener();
  const chooseFromSheet = useCallback(async () => {
    const result = await openSheet<ActivityTypeSheetInput, ActivityType>('sheets/activity-type', {
      selectedType: sport,
      mode: 'recording',
    });
    if (result.kind === 'selected') setChosenSport(result.value);
  }, [openSheet, sport]);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  // Permission gate: the reason decides which one, and both live in the feature
  // because the recording screen has to render the same answer.
  //
  // `checking` is shown as the scope gate here on purpose. The recording screen
  // waits for it, because a one-tap start arrives before the store and the
  // athlete has already committed. This screen is reached by an athlete who has
  // not tapped Start yet, so the safe default costs nothing and flips to the
  // entry screen the moment the answer lands.
  // A missing scope warns rather than refuses, here as on the recording screen:
  // continuing arms a sport and the ride stays on the device. `checking` gets no
  // continue, because nothing is known to be missing yet.
  const warnedPastScope = reason === 'no_permission' && ridingWithoutScope;
  if (!canRecord && reason !== 'ok' && !warnedPastScope) {
    return (
      <ScreenSafeAreaView hasNativeHeader style={[styles.container, { backgroundColor: bg }]}>
        <RecordingGate
          reason={reason === 'checking' ? 'no_permission' : reason}
          onGrantAccess={upgradePermissions}
          onContinue={reason === 'no_permission' ? continueWithoutScope : undefined}
          isUpgrading={isUpgrading}
          error={upgradeError}
        />
      </ScreenSafeAreaView>
    );
  }

  const sportLabel = t(`activityTypes.${sport}` as never, sport) as string;
  const showGpsWarning =
    mode === 'gps' && !gpsWarningDismissed && (gps.state === 'weak' || gps.state === 'none');

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, { backgroundColor: bg }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <TouchableOpacity
                testID="record-library"
                onPress={() => navigateTo('/recordings')}
                style={styles.headerButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('recording.library.title', 'My Recordings')}
              >
                <MaterialCommunityIcons
                  name="folder-play-outline"
                  size={22}
                  color={textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                testID="record-settings"
                onPress={() => navigateTo('/recording-settings')}
                style={styles.headerButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('settings.title', 'Settings')}
              >
                <MaterialCommunityIcons name="cog-outline" size={22} color={textSecondary} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      {/* The surface: the map for a GPS sport, the sport's own face otherwise */}
      <View style={styles.surface}>
        {mode === 'gps' ? (
          <>
            <RecordingMap
              coordinates={NO_TRACK}
              currentLocation={gps.location}
              accuracy={gps.accuracy}
              style={styles.map}
            />
            <View style={styles.gpsStatusWrap} pointerEvents="none">
              <GpsStatusPill state={gps.state} testID="record-gps-status" />
            </View>
          </>
        ) : (
          <SportSurface
            sport={sport}
            mode={mode}
            surface={surface}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        )}

        {/* Warnings: one line each, only when true, each dismissable */}
        <View style={styles.warnings}>
          {showGpsWarning && (
            <GpsWarningLine
              state={gps.state}
              onDismiss={() => setGpsWarningDismissed(true)}
              surface={surface}
            />
          )}
          <BatteryOptimisationNudge />
        </View>
      </View>

      <View
        style={[
          styles.panel,
          {
            backgroundColor: surface,
            borderTopColor: border,
            paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING,
          },
        ]}
      >
        {/* Today's planned workout - only when something is planned */}
        {todayEvents.map((event) => (
          <Pressable
            key={event.id}
            testID={`record-event-${event.id}`}
            style={pressable([styles.eventCard, { borderColor: border }])}
            android_ripple={pressRipple}
            onPress={() => start(event.type as ActivityType, event.id)}
            accessibilityRole="button"
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
            <Text
              style={[
                styles.followLabel,
                { color: isDark ? darkColors.linkTeal : colors.linkTeal },
              ]}
            >
              {t('recording.followWorkout')}
            </Text>
          </Pressable>
        ))}

        {/* The sport: recent ones as chips, the full list behind More */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((type) => {
            const selected = type === sport;
            return (
              <Pressable
                key={type}
                testID={`record-type-${type}`}
                style={pressable([
                  styles.chip,
                  { borderColor: selected ? colors.primary : border },
                  selected && styles.chipSelected,
                ])}
                android_ripple={pressRipple}
                onPress={() => setChosenSport(type)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <MaterialCommunityIcons
                  name={getActivityIcon(type)}
                  size={18}
                  color={getActivityColor(type)}
                />
                <Text style={[styles.chipLabel, { color: textPrimary }]} numberOfLines={1}>
                  {t(`activityTypes.${type}` as never, type) as string}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            testID="record-sport-more"
            style={pressable([styles.chip, { borderColor: border }])}
            android_ripple={pressRipple}
            onPress={chooseFromSheet}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="dots-horizontal" size={18} color={textSecondary} />
            <Text style={[styles.chipLabel, { color: textPrimary }]}>
              {t('recording.moreSports')}
            </Text>
          </Pressable>
        </ScrollView>

        {/* One Start, labelled with what it starts */}
        <Button
          testID="record-start"
          label={t('recording.startSport', { sport: sportLabel })}
          onPress={() => start(sport)}
          icon={
            <MaterialCommunityIcons
              name={mode === 'manual' ? 'pencil' : 'play'}
              size={22}
              color={colors.textOnPrimary}
            />
          }
          style={styles.startButton}
        />
      </View>
    </ScreenSafeAreaView>
  );
}

/** The face an indoor or manual sport shows where the map would be. */
function SportSurface({
  sport,
  mode,
  surface,
  textPrimary,
  textSecondary,
}: {
  sport: ActivityType;
  mode: 'indoor' | 'manual';
  surface: string;
  textPrimary: string;
  textSecondary: string;
}) {
  const { t } = useTranslation();
  return (
    <View
      testID={`record-surface-${mode}`}
      style={[styles.sportSurface, { backgroundColor: colorWithOpacity(surface, 0.6) }]}
    >
      <MaterialCommunityIcons
        name={getActivityIcon(sport)}
        size={64}
        color={getActivityColor(sport)}
      />
      <Text style={[styles.sportSurfaceTitle, { color: textPrimary }]}>
        {t(`activityTypes.${sport}` as never, sport) as string}
      </Text>
      <Text style={[styles.sportSurfaceCaption, { color: textSecondary }]}>
        {mode === 'indoor' ? t('recording.entryIndoorCaption') : t('recording.entryManualCaption')}
      </Text>
    </View>
  );
}

const GPS_STATUS: Record<
  EntryGpsState,
  { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; level: SignalLevel }
> = {
  checking: { icon: 'crosshairs-question', level: 'idle' },
  ready: { icon: 'crosshairs-gps', level: 'ok' },
  weak: { icon: 'crosshairs', level: 'warn' },
  none: { icon: 'crosshairs-off', level: 'bad' },
};

/** The GPS state as one word over the map, beside the ring it describes. */
function GpsStatusPill({ state, testID }: { state: EntryGpsState; testID?: string }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { icon, level } = GPS_STATUS[state];
  const label = {
    checking: t('recording.gpsAcquiring'),
    ready: t('recording.gpsReady'),
    weak: t('recording.gpsWeak'),
    none: t('recording.gpsNone', 'Location denied'),
  }[state];
  return (
    <SignalStatus testID={testID} variant="chip" level={level} icon={icon} label={label}>
      {state === 'checking' && (
        <ActivityIndicator size="small" color={signalColor(level, isDark)} />
      )}
    </SignalStatus>
  );
}

/** A weak fix or a denied location, as one dismissable line. */
function GpsWarningLine({
  state,
  onDismiss,
  surface,
}: {
  state: EntryGpsState;
  onDismiss: () => void;
  surface: string;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { icon, level } = GPS_STATUS[state];
  const tint = signalColor(level, isDark);
  return (
    <View style={[styles.warningLine, { backgroundColor: surface }]}>
      <View style={styles.warningBody}>
        <SignalStatus
          testID="record-gps-warning"
          variant="line"
          level={level}
          icon={icon}
          label={
            state === 'none'
              ? t('recording.gpsNone', 'Location denied')
              : t('recording.gpsWeakWarning')
          }
        >
          {state === 'none' && (
            <Pressable
              onPress={() => Linking.openSettings()}
              style={pressable()}
              android_ripple={pressRipple}
            >
              <Text style={[styles.gpsSettingsLink, { color: tint }]}>
                {t('recording.gpsAlertSettings', 'Open Settings')}
              </Text>
            </Pressable>
          )}
        </SignalStatus>
      </View>
      <Pressable
        testID="record-gps-warning-dismiss"
        onPress={onDismiss}
        style={pressable(styles.dismissButton)}
        android_ripple={pressRipple}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        hitSlop={spacing.sm}
      >
        <MaterialCommunityIcons name="close" size={18} color={tint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surface: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  gpsStatusWrap: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
  },
  warnings: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.md,
    right: spacing.md,
    gap: spacing.xs,
  },
  warningLine: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
    paddingRight: spacing.xs,
  },
  warningBody: {
    flex: 1,
  },
  dismissButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsSettingsLink: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  sportSurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sportSurfaceTitle: {
    ...typography.sectionTitle,
    marginTop: spacing.md,
  },
  sportSurfaceCaption: {
    ...typography.body,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTapTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
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
    marginTop: spacing.xxs,
  },
  followLabel: {
    ...typography.bodyBold,
    marginLeft: spacing.sm,
  },
  chipRow: {
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.minTapTarget,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadiusFull,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  chipSelected: {
    borderWidth: 2,
    backgroundColor: colorWithOpacity(colors.primary, 0.1),
  },
  chipLabel: {
    ...typography.bodySmall,
  },
  startButton: {
    minHeight: layout.minTapTarget + spacing.md,
  },
});

export default withScreenBoundary(RecordScreenContent, 'Record');
