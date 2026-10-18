/**
 * What the bulk export row shows while the export is running.
 *
 * The write runs on a Rust thread and answers with a promise, so the JavaScript
 * thread is free to paint. Meanwhile the hook reads the worker's counters four
 * times a second: activities written, and how many it expects to visit. The row
 * shows that count as a progress bar, and a spinner only before the first read
 * brings a total, or while the share sheet opens. The size is real and arrives with the share.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatFileSize } from '@/shared/format/format';
import { Button, Spinner } from '@/shared/ui';
import { ProgressRow } from '@/shared/ui/ProgressRow';
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
  /** Stops the write. Not offered once the share sheet opens, since the file is whole. */
  onCancel: () => void;
}

export function BulkExportProgress({
  phase,
  format,
  current,
  total,
  sizeBytes,
  isDark,
  onCancel,
}: BulkExportProgressProps) {
  const { t } = useTranslation();
  const counting = phase === 'generating' && total > 0;
  const label =
    phase === 'sharing'
      ? t('export.bulkSharing')
      : t('export.bulkExporting', { format: BULK_EXPORT_FORMAT_NAME[format] });

  return (
    <View style={styles.row}>
      {!counting && <Spinner label={label} testID="bulk-export-spinner" />}
      <ProgressRow
        label={label}
        done={current}
        total={counting ? total : 0}
        counts={t('export.bulkCount', { current, total })}
        countsTestID="bulk-export-count"
        barTestID="bulk-export-progress"
        action={
          phase === 'generating' ? (
            <Button
              testID="bulk-export-cancel"
              label={t('common.cancel')}
              variant="secondary"
              size="sm"
              onPress={onCancel}
            />
          ) : undefined
        }
        labelStyle={[styles.label, isDark && styles.labelDark]}
        detailStyle={[styles.detail, isDark && styles.detailDark]}
      >
        {sizeBytes > 0 && (
          <Text style={[styles.detail, isDark && styles.detailDark]}>
            {formatFileSize(sizeBytes)}
          </Text>
        )}
      </ProgressRow>
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
  label: {
    ...typography.body,
    color: colors.textPrimary,
  },
  labelDark: {
    color: colors.textOnFill,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
});
