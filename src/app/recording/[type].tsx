import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useMetricSystem } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { replaceTo, tapTo } from '@/shared/app/navigation';
import { useBackIntercept } from '@/shared/app/useBackIntercept';
import { useBottomClearance } from '@/shared/ui';
import {
  parsePairedEventId,
  parseRecordingType,
  screenRecordingMode,
  useRecordingStore,
  useRecordingLiveStore,
  useRecordingPreferences,
  fieldsForMode,
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
  recordingBackAction,
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

const NO_HEADER = { headerShown: false };

function RecordingScreenContent() {
  const { type } = useLocalSearchParams<{ type: string }>();
  // Any app or web page can open a recording link, so a sport the recorder does
  // not know goes to the picker and starts nothing.
  const activityType = parseRecordingType(type);
  const recordingAthleteId = useRecordingStore((s) => s.athleteId);
  const signedInAthleteId = useAuthStore((s) => s.athleteId);
  useEffect(() => {
    if (activityType === null) replaceTo('/record');
  }, [activityType]);
  if (activityType === null) return null;
  if (recordingAthleteId && recordingAthleteId !== signedInAthleteId) return null;
  return <RecordingContent activityType={activityType} />;
}

function RecordingContent({ activityType }: { activityType: ActivityType }) {
  useRecordingKeepAwake();

  const insets = useSafeAreaInsets();
  const bottomClearance = useBottomClearance();
  const isMetric = useMetricSystem();
  const params = useLocalSearchParams<{ pairedEventId?: string; from?: string }>();
  const pairedEventId = parsePairedEventId(params.pairedEventId);
  const { from } = params;

  // Every one-tap surface deep-links here rather than to the picker, so the gate
  // the picker applies has to be applied here too or it is not a gate at all.
  const { canRecord, reason } = useCanRecord();
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();
  const ridingWithoutScope = useUploadPermissionStore((s) => s.recordingWithoutScope);
  const continueWithoutScope = useUploadPermissionStore((s) => s.continueWithoutScope);
  const warnedPastScope = reason === 'no_permission' && ridingWithoutScope;
  const canRecordAfterWarning = canStartAfterScopeWarning(canRecord, reason, ridingWithoutScope);

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

  const { gpsWarning, gpsWarningOpensSettings, setGpsWarning, splitBanner, setSplitBanner } =
    useRecordingScreenState();

  const { textPrimary, textSecondary, bg, surface, border } = useRecordingScreenColors();

  const dataFields = useRecordingPreferences((s) => s.dataFields);
  const setSlotField = useRecordingPreferences((s) => s.setSlotField);

  const statusPulse = useStatusPulseAnimation(status);
  const { isLocked, lock, unlock } = useRecordingLock(status);

  // The location watch, the indoor tick, auto-pause and the crash backup are
  // owned by the recording session, so the screen only reads what they publish.
  const currentLocation = useRecordingLiveStore((s) => s.currentLocation);
  const accuracy = useRecordingLiveStore((s) => s.accuracy);
  const autoPaused = useRecordingLiveStore((s) => s.autoPaused);
  const backgroundTrackingFailed = useRecordingLiveStore((s) => s.backgroundTrackingFailed);
  const backupFailing = useRecordingLiveStore((s) => s.backupFailures > 0);
  const { t } = useTranslation();
  const { hasPermission, precision, requestPermission, upgradePrecision } = useLocationPermission();
  useAnnounceOnAppear(t(isLocked ? 'recording.controlsLocked' : 'recording.controlsUnlocked'));

  useGpsWarningClearEffect(currentLocation, gpsWarning, setGpsWarning, precision);

  const startTime = useRecordingStore((s) => s.startTime);
  useKmSplitBannerEffect({ mode, status, distanceLength, startTime, isMetric, setSplitBanner });

  const { handlePause, handleResume, handleLap, handleStop, handleChangeType } =
    useRecordingHandlers();

  useGpsSessionEffect({
    mode,
    status,
    hasPermission,
    precision,
    requestPermission,
    upgradePrecision,
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
  const bottomPadding = bottomClearance;
  const unlockTrackStyle = useMemo(
    () => ({ paddingTop: spacing.sm, paddingBottom: bottomPadding }),
    [bottomPadding]
  );
  const controlBarStyle = useMemo(() => ({ paddingBottom: bottomPadding }), [bottomPadding]);
  const effectiveFields = useMemo(() => fieldsForMode(dataFields, mode), [dataFields, mode]);

  // In-place tile customisation (long-press a tile while unlocked)
  const openSheet = useSheetOpener();
  const editField = useCallback(
    async (index: number) => {
      const result = await openSheet<FieldPickerSheetInput, DataFieldType>('sheets/field-picker', {
        selectedField: effectiveFields[index] ?? null,
      });
      if (result.kind === 'selected') setSlotField(mode, index, result.value);
    },
    [openSheet, effectiveFields, mode, setSlotField]
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

  // The manual and strength forms take the platform's header, titled with the
  // sport. Swipe-back is off on this route, so its back is the way off. The
  // live recorder, its gate and its wait draw their own close control and take
  // none. Every branch sets it, because options set by one outlive it.
  const formHeader = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: t(`activityTypes.${currentActivityType}`, currentActivityType),
      }}
    />
  );
  const noHeader = <Stack.Screen options={NO_HEADER} />;

  // An answer that has not arrived is not a refusal. A cold start from a widget,
  // tile, shortcut or Siri can beat the permission store, and gating there shows
  // the athlete a wall for a permission they may well have.
  const checking = reason === 'checking';
  // A missing account is the only refusal: that ride has nowhere to go. A missing
  // scope stops the upload rather than the ride, so it warns once and the athlete
  // decides, and the ride they take that way stays on the device.
  const gated = !canRecord && reason !== 'ok' && !warnedPastScope;

  // The lock covers the system back control too, which the screen's swipe setting
  // does not reach on Android. Back while locked nudges the unlock track instead.
  const lockShown = isLocked && !checking && !gated && mode !== 'manual';
  const [unlockHint, setUnlockHint] = useState(0);
  const hintUnlock = useCallback(() => setUnlockHint((n) => n + 1), []);
  useBackIntercept(
    recordingBackAction({ status, isLocked: lockShown, isProcessing: false }) === 'consume',
    hintUnlock
  );

  if (checking) {
    return (
      <View
        style={[styles.container, styles.centred, { backgroundColor: bg, paddingTop: insets.top }]}
        testID="recording-checking"
      >
        {noHeader}
        <ActivityIndicator size="large" color={colors.primary} />
        <RecordingCloseButton />
      </View>
    );
  }

  if (gated) {
    return (
      <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
        {noHeader}
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
      <>
        {formHeader}
        <StrengthSession activityType={currentActivityType} pairedEventId={pairedEventId} />
      </>
    );
  }

  if (mode === 'manual') {
    return (
      <>
        {formHeader}
        <ManualEntry activityType={currentActivityType} pairedEventId={pairedEventId} />
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      {noHeader}
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
        backupWarning={backupFailing ? t('recording.backupFailing') : null}
        gpsWarning={gpsWarning}
        gpsWarningOpensSettings={gpsWarningOpensSettings}
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
          <UnlockTrack onUnlock={unlock} hint={unlockHint} />
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
