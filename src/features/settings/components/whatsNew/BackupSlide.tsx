import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { isAutoBackupEnabled, setAutoBackupEnabled } from '@/features/settings/lib/autobackup';
import { colors, darkColors, spacing, layout, colorWithOpacity, ink, typography } from '@/theme';

const ICON_SIZE = 36;

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
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bgColor = isDark ? colorWithOpacity(ink.white, 0.06) : colorWithOpacity(ink.black, 0.04);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'database-export-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={ICON_SIZE}
            color={primaryColor}
          />
        </View>
        <MaterialCommunityIcons
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={24}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'share-variant-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={ICON_SIZE}
            color={primaryColor}
          />
        </View>
        <MaterialCommunityIcons
          name={'arrow-right' as keyof typeof MaterialCommunityIcons.glyphMap}
          size={24}
          color={mutedColor}
        />
        <View style={[styles.iconBox, { backgroundColor: bgColor }]}>
          <MaterialCommunityIcons
            name={'database-import-outline' as keyof typeof MaterialCommunityIcons.glyphMap}
            size={ICON_SIZE}
            color={primaryColor}
          />
        </View>
      </View>
      <View style={[styles.switchRow, { backgroundColor: bgColor }]}>
        <MaterialCommunityIcons name="cloud-sync-outline" size={22} color={mutedColor} />
        <Text
          style={[
            styles.switchLabel,
            { color: isDark ? darkColors.textPrimary : colors.textPrimary },
          ]}
        >
          {t('backup.autoBackup')}
        </Text>
        <Switch
          testID="tour-backup-auto-switch"
          value={autoEnabled}
          onValueChange={handleToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
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
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusMd,
  },
  switchLabel: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: '500',
  },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: layout.borderRadiusMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
