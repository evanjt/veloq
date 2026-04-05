import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useExportDatabaseBackup,
  useImportDatabaseBackup,
  useExportBackup,
  useImportBackup,
  useBulkExport,
} from '@/hooks';
import { formatFileSize } from '@/lib';
import { useTheme } from '@/hooks';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { colors, darkColors, spacing, layout } from '@/theme';

export function BackupSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Database backup (primary)
  const { exportDatabaseBackup, exporting: dbExporting } = useExportDatabaseBackup();
  const { importDatabaseBackup, importing: dbImporting } = useImportDatabaseBackup();

  // Legacy JSON backup
  const { exportBackup: legacyExport, exporting: legacyExporting } = useExportBackup();
  const { importBackup: legacyImport, importing: legacyImporting } = useImportBackup();

  // Bulk GPX export
  const {
    exportAll,
    isExporting: bulkExporting,
    phase: bulkPhase,
    current: bulkCurrent,
    total: bulkTotal,
    sizeBytes: bulkSizeBytes,
  } = useBulkExport();

  const totalActivities = useMemo(() => getRouteEngine()?.getActivityCount() ?? 0, []);

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('backup.exportBackup').split(' ')[0].toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Database export (primary) */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={dbExporting ? undefined : exportDatabaseBackup}
          disabled={dbExporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="database-export-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {dbExporting ? t('backup.exportingDatabase') : t('backup.exportDatabase')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Database import */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={dbImporting ? undefined : importDatabaseBackup}
          disabled={dbImporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="database-import-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {dbImporting ? t('backup.importingDatabase') : t('backup.importDatabase')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Legacy JSON export */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={legacyExporting ? undefined : legacyExport}
          disabled={legacyExporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="cloud-upload-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {legacyExporting ? t('backup.exporting') : t('backup.exportBackup')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Legacy JSON import */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={legacyImporting ? undefined : legacyImport}
          disabled={legacyImporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="cloud-download-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>
            {legacyImporting ? t('backup.importing') : t('backup.importBackup')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <View style={[styles.divider, isDark && styles.dividerDark]} />

        {/* Bulk GPX export */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={bulkExporting ? undefined : exportAll}
          disabled={bulkExporting}
          activeOpacity={0.2}
        >
          <MaterialCommunityIcons name="zip-box-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {bulkExporting
                ? bulkPhase === 'compressing'
                  ? t('export.bulkCompressing')
                  : bulkPhase === 'sharing'
                    ? t('export.bulkSharing')
                    : t('export.bulkExporting', { current: bulkCurrent, total: bulkTotal })
                : t('export.bulkExport', { count: totalActivities })}
            </Text>
            {bulkExporting && (
              <>
                <View
                  style={[styles.progressBarContainer, isDark && styles.progressBarContainerDark]}
                >
                  <View
                    style={[
                      styles.progressBar,
                      {
                        width:
                          bulkTotal > 0 ? `${Math.round((bulkCurrent / bulkTotal) * 100)}%` : '0%',
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.progressDetail, isDark && styles.textMuted]}>
                  {bulkTotal > 0 ? `${Math.round((bulkCurrent / bulkTotal) * 100)}%` : '0%'}
                  {bulkSizeBytes > 0 && ` · ${formatFileSize(bulkSizeBytes)}`}
                </Text>
              </>
            )}
          </View>
          {!bulkExporting && (
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressBarContainerDark: {
    backgroundColor: darkColors.border,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressDetail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
