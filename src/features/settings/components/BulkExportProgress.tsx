/**
 * What the bulk export row shows while the export is running.
 *
 * The write runs on a Rust thread and answers with a promise, so the JavaScript
 * thread is free to paint. Meanwhile the hook reads the worker's counters four
 * times a second: activities written, and how many it expects to visit. The row
 * shows that count, and a spinner only before the first read brings a total,
 * or while the share sheet opens. The size is real and arrives with the share.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatFileSize } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { BulkExportPhase } from '@/features/settings/lib/bulkExport';
import {
  BULK_EXPORT_FORMAT_NAME,
  type BulkExportKind,
} from '@/features/settings/lib/bulkExportFormat';

interface BulkExportProgressProps {
  phase: BulkExportPhase;
  /** The two pills drive this one row, so it has to say which is running. */
  format: BulkExportKind;
  /**
   * Activities visited so far, written or skipped, and of how many. A total of
   * 0 is not known yet.
   */
  current: number;
  total: number;
  sizeBytes: number;
  isDark: boolean;
}

export function BulkExportProgress({
  phase,
  format,
  current,
  total,
  sizeBytes,
  isDark,
}: BulkExportProgressProps) {
  const { t } = useTranslation();
  const counting = phase === 'generating' && total > 0;

  return (
    <View style={styles.row}>
      {!counting && (
        <ActivityIndicator size="small" color={colors.primary} testID="bulk-export-spinner" />
      )}
      <View style={styles.labels}>
        <Text style={[styles.label, isDark && styles.labelDark]}>
          {phase === 'sharing'
            ? t('export.bulkSharing')
            : t('export.bulkExporting', { format: BULK_EXPORT_FORMAT_NAME[format] })}
        </Text>
        {counting && (
          <Text testID="bulk-export-count" style={[styles.detail, isDark && styles.detailDark]}>
            {t('export.bulkCount', { current, total })}
          </Text>
        )}
        {sizeBytes > 0 && (
          <Text style={[styles.detail, isDark && styles.detailDark]}>
            {formatFileSize(sizeBytes)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labels: {
    flex: 1,
  },
  label: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  labelDark: {
    color: colors.textOnDark,
  },
  detail: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
});
