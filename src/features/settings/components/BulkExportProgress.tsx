/**
 * What the bulk export row shows while the export is running.
 *
 * The export is one blocking FFI call, so there is no count to report until it
 * returns and nothing on the JavaScript thread could paint one if there were.
 * A spinner is a native view and keeps turning through the freeze, which is the
 * only honest thing this row can show. The size is real and arrives with the
 * share.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatFileSize } from '@/shared/format/format';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { BulkExportPhase } from '@/features/settings/lib/bulkExport';

interface BulkExportProgressProps {
  phase: BulkExportPhase;
  sizeBytes: number;
  isDark: boolean;
}

export function BulkExportProgress({ phase, sizeBytes, isDark }: BulkExportProgressProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <ActivityIndicator size="small" color={colors.primary} testID="bulk-export-spinner" />
      <View style={styles.labels}>
        <Text style={[styles.label, isDark && styles.labelDark]}>
          {phase === 'sharing' ? t('export.bulkSharing') : t('export.bulkExporting')}
        </Text>
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
    marginTop: 2,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
});
