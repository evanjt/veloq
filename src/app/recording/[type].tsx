import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Keyboard,
  Alert,
  Linking,
  Animated,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useKeepAwake } from 'expo-keep-awake';
import { useTheme, useMetricSystem } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { navigateTo } from '@/lib';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { getRecordingMode } from '@/lib/utils/recordingModes';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import { formatDuration, formatDistance, formatPace, formatSpeed } from '@/lib';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useRecordingPreferences } from '@/providers/RecordingPreferencesStore';
import { useHRZones } from '@/providers/HRZonesStore';
import { createAutoPauseDetector } from '@/lib/recording/autoPause';
import { saveRecordingBackup, clearRecordingBackup } from '@/lib/storage/recordingBackup';
import { RecordingMap } from '@/components/recording/RecordingMap';
import { DataFieldGrid } from '@/components/recording/DataFieldGrid';
import { ControlBar } from '@/components/recording/ControlBar';
import { LockOverlay } from '@/components/recording/LockOverlay';
import { GpsSignalIndicator } from '@/components/recording/GpsSignalIndicator';
import { ActivityTypePickerModal } from '@/components/recording/ActivityTypePickerModal';
import { useTimer } from '@/hooks/recording/useTimer';
import { useLocationTracking } from '@/hooks/recording/useLocationTracking';
import { useRecordingMetrics } from '@/hooks/recording/useRecordingMetrics';
import { debug } from '@/lib';
import type { ActivityType, RecordingMode } from '@/types';
import type { AutoPauseConfig } from '@/lib/recording/autoPause';

const log = debug.create('RecordingScreen');

// How long to wait before showing GPS warning banner
const GPS_WARNING_MS = 20_000;

// How long to wait before showing GPS alert dialog
const GPS_ALERT_MS = 60_000;

// Crash recovery backup interval (15s to finish before iOS ~30s background limit)
const BACKUP_INTERVAL_MS = 15_000;

// Km split banner display duration
const SPLIT_BANNER_DURATION_MS = 3_000;

export default function RecordingScreen() {
  useKeepAwake();

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
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [splitBanner, setSplitBanner] = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const gpsWarningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gpsAlertRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gpsAlertShownRef = useRef(false);
  const splitBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusPulse = useRef(new Animated.Value(1)).current;
  const handleLock = useCallback(() => setIsLocked(true), []);
  const handleUnlock = useCallback(() => setIsLocked(false), []);

  // Auto-pause preferences
  const autoPauseEnabled = useRecordingPreferences((s) => s.autoPauseEnabled);
  const autoPauseThresholds = useRecordingPreferences((s) => s.autoPauseThresholds);

  // Data fields from store
  const dataFields = useRecordingPreferences((s) => s.dataFields[mode]);

  // HR zones for zone bar
  const hrZones = useHRZones((s) => s.zones);
  const maxHR = useHRZones((s) => s.maxHR);

  // HR zone bar colour
  const [hrZoneColor, setHrZoneColor] = useState<string | null>(null);
  const prevHrZoneColorRef = useRef<string | null>(null);

  // Auto-pause detector
  const sportCategory = useMemo(() => {
    const lower = activityType.toLowerCase();
    if (lower.includes('ride') || lower.includes('cycling') || lower.includes('bike'))
      return 'cycling';
    if (lower.includes('run') || lower.includes('treadmill')) return 'running';
    if (lower.includes('walk') || lower.includes('hike')) return 'walking';
    return 'cycling';
  }, [activityType]);

  const autoPauseDetectorRef = useRef(
    createAutoPauseDetector({
      enabled: autoPauseEnabled,
      speedThreshold: (autoPauseThresholds[sportCategory] ?? 2) / 3.6, // km/h to m/s
      durationThreshold: 3000,
    } as AutoPauseConfig)
  );

  // Update detector config when preferences change
  useEffect(() => {
    autoPauseDetectorRef.current = createAutoPauseDetector({
      enabled: autoPauseEnabled,
      speedThreshold: (autoPauseThresholds[sportCategory] ?? 2) / 3.6,
      durationThreshold: 3000,
    } as AutoPauseConfig);
  }, [autoPauseEnabled, autoPauseThresholds, sportCategory]);

  // Km split tracking
  const lastSplitDistanceRef = useRef(0);

  // Re-lock when recording resumes
  useEffect(() => {
    if (status === 'recording') setIsLocked(true);
  }, [status]);

  // Pulsing status dot animation
  useEffect(() => {
    if (status === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(statusPulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(statusPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      statusPulse.setValue(1);
    }
  }, [status, statusPulse]);

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

  // Clear GPS warning once we get a valid location
  useEffect(() => {
    if (currentLocation && gpsWarning) {
      setGpsWarning(null);
    }
  }, [currentLocation, gpsWarning]);

  // Auto-pause: check speed on each location update
  useEffect(() => {
    if (mode !== 'gps' || !autoPauseEnabled) return;
    if (status !== 'recording' && status !== 'paused') return;

    const lastSpeed = streams.speed[streams.speed.length - 1];
    if (lastSpeed == null) return;

    const result = autoPauseDetectorRef.current.update(lastSpeed, Date.now());
    if (result === 'pause' && status === 'recording') {
      useRecordingStore.getState().pauseRecording();
      setAutoPaused(true);
    } else if (result === 'resume' && status === 'paused' && autoPaused) {
      useRecordingStore.getState().resumeRecording();
      setAutoPaused(false);
    }
  }, [streams.speed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Km split detection
  useEffect(() => {
    if (mode !== 'gps' || status !== 'recording') return;

    const totalDistance = streams.distance[streams.distance.length - 1] ?? 0;
    const splitUnit = isMetric ? 1000 : 1609.344; // 1 km or 1 mile
    const nextSplitDistance = lastSplitDistanceRef.current + splitUnit;

    if (totalDistance >= nextSplitDistance && lastSplitDistanceRef.current > 0) {
      const splitIndex = Math.round(nextSplitDistance / splitUnit);
      lastSplitDistanceRef.current = splitIndex * splitUnit;

      // Compute split pace: find time at previous and current split
      const prevSplitDist = (splitIndex - 1) * splitUnit;
      let prevSplitTime = 0;
      let currSplitTime = 0;
      for (let i = 0; i < streams.distance.length; i++) {
        if (streams.distance[i] >= prevSplitDist && prevSplitTime === 0) {
          prevSplitTime = streams.time[i];
        }
        if (streams.distance[i] >= nextSplitDistance && currSplitTime === 0) {
          currSplitTime = streams.time[i];
          break;
        }
      }
      const splitSeconds = currSplitTime - prevSplitTime;
      const splitPace =
        splitSeconds > 0
          ? isMetric
            ? formatPace(splitUnit / splitSeconds, true)
            : formatPace(splitUnit / splitSeconds, false)
          : '--';

      const unitLabel = isMetric ? 'km' : 'mi';
      const banner = t('recording.splitBanner', {
        unit: unitLabel,
        index: splitIndex,
        pace: splitPace,
      });

      setSplitBanner(banner);
      if (splitBannerTimerRef.current) clearTimeout(splitBannerTimerRef.current);
      splitBannerTimerRef.current = setTimeout(
        () => setSplitBanner(null),
        SPLIT_BANNER_DURATION_MS
      );
    } else if (totalDistance > 0 && lastSplitDistanceRef.current === 0) {
      // Initialize the split tracker once we have distance
      lastSplitDistanceRef.current = 0;
    }
  }, [streams.distance.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup split banner timer
  useEffect(() => {
    return () => {
      if (splitBannerTimerRef.current) clearTimeout(splitBannerTimerRef.current);
    };
  }, []);

  // HR zone bar colour update
  useEffect(() => {
    const lastHR = streams.heartrate[streams.heartrate.length - 1];
    if (!lastHR || lastHR <= 0 || !maxHR) {
      setHrZoneColor(null);
      return;
    }

    const hrPercent = lastHR / maxHR;
    let zoneColor: string | null = null;
    for (const zone of hrZones) {
      if (hrPercent >= zone.min && hrPercent < zone.max) {
        zoneColor = zone.color;
        break;
      }
    }
    // If above all zones, use the last zone colour
    if (!zoneColor && hrPercent >= 1.0 && hrZones.length > 0) {
      zoneColor = hrZones[hrZones.length - 1].color;
    }

    if (zoneColor && zoneColor !== prevHrZoneColorRef.current) {
      prevHrZoneColorRef.current = zoneColor;
      setHrZoneColor(zoneColor);
    }
  }, [streams.heartrate.length, hrZones, maxHR]); // eslint-disable-line react-hooks/exhaustive-deps

  // Crash recovery: periodic backup
  useEffect(() => {
    if (status !== 'recording') return;
    const interval = setInterval(() => {
      const state = useRecordingStore.getState();
      saveRecordingBackup({
        activityType,
        mode,
        startTime: state.startTime ?? Date.now(),
        pausedDuration: state.pausedDuration,
        streams: state.streams,
        laps: state.laps,
        pairedEventId: state.pairedEventId,
        savedAt: Date.now(),
      });
    }, BACKUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, activityType, mode]);

  // Start location tracking for GPS mode
  useEffect(() => {
    if (mode !== 'gps' || status !== 'recording') return;
    let cancelled = false;

    (async () => {
      try {
        if (!hasPermission) {
          const granted = await requestPermission();
          if (!granted) {
            if (!cancelled) {
              log.warn('Location permission denied — pausing recording');
              setGpsWarning(t('recording.gpsPermissionDenied'));
              useRecordingStore.getState().pauseRecording();
            }
            return;
          }
        }
        await startTracking();

        // Stage 1: Warning banner after 20s without GPS
        if (!cancelled) {
          gpsWarningRef.current = setTimeout(() => {
            const loc = useRecordingStore.getState().streams.latlng;
            if (loc.length === 0) {
              setGpsWarning(t('recording.gpsWaiting'));
            }
          }, GPS_WARNING_MS);
        }

        // Stage 2: Alert dialog after 60s without GPS
        if (!cancelled) {
          gpsAlertRef.current = setTimeout(() => {
            const loc = useRecordingStore.getState().streams.latlng;
            if (loc.length === 0 && !gpsAlertShownRef.current) {
              gpsAlertShownRef.current = true;
              Alert.alert(
                t('recording.gpsAlertTitle', 'GPS Signal Not Found'),
                t(
                  'recording.gpsAlertMessage',
                  'Unable to get a GPS fix. Check that location services are enabled and you have a clear view of the sky.'
                ),
                [
                  {
                    text: t('recording.gpsAlertContinue', 'Continue Without GPS'),
                    style: 'cancel',
                    onPress: () => setGpsWarning(null),
                  },
                  {
                    text: t('recording.gpsAlertSettings', 'Open Settings'),
                    onPress: () => Linking.openSettings(),
                  },
                  {
                    text: t('recording.gpsAlertStop', 'Stop Recording'),
                    style: 'destructive',
                    onPress: () => handleDiscard(),
                  },
                ]
              );
            }
          }, GPS_ALERT_MS);
        }
      } catch (e) {
        log.error('Failed to start location tracking:', e);
        if (!cancelled) {
          setGpsWarning(t('recording.gpsTrackingError'));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (gpsWarningRef.current) {
        clearTimeout(gpsWarningRef.current);
        gpsWarningRef.current = null;
      }
      if (gpsAlertRef.current) {
        clearTimeout(gpsAlertRef.current);
        gpsAlertRef.current = null;
      }
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
    autoPauseDetectorRef.current.reset();
    setAutoPaused(false);
    useRecordingStore.getState().pauseRecording();
  }, []);

  const handleResume = useCallback(() => {
    autoPauseDetectorRef.current.reset();
    setAutoPaused(false);
    useRecordingStore.getState().resumeRecording();
  }, []);

  const handleLap = useCallback(() => {
    useRecordingStore.getState().addLap();
  }, []);

  const handleStop = useCallback(async () => {
    useRecordingStore.getState().stopRecording();
    await stopTracking();
    await clearRecordingBackup();
    navigateTo('/recording/review');
  }, [stopTracking]);

  const handleDiscard = useCallback(async () => {
    useRecordingStore.getState().reset();
    await stopTracking();
    await clearRecordingBackup();
    router.replace('/');
  }, [stopTracking]);

  const handleChangeType = useCallback((newType: ActivityType) => {
    useRecordingStore.getState().changeActivityType(newType);
    setShowTypePicker(false);
  }, []);

  // Read current activity type from store (may change during recording)
  const currentActivityType = useRecordingStore((s) => s.activityType) ?? activityType;
  const currentActivityColor = getActivityColor(currentActivityType);

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
      {/* HR Zone Colour Bar */}
      {hrZoneColor && (
        <View testID="hr-zone-bar" style={[styles.hrZoneBar, { backgroundColor: hrZoneColor }]} />
      )}

      {/* Timer Header */}
      <View style={styles.timerHeader}>
        <Text testID="recording-timer" style={[styles.timerText, { color: textPrimary }]}>
          {formattedElapsed}
        </Text>
        <View style={styles.headerRight}>
          {/* Activity type badge */}
          <TouchableOpacity
            testID="recording-type-badge"
            style={[styles.typeBadge, { borderColor: border }]}
            onPress={() => setShowTypePicker(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={getActivityIcon(currentActivityType)}
              size={16}
              color={currentActivityColor}
            />
            <Text style={[styles.typeBadgeText, { color: textSecondary }]} numberOfLines={1}>
              {t(`activityTypes.${currentActivityType}`, currentActivityType)}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={14} color={textSecondary} />
          </TouchableOpacity>
          {/* Status badge */}
          <View testID="recording-status" style={styles.statusBadge}>
            <Animated.View
              style={[
                styles.statusDot,
                {
                  backgroundColor: status === 'recording' ? colors.error : '#F59E0B',
                  opacity: statusPulse,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: textSecondary }]}>
              {status === 'recording' ? t('recording.rec', 'REC') : t('recording.paused', 'PAUSED')}
            </Text>
            {mode === 'gps' && <GpsSignalIndicator accuracy={accuracy} />}
          </View>
        </View>
      </View>

      {/* GPS Warning Banner */}
      {gpsWarning && (
        <View style={styles.gpsWarningBanner}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#F59E0B" />
          <Text style={styles.gpsWarningText}>{gpsWarning}</Text>
          <TouchableOpacity
            onPress={() => setGpsWarning(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="close" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
      )}

      {/* Auto-Pause Banner */}
      {autoPaused && (
        <View style={styles.autoPauseBanner}>
          <View style={styles.autoPauseDot} />
          <Text style={styles.autoPauseText}>
            {t('recording.autoPaused')} — {t('recording.autoPausedHint')}
          </Text>
        </View>
      )}

      {/* Km Split Banner */}
      {splitBanner && (
        <View style={styles.splitBanner}>
          <MaterialCommunityIcons name="flag-variant" size={16} color="#FFFFFF" />
          <Text style={styles.splitBannerText}>{splitBanner}</Text>
        </View>
      )}

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

      {/* Re-lock button (top-right, only when unlocked) */}
      {!isLocked && (
        <TouchableOpacity
          testID="control-lock"
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
        mode={mode}
        status={status === 'recording' || status === 'paused' ? status : 'idle'}
        accuracy={accuracy}
        coordinates={streams.latlng}
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
  const [distanceError, setDistanceError] = useState(false);
  const [hrError, setHrError] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const themeColors = isDark ? darkColors : colors;
  const textPrimary = themeColors.textPrimary;
  const textSecondary = themeColors.textSecondary;
  const bg = themeColors.background;
  const surface = themeColors.surface;
  const border = themeColors.border;
  const errorColor = themeColors.error;

  const handleSave = useCallback(() => {
    Keyboard.dismiss();

    let hasError = false;

    const mins = parseFloat(durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setDurationError(true);
      hasError = true;
    } else {
      setDurationError(false);
    }

    if (distance) {
      const dist = parseFloat(distance);
      if (!Number.isFinite(dist) || dist < 0 || dist > 999) {
        setDistanceError(true);
        hasError = true;
      } else {
        setDistanceError(false);
      }
    } else {
      setDistanceError(false);
    }

    if (avgHr) {
      const hr = parseFloat(avgHr);
      if (!Number.isFinite(hr) || hr < 30 || hr > 250) {
        setHrError(true);
        hasError = true;
      } else {
        setHrError(false);
      }
    } else {
      setHrError(false);
    }

    if (hasError) return;

    setIsNavigating(true);

    // Initialize recording store with manual data then navigate to review
    useRecordingStore.getState().startRecording(activityType, 'manual', pairedEventId);

    // Navigate to review with manual params
    navigateTo({
      pathname: '/recording/review',
      params: {
        manual: 'true',
        name: name || undefined,
        durationSeconds: String(Math.round(mins * 60)),
        distance: distance ? String(parseFloat(distance) * 1000) : undefined, // km to m
        avgHr: avgHr || undefined,
        notes: notes || undefined,
      },
    });
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
          testID="manual-entry-name"
          accessibilityLabel={t('recording.activityName', 'Activity Name')}
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
          testID="manual-entry-duration"
          accessibilityLabel={t('recording.duration', 'Duration (minutes)')}
          style={[
            styles.input,
            {
              color: textPrimary,
              backgroundColor: surface,
              borderColor: durationError ? errorColor : border,
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
          <Text style={{ color: errorColor, fontSize: 12, marginTop: 2 }}>
            {t('recording.durationRequired', 'Please enter a valid duration.')}
          </Text>
        )}

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.distance', 'Distance (km)')}
        </Text>
        <TextInput
          testID="manual-entry-distance"
          accessibilityLabel={t('recording.distance', 'Distance (km)')}
          style={[
            styles.input,
            {
              color: textPrimary,
              backgroundColor: surface,
              borderColor: distanceError ? errorColor : border,
            },
          ]}
          value={distance}
          onChangeText={(v) => {
            setDistance(v);
            if (distanceError) setDistanceError(false);
          }}
          placeholder="0"
          placeholderTextColor={textSecondary}
          keyboardType="numeric"
        />
        {distanceError && (
          <Text style={{ color: errorColor, fontSize: 12, marginTop: 2 }}>
            {t('recording.distanceInvalid', 'Please enter a valid distance (0-999).')}
          </Text>
        )}

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.avgHr', 'Average Heart Rate (bpm)')}
        </Text>
        <TextInput
          testID="manual-entry-hr"
          accessibilityLabel={t('recording.avgHr', 'Average Heart Rate (bpm)')}
          style={[
            styles.input,
            {
              color: textPrimary,
              backgroundColor: surface,
              borderColor: hrError ? errorColor : border,
            },
          ]}
          value={avgHr}
          onChangeText={(v) => {
            setAvgHr(v);
            if (hrError) setHrError(false);
          }}
          placeholder="0"
          placeholderTextColor={textSecondary}
          keyboardType="numeric"
        />
        {hrError && (
          <Text style={{ color: errorColor, fontSize: 12, marginTop: 2 }}>
            {t('recording.hrInvalid', 'Please enter a valid heart rate (30-250).')}
          </Text>
        )}

        <Text style={[styles.fieldLabel, { color: textSecondary }]}>
          {t('recording.notes', 'Notes')}
        </Text>
        <TextInput
          testID="manual-entry-notes"
          accessibilityLabel={t('recording.notes', 'Notes')}
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
          testID="manual-entry-continue"
          label={t('recording.continue', 'Continue')}
          onPress={handleSave}
          disabled={isNavigating}
        />
      </ScrollView>
    </View>
  );
}

/** Simple styled button for manual entry */
function TouchableButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.buttonContainer}>
      <TouchableOpacity
        testID={testID}
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        disabled={disabled}
        style={[styles.primaryButton, { backgroundColor: brand.teal, opacity: disabled ? 0.5 : 1 }]}
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
  hrZoneBar: {
    height: 4,
  },
  timerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 80,
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
  // Auto-pause banner
  autoPauseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
  },
  autoPauseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9CA3AF',
  },
  autoPauseText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  // Km split banner
  splitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(34, 197, 94, 0.85)',
  },
  splitBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
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
  gpsWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  gpsWarningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#F59E0B',
  },
});
