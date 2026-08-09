import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { useTheme, useMetricSystem } from '@/shared/app';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { getRecordingMode } from '@/features/recording/lib/recordingModes';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { ControlBar } from '@/features/recording/components/ControlBar';
import { ActivityTypePickerModal } from '@/features/recording/components/ActivityTypePickerModal';
import { FieldPickerModal } from '@/features/recording/components/FieldPickerModal';
import { RouteOverlayPicker } from '@/features/recording/components/RouteOverlayPicker';
import { ManualEntry } from '@/features/recording/components/ManualEntry';
import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { StatusSlot } from '@/features/recording/components/StatusSlot';
import { UnlockTrack } from '@/features/recording/components/UnlockTrack';
import { IndoorDisplay } from '@/features/recording/components/IndoorDisplay';
import { useTimer } from '@/features/recording/hooks/useTimer';
import { useLocationTracking } from '@/features/recording/hooks/useLocationTracking';
import { useRecordingMetrics } from '@/features/recording/hooks/useRecordingMetrics';
import { useRecordingScreenState } from '@/features/recording/hooks/useRecordingScreenState';
import { useRecordingScreenColors } from '@/features/recording/hooks/useRecordingScreenColors';
import { useRecordingLock } from '@/features/recording/hooks/useRecordingLock';
import { useStatusPulseAnimation } from '@/features/recording/hooks/useStatusPulseAnimation';
import { useGpsWarningClearEffect } from '@/features/recording/hooks/useGpsWarningClearEffect';
import { useAutoPauseEffect } from '@/features/recording/hooks/useAutoPauseEffect';
import { useKmSplitBannerEffect } from '@/features/recording/hooks/useKmSplitBannerEffect';
import { useHrZoneColorEffect } from '@/features/recording/hooks/useHrZoneColorEffect';
import { useCrashRecoveryBackupEffect } from '@/features/recording/hooks/useCrashRecoveryBackupEffect';
import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';
import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingKeepAwake } from '@/features/recording/hooks/useRecordingKeepAwake';
import { useIndoorSampleEffect } from '@/features/recording/hooks/useIndoorSampleEffect';
import { useSensorSession, useSensorIssue } from '@/features/sensors';
import { useConsensusRoute } from '@/features/routes/hooks/useRouteEngine';
import { useRecordingHandlers } from '@/features/recording/hooks/useRecordingHandlers';
import { styles } from '@/features/recording/RecordingScreen.styles';
import type { ActivityType, DataFieldType } from '@/types';

export default function RecordingScreen() {
  useRecordingKeepAwake();

  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const { type, pairedEventId } = useLocalSearchParams<{ type: string; pairedEventId?: string }>();

  const activityType = type as ActivityType;
  const mode = getRecordingMode(activityType);
  const status = useRecordingStore((s) => s.status);
  // Subscribe to per-stream lengths rather than the whole streams object or the
  // mutated-in-place arrays (whose identity is stable, so a direct array
  // selector would never notify). Each GPS point changes only the relevant
  // length, so only the consumers that need it re-render.
  const latlngLength = useRecordingStore((s) => s.streams.latlng.length);
  const speedLength = useRecordingStore((s) => s.streams.speed.length);
  const distanceLength = useRecordingStore((s) => s.streams.distance.length);
  const heartrateLength = useRecordingStore((s) => s.streams.heartrate.length);

  // Snapshot coordinates for the map. Keyed on length because the underlying
  // latlng array is mutated in place. The slice gives consumers a stable
  // reference that only changes when a point is added.
  const coordinates = useMemo(
    () => useRecordingStore.getState().streams.latlng.slice(),
    [latlngLength]
  );

  const {
    gpsWarning,
    setGpsWarning,
    autoPaused,
    setAutoPaused,
    splitBanner,
    setSplitBanner,
    showTypePicker,
    setShowTypePicker,
    hrZone,
    setHrZone,
  } = useRecordingScreenState();

  const { textPrimary, textSecondary, bg, surface, border } = useRecordingScreenColors();

  const dataFields = useRecordingPreferences((s) => s.dataFields[mode]);
  const setDataFields = useRecordingPreferences((s) => s.setDataFields);

  const statusPulse = useStatusPulseAnimation(status);
  const { isLocked, lock, unlock } = useRecordingLock(status);

  const { elapsedTime, movingTime, formattedElapsed, formattedMoving } = useTimer();
  const baseMetrics = useRecordingMetrics();
  const metrics = useMemo(
    () => ({ ...baseMetrics, elapsedTime, movingTime }),
    [baseMetrics, elapsedTime, movingTime]
  );
  const location = useLocationTracking();
  const { stopTracking, currentLocation, accuracy } = location;

  useGpsWarningClearEffect(currentLocation, gpsWarning, setGpsWarning);

  const autoPauseDetectorRef = useAutoPauseEffect({
    activityType,
    mode,
    status,
    speedLength,
    autoPaused,
    setAutoPaused,
  });

  useKmSplitBannerEffect({ mode, status, distanceLength, isMetric, setSplitBanner });
  useHrZoneColorEffect(heartrateLength, setHrZone);
  useCrashRecoveryBackupEffect(status, activityType, mode);

  const { handlePause, handleResume, handleLap, handleStop, handleDiscard, handleChangeType } =
    useRecordingHandlers({
      autoPauseDetectorRef,
      stopTracking,
      setAutoPaused,
      setShowTypePicker,
    });

  useGpsSessionEffect({ mode, status, location, setGpsWarning, onDiscard: handleDiscard });
  useInitRecordingEffect(status, activityType, mode, pairedEventId);
  useIndoorSampleEffect(mode, status);
  useSensorSession();
  const sensorIssue = useSensorIssue();

  // Saved-route overlay on the live map (GPS mode only, session-scoped)
  const [overlayRouteId, setOverlayRouteId] = useState<string | null>(null);
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const { points: overlayPoints } = useConsensusRoute(mode === 'gps' ? overlayRouteId : null);

  // In-place tile customisation (long-press a tile while unlocked)
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
  const effectiveFields = useMemo(
    () =>
      dataFields ??
      ((mode === 'gps'
        ? ['speed', 'distance', 'heartrate', 'power']
        : ['heartrate', 'power', 'cadence', 'timer']) as DataFieldType[]),
    [dataFields, mode]
  );

  const handleFieldSelect = useCallback(
    (field: DataFieldType) => {
      if (editingFieldIndex == null) return;
      const next = [...effectiveFields];
      const existing = next.indexOf(field);
      if (existing >= 0 && existing !== editingFieldIndex) {
        next[existing] = next[editingFieldIndex];
      }
      next[editingFieldIndex] = field;
      setDataFields(mode, next);
      setEditingFieldIndex(null);
    },
    [editingFieldIndex, effectiveFields, mode, setDataFields]
  );

  // Read current activity type from store (may change during recording)
  const currentActivityType = useRecordingStore((s) => s.activityType) ?? activityType;

  if (mode === 'manual') {
    return (
      <ManualEntry
        activityType={activityType}
        pairedEventId={pairedEventId ? Number(pairedEventId) : undefined}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      <TimerHeader
        formattedElapsed={formattedElapsed}
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
        onOpenTypePicker={() => setShowTypePicker(true)}
        onLock={lock}
      />

      <StatusSlot
        gpsWarning={gpsWarning}
        sensorIssue={sensorIssue}
        splitBanner={splitBanner}
        onDismissGpsWarning={() => setGpsWarning(null)}
      />

      {/* Main Content Area */}
      <View style={styles.mainContent} pointerEvents={isLocked ? 'none' : 'auto'}>
        {mode === 'gps' ? (
          <RecordingMap
            coordinates={coordinates}
            currentLocation={currentLocation}
            routeOverlay={overlayPoints}
            onOpenRoutePicker={() => setShowRoutePicker(true)}
            style={styles.map}
          />
        ) : (
          <IndoorDisplay
            activityType={activityType}
            formattedMoving={formattedMoving}
            surface={surface}
            border={border}
            textPrimary={textPrimary}
          />
        )}
      </View>

      {/* Data Fields */}
      <DataFieldGrid
        fields={effectiveFields}
        metrics={metrics}
        isMetric={isMetric}
        hrZone={hrZone}
        onLongPressField={isLocked ? undefined : (index) => setEditingFieldIndex(index)}
      />

      {/* Controls, or the unlock track while locked */}
      {isLocked ? (
        <View style={{ paddingTop: 8, paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING }}>
          <UnlockTrack onUnlock={unlock} />
        </View>
      ) : (
        <ControlBar
          status={status}
          mode={mode}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onDiscard={handleDiscard}
          onLap={handleLap}
          style={{ paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING }}
        />
      )}

      {/* Activity type picker modal */}
      <ActivityTypePickerModal
        visible={showTypePicker}
        selectedType={currentActivityType}
        onSelect={handleChangeType}
        onClose={() => setShowTypePicker(false)}
        mode="recording"
        isDark={isDark}
      />

      {/* In-place data field picker */}
      <FieldPickerModal
        visible={editingFieldIndex != null}
        selectedField={
          editingFieldIndex != null ? (effectiveFields[editingFieldIndex] ?? null) : null
        }
        isDark={isDark}
        onSelect={handleFieldSelect}
        onClose={() => setEditingFieldIndex(null)}
      />

      {/* Saved-route overlay picker */}
      <RouteOverlayPicker
        visible={showRoutePicker}
        activityType={currentActivityType}
        selectedRouteId={overlayRouteId}
        onSelect={setOverlayRouteId}
        onClose={() => setShowRoutePicker(false)}
      />
    </View>
  );
}
