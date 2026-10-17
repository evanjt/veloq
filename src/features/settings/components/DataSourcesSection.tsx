import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '@/shared/app/AuthStore';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { ListSectionHeader } from '@/shared/ui/ListSectionHeader';
import { settingsStyles } from './settingsStyles';
import { SwitchRow } from '@/shared/ui/SwitchRow';

export function DataSourcesSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const setHideDemoBanner = useAuthStore((s) => s.setHideDemoBanner);

  return (
    <>
      <ListSectionHeader>{t('settings.dataSources')}</ListSectionHeader>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {isDemoMode ? (
          <>
            <SwitchRow
              title={t('settings.hideDemoBanner')}
              description={t('settings.hideDemoBannerHint')}
              value={hideDemoBanner}
              onValueChange={setHideDemoBanner}
              testID="hide-demo-banner-switch"
            />
            <View style={styles.dataSourcesContent}>
              <Text style={[styles.dataSourcesText, isDark && settingsStyles.textSecondary]}>
                {t('attribution.demoData')}
              </Text>
            </View>
            <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />
          </>
        ) : null}

        <View style={styles.dataSourcesContent}>
          <Text style={[styles.dataSourcesText, isDark && settingsStyles.textSecondary]}>
            {t('settings.dataSourcesDescription')}
          </Text>
          <View style={styles.dataSourcesLogos}>
            {(['Garmin', 'Strava', 'Polar', 'Wahoo'] as const).map((name) => (
              <View key={name} style={styles.dataSourceItem}>
                <MaterialCommunityIcons
                  name={name === 'Strava' ? 'run' : 'watch'}
                  size={iconSize.md}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.dataSourceName, isDark && settingsStyles.textLight]}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.trademarkText, isDark && settingsStyles.textSecondary]}>
            {t('attribution.garminTrademark')}
          </Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  dataSourcesContent: {
    padding: spacing.md,
  },
  dataSourcesText: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  dataSourcesLogos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  dataSourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dataSourceName: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  trademarkText: {
    ...typography.micro,
    color: colors.textSecondary,
  },
});
