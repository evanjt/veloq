import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { RowDivider } from '@/shared/ui/RowGroup';
import { navigateTo } from '@/shared/app/navigation';
import { SettingsNavRow } from './SettingsNavRow';
import { useGarminConnectorState } from '../hooks/useGarminConnectorState';
import { useExperimental } from '../lib/experimental';

/**
 * The accounts beside the intervals.icu sign-in: the Garmin connector while its
 * experimental switch is on, and in a demo the switch that hides the demo banner.
 * A library filled from files has no account, so it offers the ways to add one.
 * Both leave the files source for the sign-in screen and keep the library.
 */
export function AccountConnectionsSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const hideDemoBanner = useAuthStore((s) => s.hideDemoBanner);
  const setHideDemoBanner = useAuthStore((s) => s.setHideDemoBanner);
  const garminState = useGarminConnectorState();
  const garminShown = useExperimental('garminUpdate');
  const authMethod = useAuthStore((s) => s.authMethod);
  const exitFilesMode = useAuthStore((s) => s.exitFilesMode);

  if (sourceFor({ authMethod })?.id === 'files') {
    return (
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <SettingsNavRow
          icon="chart-timeline-variant"
          title={t('filesSource.connectIntervals')}
          subtitle={t('filesSource.connectHint')}
          onPress={() => void exitFilesMode()}
          testID="settings-connect-intervals"
        />
        {garminShown ? (
          <>
            <RowDivider />
            <SettingsNavRow
              icon="watch"
              title={t('filesSource.connectGarmin')}
              onPress={() => void exitFilesMode()}
              testID="settings-connect-garmin"
            />
          </>
        ) : null}
      </View>
    );
  }

  if (!isDemoMode && !garminShown) return null;

  return (
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
          <View style={styles.demoContent}>
            <Text style={[styles.demoText, isDark ? styles.demoTextDark : null]}>
              {t('attribution.demoData')}
            </Text>
          </View>
          {garminShown ? <RowDivider /> : null}
        </>
      ) : null}

      {garminShown ? (
        <SettingsNavRow
          icon="watch"
          title={t('garmin.title')}
          subtitle={garminState === 'keyNeeded' ? t('garmin.keyNeeded') : t('garmin.rowSubtitle')}
          onPress={() => navigateTo('/garmin-connector')}
          testID="settings-nav-garmin"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  demoContent: {
    padding: spacing.md,
  },
  demoText: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  demoTextDark: {
    color: darkColors.textSecondary,
  },
});
