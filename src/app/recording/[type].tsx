import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { useTheme, useMetricSystem } from '@/shared/app';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { getRecordingMode } from '@/features/recording/lib/recordingModes';
import { formatDistance, formatSpeed } from '@/shared/format/format';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';
import { ControlBar } from '@/features/recording/components/ControlBar';
import { LockOverlay } from '@/features/recording/components/LockOverlay';
import { ActivityTypePickerModal } from '@/features/recording/components/ActivityTypePickerModal';
import { ManualEntry } from '@/features/recording/components/ManualEntry';
import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { GpsWarningBanner } from '@/features/recording/components/GpsWarningBanner';
import { AutoPauseBanner } from '@/features/recording/components/AutoPauseBanner';
import { KmSplitBanner } from '@/features/recording/components/KmSplitBanner';
import { IndoorDisplay } from '@/features/recording/components/IndoorDisplay';
import { RelockButton } from '@/features/recording/components/RelockButton';
import { HrZoneBar } from '@/features/recording/components/HrZoneBar';
import { useTimer } from '@/features/recording/hooks/useTimer';
import { useLocationTracking } from '@/features/recording/hooks/useLocationTracking';
import { useRecordingMetrics } from '@/features/recording/hooks/useRecordingMetrics';
import { useRecordingScreenState } from '@/features/recording/hooks/useRecordingScreenState';
import { useRecordingScreenColors } from '@/features/recording/hooks/useRecordingScreenColors';
import { useLockOnRecordingEffect } from '@/features/recording/hooks/useLockOnRecordingEffect';
import { useStatusPulseAnimation } from '@/features/recording/hooks/useStatusPulseAnimation';
import { useGpsWarningClearEffect } from '@/features/recording/hooks/useGpsWarningClearEffect';
import { useAutoPauseEffect } from '@/features/recording/hooks/useAutoPauseEffect';
import { useKmSplitBannerEffect } from '@/features/recording/hooks/useKmSplitBannerEffect';
import { useHrZoneColorEffect } from '@/features/recording/hooks/useHrZoneColorEffect';
import { useCrashRecoveryBackupEffect } from '@/features/recording/hooks/useCrashRecoveryBackupEffect';
import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';
import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingKeepAwake } from '@/features/recording/hooks/useRecordingKeepAwake';
import { useRecordingHandlers } from '@/features/recording/hooks/useRecordingHandlers';
import { styles } from '@/features/recording/RecordingScreen.styles';
import type { ActivityType } from '@/types';

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

  // Snapshot coordinates for the map/lock overlay. Keyed on length because the
  // underlying latlng array is mutated in place. The slice gives consumers a
  // stable reference that only changes when a point is added.
  const coordinates = useMemo(
    () => useRecordingStore.getState().streams.latlng.slice(),
    [latlngLength]
  );

  const {
    isLocked,
    setIsLocked,
    gpsWarning,
    setGpsWarning,
    autoPaused,
    setAutoPaused,
    splitBanner,
    setSplitBanner,
    showTypePicker,
    setShowTypePicker,
    hrZoneColor,
    setHrZoneColor,
  } = useRecordingScreenState();

  const { textPrimary, textSecondary, bg, surface, border } = useRecordingScreenColors();

  // Data fields from store
  const dataFields = useRecordingPreferences((s) => s.dataFields[mode]);

  const statusPulse = useStatusPulseAnimation(status);
  useLockOnRecordingEffect(status, setIsLocked);

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
  useHrZoneColorEffect(heartrateLength, setHrZoneColor);
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
      <HrZoneBar hrZoneColor={hrZoneColor} />

      <TimerHeader
        formattedElapsed={formattedElapsed}
        currentActivityType={currentActivityType}
        status={status}
        statusPulse={statusPulse}
        mode={mode}
        accuracy={accuracy}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        border={border}
        onOpenTypePicker={() => setShowTypePicker(true)}
      />

      <GpsWarningBanner gpsWarning={gpsWarning} setGpsWarning={setGpsWarning} />
      <AutoPauseBanner autoPaused={autoPaused} />
      <KmSplitBanner splitBanner={splitBanner} />

      {/* Main Content Area */}
      <View style={styles.mainContent}>
        {mode === 'gps' ? (
          <RecordingMap
            coordinates={coordinates}
            currentLocation={currentLocation}
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
        fields={
          dataFields ??
          (mode === 'gps'
            ? ['speed', 'distance', 'heartrate', 'power']
            : ['heartrate', 'power', 'cadence', 'timer'])
        }
        metrics={metrics}
        isMetric={isMetric}
      />

      {/* Controls */}
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

      <RelockButton isLocked={isLocked} topInset={insets.top} onLock={() => setIsLocked(true)} />

      {/* Lock overlay */}
      <LockOverlay
        visible={isLocked}
        elapsed={formattedElapsed}
        distance={formatDistance(metrics.distance ?? 0, isMetric)}
        onUnlock={() => setIsLocked(false)}
        mode={mode}
        status={status === 'recording' || status === 'paused' ? status : 'idle'}
        accuracy={accuracy}
        coordinates={coordinates}
        currentLocation={currentLocation}
        activityType={currentActivityType}
        speed={metrics.speed > 0 ? formatSpeed(metrics.speed, isMetric) : undefined}
        heartrate={metrics.heartrate > 0 ? metrics.heartrate : undefined}
      />

      {/* Activity type picker modal */}
      <ActivityTypePickerModal
        visible={showTypePicker}
        selectedType={currentActivityType}
        onSelect={handleChangeType}
        onClose={() => setShowTypePicker(false)}
        mode="recording"
        isDark={isDark}
      />
    </View>
  );
}
