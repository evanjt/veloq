import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
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
import { useRecordingStore } from '@/providers/RecordingStore';
import { generateFitFile } from '@/lib/recording/fitGenerator';
import { intervalsApi } from '@/api';
import { enqueueUpload } from '@/lib/storage/uploadQueue';
import type { ActivityType } from '@/types';

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
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingOffline, setIsSavingOffline] = useState(false);

  const type = activityType ?? ('Ride' as ActivityType);

  // Compute summary stats
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

    const totalDistance = streams.distance[streams.distance.length - 1] ?? 0;
    const elapsed = startTime ? (Date.now() - startTime - pausedDuration) / 1000 : 0;

    // Calculate elevation gain
    let elevGain = 0;
    for (let i = 1; i < streams.altitude.length; i++) {
      const diff = streams.altitude[i] - streams.altitude[i - 1];
      if (diff > 0) elevGain += diff;
    }

    // Average heartrate
    const hrValues = streams.heartrate.filter((v) => v > 0);
    const avgHr =
      hrValues.length > 0 ? hrValues.reduce((s, v) => s + v, 0) / hrValues.length : null;

    // Average power
    const pwrValues = streams.power.filter((v) => v > 0);
    const avgPwr =
      pwrValues.length > 0 ? pwrValues.reduce((s, v) => s + v, 0) / pwrValues.length : null;

    return {
      duration: elapsed,
      distance: totalDistance,
      avgSpeed: elapsed > 0 ? totalDistance / elapsed : 0,
      elevationGain: elevGain,
      avgHeartrate: avgHr,
      avgPower: avgPwr,
      hasGps: streams.latlng.length > 0,
    };
  }, [isManual, params, streams, startTime, pausedDuration]);

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

  const handleSaveAndUpload = useCallback(async () => {
    setIsUploading(true);
    try {
      if (isManual) {
        // Manual activities use createManualActivity API
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
        const fitBuffer = await generateFitFile({
          activityType: type,
          startTime: new Date(startTime!),
          streams,
          laps,
          name,
        });
        await intervalsApi.uploadActivity(fitBuffer, `${name}.fit`, {
          name,
          pairedEventId: pairedEventId ?? undefined,
        });
      }

      useRecordingStore.getState().reset();
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert(
        t('recording.uploadError', 'Upload Failed'),
        t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
          error: message,
        }),
        [{ text: t('common.ok', 'OK') }]
      );
    } finally {
      setIsUploading(false);
    }
  }, [isManual, type, name, summary, notes, startTime, streams, laps, pairedEventId, t]);

  const handleSaveForLater = useCallback(async () => {
    setIsSavingOffline(true);
    try {
      if (isManual) {
        // For manual activities, just save locally and upload later
        // TODO: Implement manual activity offline queue
        Alert.alert(
          t('recording.saved', 'Saved'),
          t('recording.savedForLater', 'Activity saved for upload when online.')
        );
      } else {
        const fitBuffer = await generateFitFile({
          activityType: type,
          startTime: new Date(startTime!),
          streams,
          laps,
          name,
        });

        // Write FIT file to filesystem and enqueue
        const FileSystem = require('expo-file-system/legacy');
        const filePath = `${FileSystem.documentDirectory}pending_uploads/${Date.now()}.fit`;
        const dir = `${FileSystem.documentDirectory}pending_uploads/`;
        const dirInfo = await FileSystem.getInfoAsync(dir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        }

        // Convert ArrayBuffer to base64 for writing
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
      }

      useRecordingStore.getState().reset();
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert(t('recording.saveError', 'Save Failed'), message);
    } finally {
      setIsSavingOffline(false);
    }
  }, [isManual, type, name, startTime, streams, laps, pairedEventId, t]);

  const handleDiscard = useCallback(() => {
    Alert.alert(
      t('recording.discardTitle', 'Discard Activity?'),
      t('recording.discardMessage', 'This action cannot be undone.'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('recording.discard', 'Discard'),
          style: 'destructive',
          onPress: () => {
            useRecordingStore.getState().reset();
            router.replace('/');
          },
        },
      ]
    );
  }, [t]);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const activityColor = getActivityColor(type);
  const isProcessing = isUploading || isSavingOffline;

  return (
    <View style={[styles.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
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

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
      >
        {/* Activity Name */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: textSecondary }]}>
            {t('recording.activityName', 'Activity Name')}
          </Text>
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
        </View>

        {/* Summary Stats */}
        <View style={[styles.statsCard, { backgroundColor: surface, borderColor: border }]}>
          <Text style={[styles.statsTitle, { color: textPrimary }]}>
            {t('recording.summary', 'Summary')}
          </Text>

          <StatRow
            label={t('recording.distance', 'Distance')}
            value={formatDistance(summary.distance, isMetric)}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
          <StatRow
            label={t('recording.durationLabel', 'Duration')}
            value={formatDuration(summary.duration)}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
          {summary.avgSpeed > 0 && (
            <StatRow
              label={t('recording.avgSpeed', 'Avg Speed')}
              value={formatSpeed(summary.avgSpeed, isMetric)}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          )}
          {summary.elevationGain > 0 && (
            <StatRow
              label={t('recording.elevation', 'Elevation')}
              value={formatDistance(summary.elevationGain, isMetric)}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          )}
          {summary.avgHeartrate != null && summary.avgHeartrate > 0 && (
            <StatRow
              label={t('recording.avgHrLabel', 'Avg HR')}
              value={`${Math.round(summary.avgHeartrate)} bpm`}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          )}
          {summary.avgPower != null && summary.avgPower > 0 && (
            <StatRow
              label={t('recording.avgPower', 'Avg Power')}
              value={`${Math.round(summary.avgPower)} W`}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          )}
        </View>

        {/* Activity Type */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: textSecondary }]}>
            {t('recording.activityType', 'Activity Type')}
          </Text>
          <View style={[styles.typeChip, { backgroundColor: surface, borderColor: border }]}>
            <MaterialCommunityIcons name={getActivityIcon(type)} size={20} color={activityColor} />
            <Text style={[styles.typeText, { color: textPrimary }]}>
              {t(`activityTypes.${type}`, type)}
            </Text>
          </View>
        </View>

        {/* RPE */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: textSecondary }]}>
            {t('recording.rpe', 'RPE (Rate of Perceived Exertion)')}
          </Text>
          <View style={styles.rpeRow}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.rpeDot,
                  {
                    backgroundColor: val <= rpe ? brand.teal : surface,
                    borderColor: val <= rpe ? brand.teal : border,
                  },
                ]}
                onPress={() => !isProcessing && setRpe(val)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.rpeDotText, { color: val <= rpe ? '#FFFFFF' : textSecondary }]}
                >
                  {val}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: textSecondary }]}>
            {t('recording.notes', 'Notes')}
          </Text>
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
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: brand.teal }]}
            onPress={handleSaveAndUpload}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {t('recording.saveAndUpload', 'Save & Upload')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: border }]}
            onPress={handleSaveForLater}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            {isSavingOffline ? (
              <ActivityIndicator size="small" color={textPrimary} />
            ) : (
              <Text style={[styles.secondaryBtnText, { color: textPrimary }]}>
                {t('recording.saveForLater', 'Save for Later')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={handleDiscard}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            <Text style={styles.dangerBtnText}>{t('recording.discard', 'Discard')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function StatRow({
  label,
  value,
  textPrimary,
  textSecondary,
}: {
  label: string;
  value: string;
  textPrimary: string;
  textSecondary: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: textSecondary }]}>{label}</Text>
      <Text style={[styles.statValue, { color: textPrimary }]}>{value}</Text>
    </View>
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
  scrollContent: {
    paddingHorizontal: spacing.md,
  },
  section: {
    marginTop: spacing.lg,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  nameInput: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statsCard: {
    marginTop: spacing.lg,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  statsTitle: {
    ...typography.cardTitle,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
  },
  statLabel: {
    ...typography.body,
  },
  statValue: {
    ...typography.metricValue,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  typeText: {
    ...typography.body,
  },
  rpeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  rpeDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rpeDotText: {
    ...typography.captionBold,
  },
  notesInput: {
    ...typography.body,
    borderRadius: layout.borderRadiusSm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 80,
  },
  actions: {
    marginTop: spacing.xl,
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
  secondaryBtn: {
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minTapTarget,
  },
  secondaryBtnText: {
    ...typography.bodyBold,
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
});
