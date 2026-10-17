import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { isAutoBackupEnabled, setAutoBackupEnabled } from '@/features/settings/lib/autobackup';
import { colors, darkColors, iconSize, layout, spacing } from '@/theme';
import { tourPanelColour } from './tourPanel';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { Icon } from '@/shared/ui/Icon';

export function BackupSlide() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  // The switch the backup screen carries, on the same setting, so the first
  // backup runs on the scheduler's next trigger just as it would from there.
  const [autoEnabled, setAutoEnabled] = useState(() => isAutoBackupEnabled());
  const handleToggle = useCallback((value: boolean) => {
    setAutoBackupEnabled(value);
    setAutoEnabled(value);
  }, []);
  const primaryColor = isDark ? darkColors.actionPrimary : colors.actionPrimary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bgColor = tourPanelColour(isDark);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <Icon
            name={'database-export-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={iconSize.xl}
            color={primaryColor}
          />
        </View>
        <Icon
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={iconSize.lg}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <ChromeIcon name="share" size={iconSize.xl} color={primaryColor} />
        </View>
        <Icon
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={iconSize.lg}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <Icon
            name={'database-import-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={iconSize.xl}
            color={primaryColor}
          />
        </View>
      </View>
      <View style={[styles.switchRow, { backgroundColor: bgColor }]}>
        <SwitchRow
          icon="cloud-sync-outline"
          title={t('backup.autoBackup')}
          value={autoEnabled}
          onValueChange={handleToggle}
          testID="tour-backup-auto-switch"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  switchRow: {
    alignSelf: 'stretch',
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: layout.borderRadiusMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
