import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { getRecordingMode } from '@/lib/utils/recordingModes';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import { formatDuration, formatDistance } from '@/lib';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useRecordingPreferences } from '@/providers/RecordingPreferencesStore';
import { RecordingMap } from '@/components/recording/RecordingMap';
import { DataFieldGrid } from '@/components/recording/DataFieldGrid';
import { ControlBar } from '@/components/recording/ControlBar';
import { LockOverlay } from '@/components/recording/LockOverlay';
import { GpsSignalIndicator } from '@/components/recording/GpsSignalIndicator';
import { useTimer } from '@/hooks/recording/useTimer';
import { useLocationTracking } from '@/hooks/recording/useLocationTracking';
import { useRecordingMetrics } from '@/hooks/recording/useRecordingMetrics';
import type { ActivityType, RecordingMode } from '@/types';

// TODO: Add expo-keep-awake to keep screen on during recording

export default function RecordingScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const { type, pairedEventId } = useLocalSearchParams<{ type: string; pairedEventId?: string }>();

  const activityType = type as ActivityType;
  const mode = getRecordingMode(activityType);
  const status = useRecordingStore((s) => s.status);
  const startTime = useRecordingStore((s) => s.startTime);
  const streams = useRecordingStore((s) => s.streams);

  const [isLocked, setIsLocked] = useState(true);
  const handleLock = useCallback(() => setIsLocked(true), []);
  const handleUnlock = useCallback(() => setIsLocked(false), []);

  // Re-lock when recording resumes
  useEffect(() => {
    if (status === 'recording') setIsLocked(true);
  }, [status]);

  const { formattedElapsed, formattedMoving } = useTimer();
  const metrics = useRecordingMetrics();
  const {
    startTracking,
    stopTracking,
    currentLocation,
    hasPermission,
    requestPermission,
    accuracy,
  } = useLocationTracking();

  // Start location tracking for GPS mode
  useEffect(() => {
    if (mode !== 'gps' || status !== 'recording') return;
    (async () => {
      if (!hasPermission) {
        const granted = await requestPermission();
        if (!granted) return;
      }
      await startTracking();
    })();
    return () => {
      stopTracking();
    };
  }, [mode, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize recording on mount
  useEffect(() => {
    if (status === 'idle') {
      useRecordingStore
        .getState()
        .startRecording(activityType, mode, pairedEventId ? Number(pairedEventId) : undefined);
      useRecordingPreferences.getState().addRecentType(activityType);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePause = useCallback(() => {
    useRecordingStore.getState().pauseRecording();
  }, []);

  const handleResume = useCallback(() => {
    useRecordingStore.getState().resumeRecording();
  }, []);

  const handleLap = useCallback(() => {
    useRecordingStore.getState().addLap();
  }, []);

  const handleStop = useCallback(async () => {
    // No popup — the ControlBar stop button already requires a long press
    useRecordingStore.getState().stopRecording();
    await stopTracking();
    router.push('/recording/review');
  }, [stopTracking]);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const activityColor = getActivityColor(activityType);

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
      {/* Timer Header */}
      <View style={styles.timerHeader}>
        <Text style={[styles.timerText, { color: textPrimary }]}>{formattedElapsed}</Text>
        <View style={styles.statusBadge}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: status === 'recording' ? '#EF4444' : '#F59E0B' },
            ]}
          />
          <Text style={[styles.statusText, { color: textSecondary }]}>
            {status === 'recording' ? t('recording.rec', 'REC') : t('recording.paused', 'PAUSED')}
          </Text>
          {mode === 'gps' && <GpsSignalIndicator accuracy={accuracy} />}
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.mainContent}>
        {mode === 'gps' ? (
          <RecordingMap
            coordinates={streams.latlng}
            currentLocation={currentLocation}
            style={styles.map}
          />
        ) : (
          <View style={[styles.indoorDisplay, { backgroundColor: surface, borderColor: border }]}>
            <MaterialCommunityIcons
              name={getActivityIcon(activityType)}
              size={48}
              color={activityColor}
            />
            <Text style={[styles.indoorTimer, { color: textPrimary }]}>{formattedMoving}</Text>
          </View>
        )}
      </View>

      {/* Data Fields */}
      <DataFieldGrid
        fields={
          mode === 'gps'
            ? ['speed', 'distance', 'heartrate', 'power']
            : ['heartrate', 'power', 'cadence', 'timer']
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
        onLap={handleLap}
        style={{ paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING }}
      />

      {/* Re-lock button (top-right, only when unlocked) */}
      {!isLocked && (
        <TouchableOpacity
          style={[styles.relockButton, { top: insets.top + spacing.sm }]}
          onPress={handleLock}
          activeOpacity={0.7}
          accessibilityLabel={t('recording.controls.lock')}
        >
          <MaterialCommunityIcons name="lock-outline" size={20} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      )}

      {/* Lock overlay */}
      <LockOverlay
        visible={isLocked}
        elapsed={formattedElapsed}
        distance={formatDistance(metrics.distance ?? 0, isMetric)}
        onUnlock={handleUnlock}
      />
    </View>
  );
}

/** Manual activity entry form */
function ManualEntry({
  activityType,
  pairedEventId,
}: {
  activityType: ActivityType;
  pairedEventId?: number;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [notes, setNotes] = useState('');
  const [durationError, setDurationError] = useState(false);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const handleSave = useCallback(() => {
    const mins = parseFloat(durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setDurationError(true);
      return;
    }
    setDurationError(false);

    // Initialize recording store with manual data then navigate to review
    useRecordingStore.getState().startRecording(activityType, 'manual', pairedEventId);

    // Navigate to review with manual params
    router.push({
      pathname: '/recording/review',
      params: {
        manual: 'true',
        name: name || undefined,
        durationSeconds: String(Math.round(mins * 60)),
        distance: distance ? String(parseFloat(distance) * 1000) : undefined, // km to m
        avgHr: avgHr || undefined,
        notes: notes || undefined,
      },
    } as never);
  }, [activityType, pairedEventId, name, durationMinutes, distance, avgHr, notes, t]);

  return (
    <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      <View style={styles.manualHeader}>
        <MaterialCommunityIcons
          name="arrow-left"
          size={24}
          color={textPrimary}
          onPress={() => router.back()}
          style={styles.manualBackBtn}
        />
        <Text style={[styles.manualTitle, { color: textPrimary }]}>
          {t(`activityTypes.${activityType}`, activityType)}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.manualForm,
          { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
        ]}
      >
        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.activityName', 'Activity Name')}
        </Text>
        <TextInput
          style={[
            styles.input,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={name}
          onChangeText={setName}
          placeholder={t(`activityTypes.${activityType}`, activityType)}
          placeholderTextColor={textSecondary}
        />

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.duration', 'Duration (minutes)')} *
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              color: textPrimary,
              backgroundColor: surface,
              borderColor: durationError ? '#EF4444' : border,
            },
          ]}
          value={durationMinutes}
          onChangeText={(v) => {
            setDurationMinutes(v);
            if (durationError) setDurationError(false);
          }}
          placeholder="60"
          placeholderTextColor={textSecondary}
          keyboardType="numeric"
        />
        {durationError && (
          <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 2 }}>
            {t('recording.durationRequired', 'Please enter a valid duration.')}
          </Text>
        )}

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.distance', 'Distance (km)')}
        </Text>
        <TextInput
          style={[
            styles.input,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={distance}
          onChangeText={setDistance}
          placeholder="0"
          placeholderTextColor={textSecondary}
          keyboardType="numeric"
        />

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.avgHr', 'Average Heart Rate (bpm)')}
        </Text>
        <TextInput
          style={[
            styles.input,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={avgHr}
          onChangeText={setAvgHr}
          placeholder="0"
          placeholderTextColor={textSecondary}
          keyboardType="numeric"
        />

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.notes', 'Notes')}
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.notesInput,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('recording.notesPlaceholder', 'How did it feel?')}
          placeholderTextColor={textSecondary}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <TouchableButton
          label={t('recording.continue', 'Continue')}
          onPress={handleSave}
          isDark={isDark}
        />
      </ScrollView>
    </View>
  );
}

/** Simple styled button for manual entry */
function TouchableButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
  isDark: boolean;
}) {
  return (
    <View style={styles.buttonContainer}>
      <TouchableOpacity
        onPress={onPress}
        style={[styles.primaryButton, { backgroundColor: brand.teal }]}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryButtonText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  timerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  timerText: {
    ...typography.heroNumber,
    fontVariant: ['tabular-nums'],
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...typography.captionBold,
  },
  mainContent: {
    flex: 1,
    minHeight: 200,
  },
  map: {
    flex: 1,
  },
  indoorDisplay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  indoorTimer: {
    ...typography.heroNumber,
    marginTop: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  // Manual entry styles
  manualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  manualBackBtn: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    textAlignVertical: 'center',
  },
  manualTitle: {
    ...typography.sectionTitle,
    marginLeft: spacing.xs,
  },
  manualForm: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  fieldLabel: {
    ...typography.caption,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  notesInput: {
    minHeight: 100,
  },
  buttonContainer: {
    marginTop: spacing.lg,
  },
  primaryButton: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: layout.minTapTarget,
  },
  primaryButtonText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
  },
  relockButton: {
    position: 'absolute',
    right: spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
});
