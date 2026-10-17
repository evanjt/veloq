import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { Icon } from '@/shared/ui/Icon';

const PLATFORMS = [
  { name: 'Garmin', icon: 'watch' },
  { name: 'Strava', icon: 'run' },
  { name: 'Polar', icon: 'watch' },
  { name: 'Wahoo', icon: 'watch' },
] as const;

/** Where synced data comes from, the platforms named and the trademark line. */
export function DataAttribution() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const secondary = { color: palette.textSecondary };

  return (
    <View style={styles.content}>
      <Text style={[styles.description, secondary]}>{t('settings.dataSourcesDescription')}</Text>
      <View style={styles.platforms}>
        {PLATFORMS.map(({ name, icon }) => (
          <View key={name} style={styles.platform}>
            <Icon name={icon} size={iconSize.md} color={palette.textSecondary} />
            <Text style={[styles.platformName, { color: palette.textPrimary }]}>{name}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.trademark, secondary]}>{t('attribution.garminTrademark')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
  },
  description: {
    ...typography.bodyCompact,
    marginBottom: spacing.md,
  },
  platforms: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  platform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  platformName: {
    ...typography.bodyCompactBold,
  },
  trademark: {
    ...typography.micro,
  },
});
