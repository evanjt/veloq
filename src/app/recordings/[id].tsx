import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';

import { ScreenSafeAreaView } from '@/shared/ui';
import { useTheme, useMetricSystem } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import { formatDistance, formatDuration, formatElevation } from '@/shared/format/format';
import { getActivityIcon, getActivityColor } from '@/features/activity/lib/activityUtils';
import { RecordingMap } from '@/features/recording/components/RecordingMap';
import {
  getRecording,
  readRecordingStreams,
} from '@/features/recording/lib/storage/recordingLibrary';
import { useRecordingLibrary } from '@/features/recording/hooks/useRecordingLibrary';
import type { RecordingLibraryEntry, RecordingStreams } from '@/types';

export default function RecordingDetailScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uploadNow, remove, uploadingId } = useRecordingLibrary();

  const [entry, setEntry] = useState<RecordingLibraryEntry | null>(null);
  const [streams, setStreams] = useState<RecordingStreams | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const found = await getRecording(id);
    setEntry(found);
    if (found) {
      setStreams(await readRecordingStreams(found));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const handleUpload = useCallback(async () => {
    if (!entry) return;
    await uploadNow(entry.id);
    await load();
  }, [entry, uploadNow, load]);

  const handleShare = useCallback(async () => {
    if (!entry) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(entry.fitPath, {
          mimeType: 'application/octet-stream',
          dialogTitle: `${entry.name}.fit`,
        });
      }
    } catch {
      // User cancelled or share unavailable
    }
  }, [entry]);

  const handleDelete = useCallback(() => {
    if (!entry) return;
    Alert.alert(
      t('recording.library.deleteConfirmTitle', 'Delete recording?'),
      t(
        'recording.library.deleteConfirmMessage',
        'This removes the recording from this device permanently.'
      ),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('recording.library.delete', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            await remove(entry.id);
            router.back();
          },
        },
      ]
    );
  }, [entry, remove, t]);

  if (loading) {
    return (
      <ScreenSafeAreaView style={[styles.container, styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator />
      </ScreenSafeAreaView>
    );
  }

  if (!entry) {
    return (
      <ScreenSafeAreaView style={[styles.container, styles.center, { backgroundColor: bg }]}>
        <Text style={{ color: textSecondary }}>
          {t('recording.library.notFound', 'Recording not found')}
        </Text>
      </ScreenSafeAreaView>
    );
  }

  const isUploading = uploadingId === entry.id || entry.uploadStatus === 'uploading';
  const canUpload = entry.uploadStatus !== 'uploaded' && !isUploading;
  const coordinates = streams?.latlng ?? [];

  const stats: Array<{ label: string; value: string }> = [
    {
      label: t('recording.library.recorded', 'Recorded'),
      value: new Date(entry.startTime).toLocaleString(),
    },
    { label: t('recording.duration', 'Duration'), value: formatDuration(entry.durationSeconds) },
  ];
  if (entry.distanceMeters > 0) {
    stats.push({
      label: t('recording.distance', 'Distance'),
      value: formatDistance(entry.distanceMeters, isMetric),
    });
  }
  if (entry.elevationGain != null && entry.elevationGain > 0) {
    stats.push({
      label: t('recording.elevation', 'Elevation'),
      value: formatElevation(entry.elevationGain, isMetric),
    });
  }
  if (entry.avgHeartrate != null && entry.avgHeartrate > 0) {
    stats.push({
      label: t('recording.avgHrLabel', 'Avg HR'),
      value: `${Math.round(entry.avgHeartrate)} bpm`,
    });
  }

  return (
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="recording-detail-back"
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <MaterialCommunityIcons
          name={getActivityIcon(entry.activityType)}
          size={22}
          color={getActivityColor(entry.activityType)}
          style={styles.headerIcon}
        />
        <Text style={[styles.headerTitle, { color: textPrimary }]} numberOfLines={1}>
          {entry.name}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        {coordinates.length >= 2 && (
          <View style={[styles.mapContainer, { borderColor: border }]}>
            <RecordingMap coordinates={coordinates} currentLocation={null} fitBounds />
          </View>
        )}

        <View style={[styles.statsCard, { backgroundColor: surface, borderColor: border }]}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.statRow}>
              <Text style={[styles.statLabel, { color: textSecondary }]}>{stat.label}</Text>
              <Text style={[styles.statValue, { color: textPrimary }]}>{stat.value}</Text>
            </View>
          ))}
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: textSecondary }]}>
              {t('recording.library.statusLabel', 'Status')}
            </Text>
            <Text style={[styles.statValue, { color: textPrimary }]}>
              {t(`recording.library.status.${entry.uploadStatus}`)}
            </Text>
          </View>
          {entry.lastError ? (
            <Text style={[styles.errorText, { color: colors.error }]} numberOfLines={3}>
              {entry.lastError}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          {canUpload && (
            <TouchableOpacity
              testID="recording-upload-button"
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleUpload}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="cloud-upload-outline"
                size={18}
                color={colors.textOnDark}
              />
              <Text style={styles.actionButtonText}>
                {t('recording.library.uploadNow', 'Upload now')}
              </Text>
            </TouchableOpacity>
          )}
          {isUploading && (
            <View style={[styles.actionButton, { backgroundColor: colors.primary }]}>
              <ActivityIndicator size="small" color={colors.textOnDark} />
            </View>
          )}
          <TouchableOpacity
            testID="recording-share-button"
            style={[styles.actionButton, styles.secondaryButton, { borderColor: border }]}
            onPress={handleShare}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="export-variant" size={18} color={textPrimary} />
            <Text style={[styles.secondaryButtonText, { color: textPrimary }]}>
              {t('recording.library.share', 'Share FIT file')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="recording-delete-button"
            style={[
              styles.actionButton,
              styles.secondaryButton,
              { borderColor: colorWithOpacity(colors.error, 0.4) },
            ]}
            onPress={handleDelete}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.error} />
            <Text style={[styles.secondaryButtonText, { color: colors.error }]}>
              {t('recording.library.delete', 'Delete')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
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
  headerIcon: {
    marginLeft: spacing.xs,
    marginRight: spacing.xs,
  },
  headerTitle: {
    ...typography.sectionTitle,
    flex: 1,
  },
  mapContainer: {
    height: 220,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  statsCard: {
    marginHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
  },
  statLabel: {
    ...typography.bodySmall,
  },
  statValue: {
    ...typography.bodyBold,
  },
  errorText: {
    ...typography.caption,
    paddingVertical: spacing.xs,
  },
  actions: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderRadius: layout.borderRadius,
    minHeight: layout.minTapTarget,
  },
  actionButtonText: {
    color: colors.textOnDark,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
