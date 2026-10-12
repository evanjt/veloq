import React, { useCallback, useMemo } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  ScreenSafeAreaView,
  EmptyState,
  ErrorState,
  useTabBarClearance,
  screenListInsets,
} from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { IconButton } from '@/shared/ui/IconButton';
import { useTheme, useMetricSystem } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import { formatDistance, formatDuration, getIntlLocale } from '@/shared/format/format';
import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';
import {
  useRecordingLibrary,
  recordingActions,
  PermissionUpgradeBanner,
  uploadStatusTone,
} from '@/features/recording';
import type { RecordingLibraryEntry } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function RecordingsLibraryScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();
  const isMetric = useMetricSystem();
  const { entries, isLoading, error, refresh, uploadNow, uploadingId } = useRecordingLibrary();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const meta = useMemo(() => uploadStatusTone(isDark), [isDark]);

  const renderEntry = useCallback(
    ({ item }: { item: RecordingLibraryEntry }) => {
      const status = meta[item.uploadStatus] ?? meta.localOnly;
      const date = new Date(item.startTime);
      // The same rule the detail screen offers its upload on, so a row and the
      // recording it opens never disagree about whether a send is still owed.
      const { canUpload, isUploading } = recordingActions(item, uploadingId);
      const offerUpload = canUpload && !isUploading;
      const dateText = date.toLocaleDateString(getIntlLocale());
      const distanceText =
        item.distanceMeters > 0 ? formatDistance(item.distanceMeters, isMetric) : null;
      const durationText = item.durationSeconds > 0 ? formatDuration(item.durationSeconds) : null;
      const statusText = t(`recording.library.status.${item.uploadStatus}`);
      const uploadLabel = t('recording.library.uploadNow', 'Upload now');
      const upload = () => uploadNow(item.id);
      const label = [item.name, dateText, distanceText, durationText, statusText]
        .filter((part): part is string => !!part)
        .join(', ');
      // The retry is drawn inside the row's own button, where a screen reader
      // never stops, so the row offers it as an action too.
      return (
        <View style={styles.entry}>
          <Card
            variant="flat"
            padding="sm"
            style={{ flexDirection: 'row', alignItems: 'center' }}
            testID={`recording-entry-${item.id}`}
            onPress={() => tapTo(`/recordings/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={label}
            actions={
              offerUpload ? [{ name: 'uploadNow', label: uploadLabel, run: upload }] : undefined
            }
          >
            <MaterialCommunityIcons
              name={getActivityIcon(item.activityType)}
              size={26}
              color={getActivityColor(item.activityType)}
              style={styles.activityIcon}
            />
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.cardMeta, { color: textSecondary }]} numberOfLines={1}>
                {dateText}
                {distanceText ? ` · ${distanceText}` : ''}
                {durationText ? ` · ${durationText}` : ''}
              </Text>
            </View>
            <View
              testID={`recording-status-${item.uploadStatus}`}
              style={[styles.statusChip, { backgroundColor: colorWithOpacity(status.color, 0.12) }]}
            >
              <MaterialCommunityIcons name={status.icon} size={14} color={status.color} />
              <Text style={[styles.statusText, { color: status.color }]}>{statusText}</Text>
            </View>
            {isUploading ? (
              <View testID={`recording-uploading-${item.id}`} style={styles.rowAction}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null}
            {offerUpload ? (
              <IconButton
                testID={`recording-retry-${item.id}`}
                onPress={upload}
                accessibilityLabel={uploadLabel}
              >
                <MaterialCommunityIcons
                  name="cloud-upload-outline"
                  size={20}
                  color={colors.primary}
                />
              </IconButton>
            ) : null}
          </Card>
        </View>
      );
    },
    [meta, textPrimary, textSecondary, isMetric, t, uploadNow, uploadingId]
  );

  return (
    <ScreenSafeAreaView hasNativeHeader style={[styles.container, { backgroundColor: bg }]}>
      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator />
        </View>
      ) : error != null ? (
        <View style={styles.centred}>
          <ErrorState
            error={error}
            fallbackKey="engine.failure.database"
            onRetry={() => void refresh()}
            testID="recordings-read-failure"
          />
        </View>
      ) : (
        <FlatList
          testID="recordings-list"
          {...screenListInsets}
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          ListHeaderComponent={
            entries.some((e) => e.uploadStatus === 'permissionBlocked') ? (
              <PermissionUpgradeBanner />
            ) : null
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarClearance }]}
          ListEmptyComponent={
            <EmptyState
              icon="record-circle-outline"
              title={t('recording.library.empty', 'No recordings yet')}
              description={t(
                'recording.library.emptyHint',
                'Recordings you save are kept here on this device.'
              )}
            />
          }
        />
      )}
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  entry: {
    marginBottom: spacing.sm,
  },
  activityIcon: {
    marginRight: spacing.sm,
  },
  cardBody: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    ...typography.bodyBold,
  },
  cardMeta: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  rowAction: {
    marginLeft: spacing.xs,
    padding: spacing.xs,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
  },
  statusText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
});

export default withScreenBoundary(RecordingsLibraryScreenContent, 'RecordingsLibrary');
