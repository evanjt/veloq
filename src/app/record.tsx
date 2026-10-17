import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Button,
  IconButton,
  ToggleButton,
  ScreenSafeAreaView,
  useBottomClearance,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { OpenSettingsButton, SignalStatus, signalColor, type SignalLevel } from '@/shared/ui';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as haptics from '@/shared/ui/haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { canTurnOnLocationServices } from '@/shared/app/permissions/locationServices';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  spacing,
  typography,
  stroke,
} from '@/theme';
import { getActivityIcon, getActivityInk } from '@/shared/activity/activityUtils';
import {
  getRecordingMode,
  defaultEntrySport,
  entrySportChips,
  recordingEntryHref,
  locationServicesOffMessage,
  type EntryGpsState,
  useRecordingStore,
  useEntryLocation,
  BatteryOptimisationNudge,
  OutsideAppNotice,
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
import { getEngine } from '@/shared/native/engine';
import { readPlannedWorkouts } from '@/features/home';
import { replaceTo, tapTo } from '@/shared/app/navigation';
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
  const bottomClearance = useBottomClearance({ insetTaken: true });
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
    return readPlannedWorkouts(today, today);
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
      useRecordingPreferences.getState().initialise();
    }
  }, [isLoaded]);

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
    const reread = () => setTodayEvents(readPlannedWorkouts(today, today));
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
    haptics.medium();
    // The live screen takes this screen's place, so back from a ride under way never lands on
    // a Start button for a ride that is already recording.
    replaceTo(recordingEntryHref(type, pairedEventId));
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
      <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
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
    mode === 'gps' &&
    !gpsWarningDismissed &&
    (gps.state === 'weak' ||
      gps.state === 'approximate' ||
      gps.state === 'none' ||
      gps.state === 'servicesOff');

  return (
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton
                testID="record-library"
                onPress={() => tapTo('/recordings')}
                accessibilityLabel={t('recording.library.title', 'My recordings')}
              >
                <MaterialCommunityIcons
                  name="folder-play-outline"
                  size={iconSize.lg}
                  color={textSecondary}
                />
              </IconButton>
              <IconButton
                testID="record-settings"
                onPress={() => tapTo('/recording-settings')}
                accessibilityLabel={t('recording.settings')}
              >
                <MaterialCommunityIcons
                  name="cog-outline"
                  size={iconSize.lg}
                  color={textSecondary}
                />
              </IconButton>
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
          {showGpsWarning ? (
            <GpsWarningLine
              state={gps.state}
              onTurnOnServices={gps.turnOnServices}
              onUpgradePrecision={gps.upgradePrecision}
              onDismiss={() => setGpsWarningDismissed(true)}
              surface={surface}
            />
          ) : null}
          {/* Android 13+ drops the foreground-service notification without the
              permission. The notice asks on arrival once the location question
              is behind the athlete, and never by Start: a dialog raised by the
              tap lands over the recording it began. A live session sends the
              athlete straight back to it, so it asks nothing. */}
          {sessionStatus === 'idle' && <OutsideAppNotice askOnArrival={gps.promptSettled} />}
          <BatteryOptimisationNudge />
        </View>
      </View>

      <View
        style={[
          styles.panel,
          {
            backgroundColor: surface,
            borderTopColor: border,
            paddingBottom: bottomClearance,
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
              size={iconSize.lg}
              color={getActivityInk(event.type as ActivityType, isDark)}
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
              <ToggleButton
                key={type}
                testID={`record-type-${type}`}
                label={t(`activityTypes.${type}` as never, type) as string}
                selected={selected}
                onPress={() => setChosenSport(type)}
                icon={
                  <MaterialCommunityIcons
                    name={getActivityIcon(type)}
                    size={iconSize.md}
                    color={getActivityInk(type, isDark)}
                  />
                }
              />
            );
          })}
          <Pressable
            testID="record-sport-more"
            style={pressable([styles.chip, { borderColor: border }])}
            android_ripple={pressRipple}
            onPress={chooseFromSheet}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons
              name="dots-horizontal"
              size={iconSize.md}
              color={textSecondary}
            />
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
              size={iconSize.lg}
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
  const { isDark } = useTheme();
  return (
    <View
      testID={`record-surface-${mode}`}
      style={[styles.sportSurface, { backgroundColor: colorWithOpacity(surface, 0.6) }]}
    >
      <MaterialCommunityIcons
        name={getActivityIcon(sport)}
        size={iconSize.xxl}
        color={getActivityInk(sport, isDark)}
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
  {
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    level: SignalLevel;
  }
> = {
  checking: { icon: 'crosshairs-question', level: 'idle' },
  ready: { icon: 'crosshairs-gps', level: 'ok' },
  weak: { icon: 'crosshairs', level: 'warn' },
  approximate: { icon: 'map-marker-radius', level: 'warn' },
  none: { icon: 'crosshairs-off', level: 'bad' },
  servicesOff: { icon: 'map-marker-off', level: 'bad' },
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
    approximate: t('recording.gpsApproximate'),
    none: t('recording.gpsNone', 'Location denied'),
    servicesOff: t('recording.gpsServicesOff'),
  }[state];
  return (
    <SignalStatus testID={testID} variant="chip" level={level} icon={icon} label={label}>
      {state === 'checking' && (
        <ActivityIndicator size="small" color={signalColor(level, isDark)} />
      )}
    </SignalStatus>
  );
}

/**
 * A weak fix, an approximate grant, a denied location or the device's location
 * switch off, as one dismissable line. The switch has its own action: Android
 * turns it on from here, and iOS has no way in to it, so the line names where
 * it is and offers no button, since the app's settings page does not hold it.
 */
function GpsWarningLine({
  state,
  onTurnOnServices,
  onUpgradePrecision,
  onDismiss,
  surface,
}: {
  state: EntryGpsState;
  onTurnOnServices: () => Promise<void>;
  onUpgradePrecision: () => void;
  onDismiss: () => void;
  surface: string;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { icon, level } = GPS_STATUS[state];
  const tint = signalColor(level, isDark);
  const canTurnOn = canTurnOnLocationServices();
  const label =
    state === 'servicesOff'
      ? locationServicesOffMessage(t)
      : state === 'none'
        ? t('recording.gpsNone', 'Location denied')
        : state === 'approximate'
          ? t('recording.gpsApproximateWarning')
          : t('recording.gpsWeakWarning');
  return (
    <View style={[styles.warningLine, { backgroundColor: surface }]}>
      <View style={styles.warningBody}>
        <SignalStatus
          testID="record-gps-warning"
          variant="line"
          level={level}
          icon={icon}
          label={label}
        >
          {state === 'servicesOff' && canTurnOn ? (
            <Button
              testID="record-gps-turn-on"
              onPress={() => void onTurnOnServices()}
              label={t('recording.gpsServicesTurnOn')}
              variant="ghost"
              size="sm"
            />
          ) : null}
          {state === 'none' && <OpenSettingsButton testID="record-gps-settings" />}
          {state === 'approximate' && (
            <Button
              testID="record-gps-allow-precise"
              onPress={onUpgradePrecision}
              label={t(
                Platform.OS === 'android' ? 'recording.gpsApproximateAllow' : 'common.openSettings'
              )}
              variant="ghost"
              size="sm"
            />
          )}
        </SignalStatus>
      </View>
      <IconButton
        testID="record-gps-warning-dismiss"
        onPress={onDismiss}
        accessibilityLabel={t('common.close')}
      >
        <MaterialCommunityIcons name="close" size={iconSize.md} color={tint} />
      </IconButton>
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
    borderTopWidth: stroke.hairline,
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
    borderWidth: stroke.hairline,
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
    borderWidth: stroke.hairline,
    overflow: 'hidden',
  },
  chipLabel: {
    ...typography.bodySmall,
  },
  startButton: {
    minHeight: layout.minTapTarget + spacing.md,
  },
});

export default withScreenBoundary(RecordScreenContent, 'Record');
