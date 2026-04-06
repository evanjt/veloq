import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '@/providers';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { settingsStyles, DIVIDER_INSET } from './settingsStyles';

export function DataSourcesSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const setHideDemoBanner = useAuthStore((s) => s.setHideDemoBanner);

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.dataSources').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <View style={styles.dataSourcesContent}>
          <Text style={[styles.dataSourcesText, isDark && settingsStyles.textMuted]}>
            {t('settings.dataSourcesDescription')}
          </Text>
          <View style={styles.dataSourcesLogos}>
            {(['Garmin', 'Strava', 'Polar', 'Wahoo'] as const).map((name) => (
              <View key={name} style={styles.dataSourceItem}>
                <MaterialCommunityIcons
                  name={name === 'Strava' ? 'run' : 'watch'}
                  size={20}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.dataSourceName, isDark && settingsStyles.textLight]}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.trademarkText, isDark && settingsStyles.textMuted]}>
            {t('attribution.garminTrademark')}
          </Text>
        </View>
      </View>

      {isDemoMode && (
        <>
          <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
            {t('settings.demoDataSources').toUpperCase()}
          </Text>
          <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, isDark && settingsStyles.textLight]}>
                  {t('settings.hideDemoBanner')}
                </Text>
                <Text style={[styles.toggleDescription, isDark && settingsStyles.textMuted]}>
                  {t('settings.hideDemoBannerHint')}
                </Text>
              </View>
              <Switch
                testID="hide-demo-banner-switch"
                value={hideDemoBanner}
                onValueChange={setHideDemoBanner}
                color={colors.primary}
              />
            </View>
            <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />
            <View style={styles.dataSourcesContent}>
              <Text style={[styles.dataSourcesText, isDark && settingsStyles.textMuted]}>
                {t('attribution.demoData')}
              </Text>
            </View>
          </View>
        </>
      )}
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
    ...typography.bodyCompact,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  trademarkText: {
    ...typography.micro,
    color: colors.textSecondary,
    opacity: 0.7,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  toggleInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleLabel: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
