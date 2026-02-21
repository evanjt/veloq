import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';

export function DataSourcesSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const setHideDemoBanner = useAuthStore((s) => s.setHideDemoBanner);

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.dataSources').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <View style={styles.dataSourcesContent}>
          <Text style={[styles.dataSourcesText, isDark && styles.textMuted]}>
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
                <Text style={[styles.dataSourceName, isDark && styles.textLight]}>{name}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.trademarkText, isDark && styles.textMuted]}>
            {t('attribution.garminTrademark')}
          </Text>
        </View>
      </View>

      {isDemoMode && (
        <>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
            {t('settings.demoDataSources').toUpperCase()}
          </Text>
          <View style={[styles.section, isDark && styles.sectionDark]}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={[styles.toggleLabel, isDark && styles.textLight]}>
                  {t('settings.hideDemoBanner')}
                </Text>
                <Text style={[styles.toggleDescription, isDark && styles.textMuted]}>
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
            <View style={[styles.divider, isDark && styles.dividerDark]} />
            <View style={styles.dataSourcesContent}>
              <Text style={[styles.dataSourcesText, isDark && styles.textMuted]}>
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
  dataSourcesContent: {
    padding: spacing.md,
  },
  dataSourcesText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
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
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  trademarkText: {
    fontSize: 10,
    color: colors.textSecondary,
    opacity: 0.7,
    lineHeight: 14,
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
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
