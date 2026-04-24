import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';
import type { DetectedBackup } from '@/hooks/auth';

interface BackupRestoreBannerProps {
  backup: DetectedBackup;
  isDismissed: boolean;
  onDismiss: () => void;
  onRestore: () => void;
  isRestoring: boolean;
}

export const BackupRestoreBanner = React.memo(function BackupRestoreBanner({
  backup,
  isDismissed,
  onDismiss,
  onRestore,
  isRestoring,
}: BackupRestoreBannerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (isDismissed) return null;

  return (
    <View style={[styles.banner, isDark && styles.bannerDark]}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="backup-restore" size={20} color={colors.primary} />
        <Text style={[styles.title, isDark && styles.titleDark]}>
          {t('backup.backupFound', { defaultValue: 'Backup Found' })}
        </Text>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons
            name="close"
            size={18}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
      <Text style={[styles.detail, isDark && styles.detailDark]}>
        {backup.entry.activityCount} {t('common.activities', { defaultValue: 'activities' })}
        {' · '}
        {new Date(backup.entry.timestamp).toLocaleDateString()}
        {' · '}
        {backup.backendName}
      </Text>
      <Button
        mode="contained"
        onPress={onRestore}
        loading={isRestoring}
        disabled={isRestoring}
        style={styles.button}
        icon="database-import-outline"
        compact
      >
        {isRestoring ? t('backup.importingDatabase') : t('backup.restoreFromBackup')}
      </Button>
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(252, 76, 2, 0.06)',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(252, 76, 2, 0.15)',
  },
  bannerDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
    borderColor: 'rgba(252, 76, 2, 0.2)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  detail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
  button: {
    alignSelf: 'flex-start',
  },
});
