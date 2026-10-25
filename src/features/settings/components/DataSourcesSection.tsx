import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/shared/app/AuthStore';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { RowDivider } from '@/shared/ui/RowGroup';
import { navigateTo } from '@/shared/app/navigation';
import { DataAttribution } from './DataAttribution';
import { SettingsNavRow } from './SettingsNavRow';
import { useGarminConnectorState } from '../hooks/useGarminConnectorState';

export function DataSourcesSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const setHideDemoBanner = useAuthStore((s) => s.setHideDemoBanner);
  const garminState = useGarminConnectorState();

  return (
    <>
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
              <Text style={[styles.dataSourcesText, isDark ? styles.dataSourcesTextDark : null]}>
                {t('attribution.demoData')}
              </Text>
            </View>
            <RowDivider />
          </>
        ) : null}

        <SettingsNavRow
          icon="watch"
          title={t('garmin.title')}
          subtitle={garminState === 'keyNeeded' ? t('garmin.keyNeeded') : t('garmin.rowSubtitle')}
          onPress={() => navigateTo('/garmin-connector')}
          testID="settings-nav-garmin"
        />
        <RowDivider />
        <DataAttribution />
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
  dataSourcesTextDark: {
    color: darkColors.textSecondary,
  },
});
