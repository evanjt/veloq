import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useMetricSystem } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { tapTo } from '@/shared/app/navigation';
import { useTabBarClearance } from '@/shared/ui';
import {
  screenRecordingMode,
  useRecordingStore,
  useRecordingLiveStore,
  useRecordingPreferences,
  RecordingMap,
  ConnectedDataFieldGrid,
  ControlBar,
  ManualEntry,
  TimerHeader,
  StatusSlot,
  UnlockTrack,
  IndoorDisplay,
  useLocationPermission,
  useRecordingScreenState,
  useRecordingScreenColors,
  useRecordingLock,
  useStatusPulseAnimation,
  useGpsWarningClearEffect,
  useKmSplitBannerEffect,
  useGpsSessionEffect,
  useInitRecordingEffect,
  RecordingCloseButton,
  RecordingGate,
  StrengthSession,
  WorkoutGuide,
  canStartAfterScopeWarning,
  useAlwaysLocationPrompt,
  useCanRecord,
  usePermissionUpgrade,
  useUploadPermissionStore,
  useRecordingKeepAwake,
  useRecordingHandlers,
  styles,
} from '@/features/recording';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { useSensorSession, useSensorIssue } from '@/features/sensors';
import { useRepresentativeRoute } from '@/features/routes';
import { colors, spacing } from '@/theme';
import type { ActivityTypeSheetInput } from '@/app/sheets/activity-type';
import type { FieldPickerSheetInput } from '@/app/sheets/field-picker';
import type { RouteOverlaySheetInput } from '@/app/sheets/route-overlay';
import type { ActivityType, DataFieldType } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';

function RecordingScreenContent() {
  const recordingAthleteId = useRecordingStore((s) => s.athleteId);
  const signedInAthleteId = useAuthStore((s) => s.athleteId);
  if (recordingAthleteId && recordingAthleteId !== signedInAthleteId) return null;
  return <RecordingContent />;
}

function RecordingContent() {
  useRecordingKeepAwake();

  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const isMetric = useMetricSystem();
  const { type, pairedEventId, from } = useLocalSearchParams<{
    type: string;
    pairedEventId?: string;
    from?: string;
  }>();

  // Every one-tap surface deep-links here rather than to the picker, so the gate
  // the picker applies has to be applied here too or it is not a gate at all.
  const { canRecord, reason } = useCanRecord();
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();
  const ridingWithoutScope = useUploadPermissionStore((s) => s.recordingWithoutScope);
  const continueWithoutScope = useUploadPermissionStore((s) => s.continueWithoutScope);
  const warnedPastScope = reason === 'no_permission' && ridingWithoutScope;
  const canRecordAfterWarning = canStartAfterScopeWarning(canRecord, reason, ridingWithoutScope);

  const activityType = type as ActivityType;
  const status = useRecordingStore((s) => s.status);
  const storeMode = useRecordingStore((s) => s.mode);
  const storeActivityType = useRecordingStore((s) => s.activityType);
  // The sport can change after the tap that opened the screen, so the layout
  // follows the store rather than the route param.
  const mode = screenRecordingMode(
    { status, mode: storeMode, activityType: storeActivityType },
    activityType
  );
  // Subscribe to per-stream lengths rather than the whole streams object or the
  // mutated-in-place arrays (whose identity is stable, so a direct array
  // selector would never notify). Each GPS point changes only the relevant
  // length, so only the consumers that need it re-render.
  const latlngLength = useRecordingStore((s) => s.streams.latlng.length);
  const distanceLength = useRecordingStore((s) => s.streams.distance.length);

  // The map gets the store's own track, which grows in place, and the length
  // this render saw. It flips only the points past the last length, so a fix
  // costs one point rather than a copy of the ride.
  const coordinates = useRecordingStore((s) => s.streams.latlng);

  const { gpsWarning, setGpsWarning, splitBanner, setSplitBanner } = useRecordingScreenState();

  const { textPrimary, textSecondary, bg, surface, border } = useRecordingScreenColors();

  const dataFields = useRecordingPreferences((s) => s.dataFields[mode]);
  const setDataFields = useRecordingPreferences((s) => s.setDataFields);

  const statusPulse = useStatusPulseAnimation(status);
  const { isLocked, lock, unlock } = useRecordingLock(status);

  // The location watch, the indoor tick, auto-pause and the crash backup are
  // owned by the recording session, so the screen only reads what they publish.
  const currentLocation = useRecordingLiveStore((s) => s.currentLocation);
  const accuracy = useRecordingLiveStore((s) => s.accuracy);
  const autoPaused = useRecordingLiveStore((s) => s.autoPaused);
  const backgroundTrackingFailed = useRecordingLiveStore((s) => s.backgroundTrackingFailed);
  const { t } = useTranslation();
  const { hasPermission, requestPermission } = useLocationPermission();
  useAnnounceOnAppear(t(isLocked ? 'recording.controlsLocked' : 'recording.controlsUnlocked'));

  useGpsWarningClearEffect(currentLocation, gpsWarning, setGpsWarning);

  const startTime = useRecordingStore((s) => s.startTime);
  useKmSplitBannerEffect({ mode, status, distanceLength, startTime, isMetric, setSplitBanner });

  const { handlePause, handleResume, handleLap, handleStop, handleChangeType } =
    useRecordingHandlers();

  useGpsSessionEffect({
    mode,
    status,
    hasPermission,
    requestPermission,
    setGpsWarning,
  });
  const { startNow } = useInitRecordingEffect(
    status,
    activityType,
    pairedEventId,
    canRecordAfterWarning,
    from,
    mode
  );

  // Nothing to ask for on a ride that never started.
  useAlwaysLocationPrompt(canRecordAfterWarning && from === 'quickstart', status);
  useSensorSession();
  const sensorIssue = useSensorIssue();

  // Saved-route overlay on the live map (GPS mode only, session-scoped)
  const [overlayRouteId, setOverlayRouteId] = useState<string | null>(null);
  const { points: overlayPoints } = useRepresentativeRoute(mode === 'gps' ? overlayRouteId : null);

  // Stable handles and styles let memoised children hold when store updates
  // do not change the values they draw.
  const openReview = useCallback(() => tapTo('/recording/review'), []);
  const openSensorPairing = useCallback(() => tapTo('/sensor-settings'), []);
  const dismissGpsWarning = useCallback(() => setGpsWarning(null), [setGpsWarning]);
  const bottomPadding = insets.bottom + tabBarClearance;
  const unlockTrackStyle = useMemo(
    () => ({ paddingTop: spacing.sm, paddingBottom: bottomPadding }),
    [bottomPadding]
  );
  const controlBarStyle = useMemo(() => ({ paddingBottom: bottomPadding }), [bottomPadding]);
  const effectiveFields = useMemo(
    () =>
      dataFields ??
      ((mode === 'gps'
        ? ['speed', 'distance', 'heartrate', 'power']
        : ['heartrate', 'power', 'cadence', 'timer']) as DataFieldType[]),
    [dataFields, mode]
  );

  // In-place tile customisation (long-press a tile while unlocked)
  const openSheet = useSheetOpener();
  const editField = useCallback(
    async (index: number) => {
      const result = await openSheet<FieldPickerSheetInput, DataFieldType>('sheets/field-picker', {
        selectedField: effectiveFields[index] ?? null,
      });
      if (result.kind !== 'selected') return;
      const field = result.value;
      const next = [...effectiveFields];
      const existing = next.indexOf(field);
      if (existing >= 0 && existing !== index) {
        next[existing] = next[index];
      }
      next[index] = field;
      setDataFields(mode, next);
    },
    [openSheet, effectiveFields, mode, setDataFields]
  );

  const currentActivityType = storeActivityType ?? activityType;

  const openTypePicker = useCallback(async () => {
    const result = await openSheet<ActivityTypeSheetInput, ActivityType>('sheets/activity-type', {
      selectedType: currentActivityType,
      mode: 'recording',
    });
    if (result.kind === 'selected') handleChangeType(result.value);
  }, [openSheet, currentActivityType, handleChangeType]);

  const openRoutePicker = useCallback(async () => {
    const result = await openSheet<RouteOverlaySheetInput, string | null>('sheets/route-overlay', {
      activityType: currentActivityType,
      selectedRouteId: overlayRouteId,
    });
    if (result.kind === 'selected') setOverlayRouteId(result.value);
  }, [openSheet, currentActivityType, overlayRouteId]);

  // An answer that has not arrived is not a refusal. A cold start from a widget,
  // tile, shortcut or Siri can beat the permission store, and gating there shows
  // the athlete a wall for a permission they may well have.
  if (reason === 'checking') {
    return (
      <View
        style={[styles.container, styles.centred, { backgroundColor: bg, paddingTop: insets.top }]}
        testID="recording-checking"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <RecordingCloseButton />
      </View>
    );
  }

  // A missing account is the only refusal: that ride has nowhere to go. A missing
  // scope stops the upload rather than the ride, so it warns once and the athlete
  // decides, and the ride they take that way stays on the device.
  if (!canRecord && reason !== 'ok' && !warnedPastScope) {
    return (
      <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
        <RecordingGate
          reason={reason}
          onGrantAccess={upgradePermissions}
          onContinue={continueWithoutScope}
          isUpgrading={isUpgrading}
          error={upgradeError}
        />
        <RecordingCloseButton />
      </View>
    );
  }

  if (mode === 'manual' && currentActivityType === 'WeightTraining') {
    return (
      <StrengthSession
        activityType={currentActivityType}
        pairedEventId={pairedEventId ? Number(pairedEventId) : undefined}
      />
    );
  }

  if (mode === 'manual') {
    return (
      <ManualEntry
        activityType={currentActivityType}
        pairedEventId={pairedEventId ? Number(pairedEventId) : undefined}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      <TimerHeader
        currentActivityType={currentActivityType}
        status={status}
        statusPulse={statusPulse}
        mode={mode}
        accuracy={accuracy}
        autoPaused={autoPaused}
        isLocked={isLocked}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        border={border}
        onOpenTypePicker={openTypePicker}
        onLock={lock}
      />

      <StatusSlot
        backgroundTrackingWarning={
          backgroundTrackingFailed ? t('recording.gpsTrackingError') : null
        }
        gpsWarning={gpsWarning}
        sensorIssue={sensorIssue}
        splitBanner={splitBanner}
        onDismissGpsWarning={dismissGpsWarning}
      />

      <WorkoutGuide
        isMetric={isMetric}
        isLocked={isLocked}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        surface={surface}
        border={border}
        accent={colors.primary}
      />

      {/* Main Content Area */}
      <View style={styles.mainContent} pointerEvents={isLocked ? 'none' : 'auto'}>
        {mode === 'gps' ? (
          <RecordingMap
            coordinates={coordinates}
            coordinateCount={latlngLength}
            currentLocation={currentLocation}
            routeOverlay={overlayPoints}
            onOpenRoutePicker={openRoutePicker}
            style={styles.map}
          />
        ) : (
          <IndoorDisplay
            activityType={currentActivityType}
            surface={surface}
            border={border}
            textPrimary={textPrimary}
          />
        )}
      </View>

      {/* Data Fields */}
      <ConnectedDataFieldGrid
        fields={effectiveFields}
        isMetric={isMetric}
        activityType={currentActivityType}
        onLongPressField={isLocked ? undefined : editField}
        onEmptySensorTap={isLocked ? undefined : openSensorPairing}
      />

      {/* Controls, or the unlock track while locked */}
      {isLocked ? (
        <View testID="recording-unlock-slot" style={unlockTrackStyle}>
          <UnlockTrack onUnlock={unlock} />
        </View>
      ) : (
        <ControlBar
          status={status}
          mode={mode}
          onPause={handlePause}
          onResume={handleResume}
          onStart={startNow}
          onStop={handleStop}
          onLap={handleLap}
          onReview={openReview}
          style={controlBarStyle}
        />
      )}
    </View>
  );
}

export default withScreenBoundary(RecordingScreenContent, 'Recording');
