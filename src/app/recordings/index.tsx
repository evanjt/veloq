import React, { useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenSafeAreaView, EmptyState, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { useTheme, useMetricSystem } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { getActivityIcon, getActivityColor } from '@/features/activity/lib/activityUtils';
import { useRecordingLibrary } from '@/features/recording/hooks/useRecordingLibrary';
import type { RecordingLibraryEntry, RecordingUploadStatus } from '@/types';

const STATUS_META: Record<
  RecordingUploadStatus,
  { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; color: string }
> = {
  localOnly: { icon: 'cellphone', color: colors.textSecondary },
  pending: { icon: 'cloud-upload-outline', color: colors.secondary },
  uploading: { icon: 'cloud-upload', color: colors.secondary },
  uploaded: { icon: 'cloud-check-outline', color: colors.success },
  failed: { icon: 'cloud-alert', color: colors.error },
  permissionBlocked: { icon: 'shield-lock-outline', color: colors.warning },
};

export default function RecordingsLibraryScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const insets = useSafeAreaInsets();
  const { entries, isLoading } = useRecordingLibrary();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.background : colors.background;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  const renderEntry = useCallback(
    ({ item }: { item: RecordingLibraryEntry }) => {
      const status = STATUS_META[item.uploadStatus] ?? STATUS_META.localOnly;
      const date = new Date(item.startTime);
      return (
        <TouchableOpacity
          testID={`recording-entry-${item.id}`}
          style={[styles.card, { backgroundColor: surface, borderColor: border }]}
          onPress={() => navigateTo(`/recordings/${item.id}`)}
          activeOpacity={0.7}
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
              {date.toLocaleDateString()}
              {item.distanceMeters > 0 ? ` · ${formatDistance(item.distanceMeters, isMetric)}` : ''}
              {item.durationSeconds > 0 ? ` · ${formatDuration(item.durationSeconds)}` : ''}
            </Text>
          </View>
          <View
            testID={`recording-status-${item.uploadStatus}`}
            style={[styles.statusChip, { backgroundColor: colorWithOpacity(status.color, 0.12) }]}
          >
            <MaterialCommunityIcons name={status.icon} size={14} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>
              {t(`recording.library.status.${item.uploadStatus}`)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [surface, border, textPrimary, textSecondary, isMetric, t]
  );

  return (
    <ScreenSafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          testID="recordings-back"
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textPrimary }]}>
          {t('recording.library.title', 'My Recordings')}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          testID="recordings-list"
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING },
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: layout.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
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
    marginTop: 2,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: layout.borderRadiusSm,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
