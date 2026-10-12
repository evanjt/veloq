import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenSafeAreaView, useHeroMapHeight } from '@/shared/ui';
import { Button } from '@/shared/ui/Button';
import { useTheme, useMetricSystem } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  getIntlLocale,
} from '@/shared/format/format';
import {
  recordingActions,
  RecordingMap,
  shareRecordingFit,
  useRecordingLibrary,
  useVisibleRecording,
} from '@/features/recording';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import * as haptics from '@/shared/ui/haptics';
import { goBack } from '@/shared/app/navigation';
import { confirmAction } from '@/shared/ui/dialog';

function RecordingDetailScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uploadNow, remove, uploadingId } = useRecordingLibrary();
  const mapHeight = useHeroMapHeight();
  const {
    entry,
    coordinates,
    fitAvailable,
    setFitAvailable,
    isLoading,
    error: loadError,
    reload: load,
  } = useVisibleRecording(id);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const errorDeep = isDark ? darkColors.errorDeep : colors.errorDeep;
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
    if (!entry || !recordingActions(entry, uploadingId).canShare) return;
    setFitAvailable(await shareRecordingFit(entry));
  }, [entry, uploadingId, setFitAvailable]);

  const handleDelete = useCallback(() => {
    if (!entry) return;
    confirmAction({
      title: t('recording.library.deleteConfirmTitle', 'Delete recording?'),
      message: t('recording.library.deleteConfirmMessage', {
        sport: t(`activityTypes.${entry.activityType}`, entry.activityType),
        startTime: new Date(entry.startTime).toLocaleString(getIntlLocale()),
        defaultValue:
          'This permanently removes the {{sport}} recording from {{startTime}} from this device.',
      }),
      confirmLabel: t('recording.library.delete', 'Delete'),
      cancelLabel: t('common.cancel', 'Cancel'),
      destructive: true,
      onConfirm: async () => {
        haptics.medium();
        await remove(entry.id);
        goBack();
      },
    });
  }, [entry, remove, t]);

  if (isLoading) {
    return (
      <ScreenSafeAreaView
        hasNativeHeader
        style={[styles.container, styles.center, { backgroundColor: bg }]}
      >
        <ActivityIndicator />
      </ScreenSafeAreaView>
    );
  }

  if (loadError != null) {
    return (
      <ScreenSafeAreaView
        hasNativeHeader
        style={[styles.container, styles.center, { backgroundColor: bg }]}
      >
        <ErrorState
          error={loadError}
          fallbackKey="engine.failure.database"
          onRetry={() => void load()}
          testID="recording-detail-read-failure"
        />
      </ScreenSafeAreaView>
    );
  }

  if (!entry) {
    return (
      <ScreenSafeAreaView
        hasNativeHeader
        style={[styles.container, styles.center, { backgroundColor: bg }]}
      >
        <EmptyState
          icon="record-circle-outline"
          title={t('recording.library.notFound', 'Recording not found')}
          actionLabel={t('common.back')}
          onAction={goBack}
        />
      </ScreenSafeAreaView>
    );
  }

  const { isUploading, canUpload, canShare } = recordingActions(entry, uploadingId, fitAvailable);

  const stats: { label: string; value: string }[] = [
    {
      label: t('recording.library.recorded', 'Recorded'),
      value: new Date(entry.startTime).toLocaleString(getIntlLocale()),
    },
    {
      label: t('recording.library.duration', 'Duration'),
      value: formatDuration(entry.durationSeconds),
    },
  ];
  if (entry.distanceMeters > 0) {
    stats.push({
      label: t('recording.library.distance', 'Distance'),
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
      value: formatHeartRate(entry.avgHeartrate),
    });
  }

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        {coordinates.length >= 2 && (
          <View style={[styles.mapContainer, { height: mapHeight, borderColor: border }]}>
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
            <Text style={[styles.errorText, { color: errorDeep }]} numberOfLines={3}>
              {entry.lastError}
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          {(canUpload || isUploading) && (
            <Button
              testID="recording-upload-button"
              label={t('recording.library.uploadNow', 'Upload now')}
              onPress={handleUpload}
              loading={isUploading}
              icon={
                <MaterialCommunityIcons
                  name="cloud-upload-outline"
                  size={18}
                  color={colors.textOnPrimary}
                />
              }
            />
          )}
          {canShare && (
            <Button
              testID="recording-share-button"
              label={t('recording.library.share', 'Share FIT file')}
              variant="secondary"
              onPress={handleShare}
              icon={<MaterialCommunityIcons name="export-variant" size={18} color={textPrimary} />}
            />
          )}
          <Button
            testID="recording-delete-button"
            label={t('recording.library.delete', 'Delete')}
            variant="destructive"
            opensConfirm
            onPress={handleDelete}
            icon={
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={18}
                color={colors.textOnPrimary}
              />
            }
          />
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
  mapContainer: {
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
    paddingVertical: spacing.xsPlus,
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
});

export default withScreenBoundary(RecordingDetailScreenContent, 'RecordingDetail');
