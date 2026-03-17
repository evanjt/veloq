import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  FlatList,
  Dimensions,
  PanResponder,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, useMetricSystem } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { formatDistance, formatDuration, formatSpeed } from '@/lib';
import { getActivityIcon, getActivityColor } from '@/lib/utils/activityUtils';
import { generateRouteName } from '@/lib/geo/geocoding';
import * as Haptics from 'expo-haptics';
import { useRecordingStore } from '@/providers/RecordingStore';
import { generateFitFile } from '@/lib/recording/fitGenerator';
import { intervalsApi } from '@/api';
import { enqueueUpload } from '@/lib/storage/uploadQueue';
import { RecordingMap } from '@/components/recording/RecordingMap';
import { TrimSlider } from '@/components/recording/TrimSlider';
import type { ActivityType } from '@/types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAP_FRACTION = 0.45;

// Common activity types for the selector, ordered by popularity
const ACTIVITY_TYPE_OPTIONS: ActivityType[] = [
  'Ride',
  'Run',
  'VirtualRide',
  'Walk',
  'Hike',
  'Swim',
  'MountainBikeRide',
  'GravelRide',
  'TrailRun',
  'WeightTraining',
  'Yoga',
  'Rowing',
  'NordicSki',
  'AlpineSki',
  'Workout',
  'EBikeRide',
  'OpenWaterSwim',
  'Treadmill',
  'VirtualRun',
  'Other',
];

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Night';
}

function generateDefaultName(type: ActivityType): string {
  const timeOfDay = getTimeOfDay();
  const typeDisplay = type.replace(/([A-Z])/g, ' $1').trim();
  return `${timeOfDay} ${typeDisplay}`;
}

// RPE labels mapped to value ranges
function getRpeLabel(value: number): string {
  if (value <= 2) return 'Easy';
  if (value <= 4) return 'Moderate';
  if (value <= 6) return 'Hard';
  if (value <= 8) return 'Very Hard';
  return 'Max';
}

function getRpeColor(value: number): string {
  if (value <= 2) return '#22C55E';
  if (value <= 4) return '#84CC16';
  if (value <= 6) return '#EAB308';
  if (value <= 8) return '#F97316';
  return '#EF4444';
}

export default function ReviewScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const isMetric = useMetricSystem();
  const params = useLocalSearchParams<{
    manual?: string;
    name?: string;
    durationSeconds?: string;
    distance?: string;
    avgHr?: string;
    notes?: string;
  }>();

  const isManual = params.manual === 'true';
  const activityType = useRecordingStore((s) => s.activityType);
  const streams = useRecordingStore((s) => s.streams);
  const laps = useRecordingStore((s) => s.laps);
  const startTime = useRecordingStore((s) => s.startTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const pairedEventId = useRecordingStore((s) => s.pairedEventId);

  const [name, setName] = useState('');
  const [notes, setNotes] = useState(params.notes ?? '');
  const [rpe, setRpe] = useState(5);
  const [selectedType, setSelectedType] = useState<ActivityType>(
    activityType ?? ('Ride' as ActivityType)
  );
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const discardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardAnim = useRef(new Animated.Value(0)).current;

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(streams.latlng.length > 0 ? streams.latlng.length - 1 : 0);

  const type = selectedType;
  const canTrim = !isManual && streams.latlng.length > 2;
  const hasGps = !isManual && streams.latlng.length >= 2;

  const handleTrimChange = useCallback((startIdx: number, endIdx: number) => {
    setTrimStart(startIdx);
    setTrimEnd(endIdx);
  }, []);

  // Get trimmed streams for upload
  const getTrimmedStreams = useCallback(() => {
    if (!canTrim) return streams;
    return {
      latlng: streams.latlng.slice(trimStart, trimEnd + 1),
      altitude: streams.altitude.slice(trimStart, trimEnd + 1),
      distance: streams.distance.slice(trimStart, trimEnd + 1),
      heartrate: streams.heartrate.slice(trimStart, trimEnd + 1),
      power: streams.power.slice(trimStart, trimEnd + 1),
      cadence: streams.cadence.slice(trimStart, trimEnd + 1),
      speed: streams.speed.slice(trimStart, trimEnd + 1),
      time: streams.time.slice(trimStart, trimEnd + 1),
    };
  }, [canTrim, streams, trimStart, trimEnd]);

  // Compute summary stats (with optional trimming)
  const summary = useMemo(() => {
    if (isManual) {
      const durationSec = params.durationSeconds ? Number(params.durationSeconds) : 0;
      const distanceM = params.distance ? Number(params.distance) : 0;
      const avgHeartrate = params.avgHr ? Number(params.avgHr) : null;
      return {
        duration: durationSec,
        distance: distanceM,
        avgSpeed: durationSec > 0 && distanceM > 0 ? distanceM / durationSec : 0,
        elevationGain: 0,
        avgHeartrate,
        avgPower: null as number | null,
        hasGps: false,
      };
    }

    const s = canTrim ? getTrimmedStreams() : streams;

    const startDist = canTrim ? (streams.distance[trimStart] ?? 0) : 0;
    const endDist = canTrim
      ? (streams.distance[trimEnd] ?? 0)
      : (streams.distance[streams.distance.length - 1] ?? 0);
    const totalDistance = endDist - startDist;

    const elapsed = startTime
      ? canTrim && s.time.length >= 2
        ? (s.time[s.time.length - 1] - s.time[0]) / 1000
        : (Date.now() - startTime - pausedDuration) / 1000
      : 0;

    // Calculate elevation gain
    let elevGain = 0;
    for (let i = 1; i < s.altitude.length; i++) {
      const diff = s.altitude[i] - s.altitude[i - 1];
      if (diff > 0) elevGain += diff;
    }

    // Average heartrate
    const hrValues = s.heartrate.filter((v) => v > 0);
    const avgHr =
      hrValues.length > 0 ? hrValues.reduce((sum, v) => sum + v, 0) / hrValues.length : null;

    // Average power
    const pwrValues = s.power.filter((v) => v > 0);
    const avgPwr =
      pwrValues.length > 0 ? pwrValues.reduce((sum, v) => sum + v, 0) / pwrValues.length : null;

    return {
      duration: elapsed,
      distance: totalDistance,
      avgSpeed: elapsed > 0 ? totalDistance / elapsed : 0,
      elevationGain: elevGain,
      avgHeartrate: avgHr,
      avgPower: avgPwr,
      hasGps: s.latlng.length > 0,
    };
  }, [
    isManual,
    params,
    streams,
    startTime,
    pausedDuration,
    canTrim,
    trimStart,
    trimEnd,
    getTrimmedStreams,
  ]);

  // Compute trim delta when trimming is active
  const trimDelta = useMemo(() => {
    if (!canTrim || (trimStart === 0 && trimEnd === streams.latlng.length - 1)) return null;

    const fullDist =
      (streams.distance[streams.distance.length - 1] ?? 0) - (streams.distance[0] ?? 0);
    const fullElapsed =
      startTime && streams.time.length >= 2
        ? (streams.time[streams.time.length - 1] - streams.time[0]) / 1000
        : 0;

    const distDelta = summary.distance - fullDist;
    const durationDelta = summary.duration - fullElapsed;

    if (distDelta === 0 && durationDelta === 0) return null;
    return { distance: distDelta, duration: durationDelta };
  }, [canTrim, trimStart, trimEnd, streams, startTime, summary]);

  // Generate default name
  useEffect(() => {
    if (params.name) {
      setName(params.name);
      return;
    }

    const defaultName = generateDefaultName(type);
    setName(defaultName);

    // Try geocoding for GPS activities
    if (summary.hasGps && streams.latlng.length >= 2) {
      const first = streams.latlng[0];
      const last = streams.latlng[streams.latlng.length - 1];
      const isLoop = Math.abs(first[0] - last[0]) < 0.002 && Math.abs(first[1] - last[1]) < 0.002;
      generateRouteName(first[0], first[1], last[0], last[1], isLoop)
        .then((geoName) => {
          if (geoName) setName(geoName);
        })
        .catch(() => {
          // Keep default name
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save handler — tries upload, falls back to queue on failure
  const handleSave = useCallback(async () => {
    setIsUploading(true);
    setErrorMessage(null);
    setQueuedMessage(null);
    try {
      if (isManual) {
        await intervalsApi.createManualActivity({
          type,
          name,
          start_date_local: new Date().toISOString(),
          elapsed_time: summary.duration,
          distance: summary.distance > 0 ? summary.distance : undefined,
          average_heartrate: summary.avgHeartrate ?? undefined,
          description: notes || undefined,
        });
      } else {
        const trimmedStreams = getTrimmedStreams();
        const adjustedStart =
          canTrim && trimmedStreams.time.length > 0
            ? new Date(startTime! + trimmedStreams.time[0] * 1000)
            : new Date(startTime!);
        const fitBuffer = await generateFitFile({
          activityType: type,
          startTime: adjustedStart,
          streams: trimmedStreams,
          laps,
          name,
        });

        try {
          await intervalsApi.uploadActivity(fitBuffer, `${name}.fit`, {
            name,
            pairedEventId: pairedEventId ?? undefined,
          });
        } catch {
          // Network error → queue the pre-generated FIT for later upload
          try {
            const FileSystem = require('expo-file-system/legacy');
            const dir = `${FileSystem.documentDirectory}pending_uploads/`;
            const dirInfo = await FileSystem.getInfoAsync(dir);
            if (!dirInfo.exists) {
              await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
            }

            const filePath = `${dir}${Date.now()}.fit`;
            const bytes = new Uint8Array(fitBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            await FileSystem.writeAsStringAsync(filePath, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });

            await enqueueUpload({
              filePath,
              activityType: type,
              name,
              pairedEventId: pairedEventId ?? undefined,
              createdAt: Date.now(),
            });

            // Show queued message briefly then navigate
            setQueuedMessage(
              t(
                'recording.savedQueued',
                'Activity saved. It will upload automatically when you are back online.'
              )
            );
            setIsUploading(false);
            setTimeout(() => {
              useRecordingStore.getState().reset();
              router.replace('/');
            }, 1500);
            return;
          } catch {
            // Both upload and queue failed
            setErrorMessage(t('recording.saveError', 'Could not save activity. Please try again.'));
            return;
          }
        }
      }

      useRecordingStore.getState().reset();
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setErrorMessage(
        t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
          error: message,
        })
      );
    } finally {
      if (!queuedMessage) setIsUploading(false);
    }
  }, [
    isManual,
    type,
    name,
    summary,
    notes,
    startTime,
    laps,
    pairedEventId,
    t,
    getTrimmedStreams,
    canTrim,
    queuedMessage,
  ]);

  // Hold-to-discard
  const DISCARD_HOLD_MS = 1000;

  const clearDiscardTimer = useCallback(() => {
    if (discardTimerRef.current) {
      clearTimeout(discardTimerRef.current);
      discardTimerRef.current = null;
    }
    discardAnim.stopAnimation();
    discardAnim.setValue(0);
  }, [discardAnim]);

  useEffect(() => clearDiscardTimer, [clearDiscardTimer]);

  const handleDiscardPressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.timing(discardAnim, {
      toValue: 1,
      duration: DISCARD_HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    discardTimerRef.current = setTimeout(() => {
      clearDiscardTimer();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      useRecordingStore.getState().reset();
      router.replace('/');
    }, DISCARD_HOLD_MS);
  }, [clearDiscardTimer, discardAnim]);

  const handleDiscardPressOut = useCallback(() => {
    clearDiscardTimer();
  }, [clearDiscardTimer]);

  // RPE slider
  const rpeTrackWidth = useRef(0);
  const rpePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (rpeTrackWidth.current <= 0) return;
        const x = e.nativeEvent.locationX;
        const val = Math.round((x / rpeTrackWidth.current) * 9) + 1;
        setRpe(Math.max(1, Math.min(10, val)));
      },
      onPanResponderMove: (e) => {
        if (rpeTrackWidth.current <= 0) return;
        const x = e.nativeEvent.locationX;
        const val = Math.round((x / rpeTrackWidth.current) * 9) + 1;
        setRpe(Math.max(1, Math.min(10, val)));
      },
    })
  ).current;

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const activityColor = getActivityColor(type);
  const isProcessing = isUploading;
  const mapHeight = hasGps ? SCREEN_HEIGHT * MAP_FRACTION : 0;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Map hero (top portion) */}
      {hasGps && (
        <View style={[styles.mapContainer, { height: mapHeight, paddingTop: insets.top }]}>
          <RecordingMap
            coordinates={streams.latlng}
            currentLocation={null}
            fitBounds
            trimStart={canTrim ? trimStart : undefined}
            trimEnd={canTrim ? trimEnd : undefined}
            style={styles.map}
          />

          {/* Back button overlaid on map */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.mapBackButton, { top: insets.top + spacing.sm }]}
            disabled={isProcessing}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Trim slider overlaid at bottom of map */}
          {canTrim && (
            <View style={styles.trimOverlay}>
              <TrimSlider
                totalDuration={summary.duration}
                totalPoints={streams.latlng.length}
                startIdx={trimStart}
                endIdx={trimEnd}
                onTrimChange={handleTrimChange}
              />
            </View>
          )}
        </View>
      )}

      {/* Header (only for non-GPS activities) */}
      {!hasGps && (
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            disabled={isProcessing}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isProcessing ? textSecondary : textPrimary}
            />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textPrimary }]}>
            {t('recording.reviewActivity', 'Review Activity')}
          </Text>
        </View>
      )}

      {/* Bottom sheet content */}
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Activity Name */}
        <TextInput
          style={[
            styles.nameInput,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={name}
          onChangeText={setName}
          placeholder={generateDefaultName(type)}
          placeholderTextColor={textSecondary}
          editable={!isProcessing}
        />

        {/* Compact stat row */}
        <View style={styles.compactStats}>
          <View style={styles.compactStatItem}>
            <Text style={[styles.compactStatValue, { color: textPrimary }]}>
              {formatDuration(summary.duration)}
            </Text>
            <Text style={[styles.compactStatLabel, { color: textSecondary }]}>
              {t('recording.durationLabel', 'Duration')}
            </Text>
          </View>
          {summary.distance > 0 && (
            <View style={styles.compactStatItem}>
              <Text style={[styles.compactStatValue, { color: textPrimary }]}>
                {formatDistance(summary.distance, isMetric)}
              </Text>
              <Text style={[styles.compactStatLabel, { color: textSecondary }]}>
                {t('recording.fields.distance', 'Distance')}
              </Text>
            </View>
          )}
          {summary.elevationGain > 0 && (
            <View style={styles.compactStatItem}>
              <Text style={[styles.compactStatValue, { color: textPrimary }]}>
                {Math.round(summary.elevationGain)}{' '}
                {isMetric ? t('units.m', 'm') : t('units.ft', 'ft')} ↑
              </Text>
              <Text style={[styles.compactStatLabel, { color: textSecondary }]}>
                {t('recording.elevation', 'Elevation')}
              </Text>
            </View>
          )}
        </View>

        {/* Trim delta feedback */}
        {trimDelta && (
          <Text style={[styles.trimDelta, { color: textSecondary }]}>
            {t('recording.trimmed', 'Trimmed')}: {formatDistance(trimDelta.distance, isMetric)},{' '}
            {formatDuration(trimDelta.duration)}
          </Text>
        )}

        {/* Activity Type (tappable) */}
        <TouchableOpacity
          style={[styles.typeChip, { backgroundColor: surface, borderColor: border }]}
          onPress={() => !isProcessing && setShowTypeModal(true)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name={getActivityIcon(type)} size={20} color={activityColor} />
          <Text style={[styles.typeText, { color: textPrimary }]}>
            {t(`activityTypes.${type}`, type)}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={textSecondary} />
        </TouchableOpacity>

        {/* RPE Slider */}
        <View style={styles.rpeSection}>
          <View style={styles.rpeHeader}>
            <Text style={[styles.label, { color: textSecondary }]}>
              {t('recording.rpe', 'RPE')}
            </Text>
            <Text style={[styles.rpeValue, { color: getRpeColor(rpe) }]}>
              {rpe} — {getRpeLabel(rpe)}
            </Text>
          </View>
          <Text style={[styles.rpeDescription, { color: textSecondary }]}>
            {t('recording.rpeDescription', '1 = effortless, 10 = maximum effort')}
          </Text>
          <View
            style={[
              styles.rpeTrack,
              { backgroundColor: isDark ? darkColors.surfaceElevated : colors.backgroundAlt },
            ]}
            onLayout={(e) => {
              rpeTrackWidth.current = e.nativeEvent.layout.width;
            }}
            {...rpePan.panHandlers}
          >
            {/* Filled portion */}
            <View
              style={[
                styles.rpeFill,
                {
                  width: `${((rpe - 1) / 9) * 100}%` as `${number}%`,
                  backgroundColor: getRpeColor(rpe),
                },
              ]}
            />
            {/* Thumb */}
            <View
              style={[
                styles.rpeThumb,
                {
                  left: `${((rpe - 1) / 9) * 100}%` as `${number}%`,
                  backgroundColor: getRpeColor(rpe),
                },
              ]}
            />
          </View>
          {/* Scale labels */}
          <View style={styles.rpeScaleRow}>
            <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>1</Text>
            <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>5</Text>
            <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>10</Text>
          </View>
        </View>

        {/* Notes */}
        <TextInput
          style={[
            styles.notesInput,
            { color: textPrimary, backgroundColor: surface, borderColor: border },
          ]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('recording.notesPlaceholder', 'How did it feel?')}
          placeholderTextColor={textSecondary}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          editable={!isProcessing}
        />

        {/* Queued success message */}
        {queuedMessage && (
          <View style={styles.queuedBanner}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color="#22C55E" />
            <Text style={styles.queuedBannerText}>{queuedMessage}</Text>
          </View>
        )}

        {/* Error banner */}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: brand.teal }]}
            onPress={handleSave}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('common.save', 'Save')}</Text>
            )}
          </TouchableOpacity>

          {/* Hold-to-discard */}
          <Animated.View
            style={[
              styles.dangerBtn,
              {
                borderColor: discardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['rgba(239,68,68,0.3)', '#EF4444'],
                }),
                borderWidth: 1,
                overflow: 'hidden' as const,
              },
            ]}
            onTouchStart={isProcessing ? undefined : handleDiscardPressIn}
            onTouchEnd={handleDiscardPressOut}
            onTouchCancel={handleDiscardPressOut}
          >
            <Animated.View
              style={{
                position: 'absolute' as const,
                left: 0,
                top: 0,
                bottom: 0,
                backgroundColor: '#EF4444',
                opacity: 0.15,
                width: discardAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              }}
            />
            <Text style={styles.dangerBtnText}>{t('recording.discard', 'Discard')}</Text>
          </Animated.View>
        </View>
      </ScrollView>

      {/* Activity Type Modal */}
      <Modal visible={showTypeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: isDark ? darkColors.surface : '#FFFFFF' },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textPrimary }]}>
                {t('recording.activityType', 'Activity Type')}
              </Text>
              <TouchableOpacity onPress={() => setShowTypeModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color={textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={ACTIVITY_TYPE_OPTIONS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const isSelected = item === type;
                const itemColor = getActivityColor(item);
                return (
                  <TouchableOpacity
                    style={[
                      styles.typeOption,
                      isSelected && {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                      },
                    ]}
                    onPress={() => {
                      setSelectedType(item);
                      setShowTypeModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={getActivityIcon(item)}
                      size={22}
                      color={itemColor}
                    />
                    <Text style={[styles.typeOptionText, { color: textPrimary }]}>
                      {t(`activityTypes.${item}`, item)}
                    </Text>
                    {isSelected && (
                      <MaterialCommunityIcons name="check" size={20} color={brand.teal} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Map hero
  mapContainer: {
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  mapBackButton: {
    position: 'absolute',
    left: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  trimOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  // Non-GPS header
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
  // Bottom content
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  nameInput: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  // Compact stats
  compactStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  compactStatItem: {
    alignItems: 'center',
  },
  compactStatValue: {
    ...typography.metricValue,
    fontVariant: ['tabular-nums'],
  },
  compactStatLabel: {
    ...typography.caption,
    marginTop: 2,
  },
  trimDelta: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  // Activity type chip
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  typeText: {
    ...typography.body,
  },
  // RPE
  rpeSection: {
    marginTop: spacing.lg,
  },
  rpeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    ...typography.label,
  },
  rpeValue: {
    ...typography.bodyBold,
  },
  rpeDescription: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  rpeTrack: {
    height: 32,
    borderRadius: 16,
    position: 'relative',
    justifyContent: 'center',
  },
  rpeFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 16,
    opacity: 0.3,
  },
  rpeThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: -14,
    top: 2,
  },
  rpeScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  rpeScaleLabel: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  // Notes
  notesInput: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 60,
    marginTop: spacing.md,
  },
  // Banners
  queuedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  queuedBannerText: {
    ...typography.caption,
    color: '#22C55E',
    flex: 1,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorBannerText: {
    ...typography.caption,
    color: '#EF4444',
    textAlign: 'center',
  },
  // Actions
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  primaryBtn: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  primaryBtnText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
  },
  dangerBtn: {
    borderRadius: layout.borderRadiusSm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  dangerBtnText: {
    ...typography.bodyBold,
    color: '#EF4444',
  },
  // Activity Type Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    maxHeight: '60%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.2)',
  },
  modalTitle: {
    ...typography.sectionTitle,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: layout.minTapTarget,
  },
  typeOptionText: {
    ...typography.body,
    flex: 1,
  },
});
