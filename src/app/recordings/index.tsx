import React, { useCallback, useMemo } from 'react';
import { View, FlatList, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import {
  EmptyState,
  ErrorState,
  readableColumn,
  screenListInsets,
  ScreenSafeAreaView,
  useScrollEndInset,
  Spinner,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';
import { Shimmer, SkeletonFrame } from '@/shared/ui/Shimmer';
import { IconButton } from '@/shared/ui/IconButton';
import { useTheme, useMetricSystem } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  layout,
  opacity,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { formatDateTime, formatDistance, formatDuration } from '@/shared/format/format';
import { getActivityIcon, getActivityInk } from '@/shared/activity/activityUtils';
import {
  useRecordingLibrary,
  recordingActions,
  PermissionUpgradeBanner,
  uploadStatusTone,
} from '@/features/recording';
import type { RecordingLibraryEntry } from '@/types';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { NameText } from '@/shared/ui/NameText';
import { FitText } from '@/shared/ui/FitText';

/** Enough placeholder rows to fill a phone screen while the library is read. */
const PLACEHOLDER_ROWS = 6;

/** The list while the library is read, each row the shape of the recording card it becomes. */
function RecordingRowsSkeleton() {
  return (
    <ScrollView
      {...screenListInsets}
      scrollEnabled={false}
      contentContainerStyle={styles.listContent}
    >
      <SkeletonFrame>
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, row) => (
          <View key={row} testID="recording-row-skeleton" style={styles.entry}>
            <Card variant="flat" padding="sm" style={styles.entryCard}>
              <Shimmer
                width={iconSize.lg}
                height={iconSize.lg}
                borderRadius={layout.borderRadiusFull}
                style={styles.activityIcon}
              />
              <View style={styles.cardBody}>
                <Shimmer
                  width="60%"
                  height={typography.bodyBold.lineHeight}
                  borderRadius={layout.borderRadiusXs}
                />
                <Shimmer
                  width="80%"
                  height={typography.caption.lineHeight}
                  borderRadius={layout.borderRadiusXs}
                  style={styles.metaPlaceholder}
                />
              </View>
              <Shimmer
                width={spacing.xxl * 2}
                height={Math.max(iconSize.sm, typography.label.lineHeight) + 2 * spacing.xs}
                borderRadius={layout.borderRadiusSm}
              />
            </Card>
          </View>
        ))}
      </SkeletonFrame>
    </ScrollView>
  );
}

function RecordingsLibraryScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const scrollEndInset = useScrollEndInset({ insetTaken: true });
  const isMetric = useMetricSystem();
  const { entries, isLoading, error, refresh, uploadNow, uploadingId } = useRecordingLibrary();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;
  const meta = useMemo(() => uploadStatusTone(isDark), [isDark]);

  const renderEntry = useCallback(
    ({ item }: { item: RecordingLibraryEntry }) => {
      const status = meta[item.uploadStatus] ?? meta.localOnly;
      // The same rule the detail screen offers its upload on, so a row and the
      // recording it opens never disagree about whether a send is still owed.
      const { canUpload, isUploading } = recordingActions(item, uploadingId);
      const offerUpload = canUpload && !isUploading;
      const dateText = formatDateTime(new Date(item.startTime).toISOString());
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
            style={styles.entryCard}
            testID={`recording-entry-${item.id}`}
            onPress={() => navigateTo(`/recordings/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={label}
            actions={
              offerUpload ? [{ name: 'uploadNow', label: uploadLabel, run: upload }] : undefined
            }
          >
            <Icon
              name={getActivityIcon(item.activityType)}
              size={iconSize.lg}
              color={getActivityInk(item.activityType, isDark)}
              style={styles.activityIcon}
            />
            <View style={styles.cardBody}>
              <NameText style={[styles.cardTitle, { color: textPrimary }]}>{item.name}</NameText>
              <FitText style={[styles.cardMeta, { color: textSecondary }]}>
                {dateText}
                {distanceText ? ` · ${distanceText}` : ''}
                {durationText ? ` · ${durationText}` : ''}
              </FitText>
            </View>
            <View
              testID={`recording-status-${item.uploadStatus}`}
              style={[
                styles.statusChip,
                { backgroundColor: colorWithOpacity(status.color, opacity.tint2) },
              ]}
            >
              <Icon name={status.icon} size={iconSize.sm} color={status.color} />
              <Text style={[styles.statusText, { color: status.color }]}>{statusText}</Text>
            </View>
            {isUploading ? (
              <View testID={`recording-uploading-${item.id}`} style={styles.rowAction}>
                <Spinner label={t('recording.library.status.uploading')} />
              </View>
            ) : null}
            {offerUpload ? (
              <IconButton
                testID={`recording-retry-${item.id}`}
                onPress={upload}
                accessibilityLabel={uploadLabel}
              >
                <Icon
                  name="cloud-upload-outline"
                  size={iconSize.md}
                  color={palette.actionPrimary}
                />
              </IconButton>
            ) : null}
          </Card>
        </View>
      );
    },
    [
      meta,
      textPrimary,
      textSecondary,
      isMetric,
      isDark,
      palette.actionPrimary,
      t,
      uploadNow,
      uploadingId,
    ]
  );

  return (
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      {isLoading ? (
        <RecordingRowsSkeleton />
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
            ) : undefined
          }
          contentContainerStyle={[
            readableColumn,
            styles.listContent,
            { paddingBottom: scrollEndInset },
          ]}
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
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
  metaPlaceholder: {
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
    ...typography.badge,
  },
});

export default withScreenBoundary(RecordingsLibraryScreenContent, 'RecordingsLibrary');
