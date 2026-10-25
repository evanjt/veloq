import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  rescanRefusalKey,
  useRetiredSectionCount,
  useRouteSettings,
  useSectionRescan,
} from '@/features/routes';
import {
  Button,
  Card,
  RowGroup,
  ScreenSafeAreaView,
  ScreenScrollView,
  StatusLine,
} from '@/shared/ui';
import {
  BackgroundJobsActivityBar,
  CutoverStatus,
  ElevationBackfillStatus,
  SettingsNavRow,
} from '@/features/settings';
import { colors, darkColors, spacing, typography } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { SwitchRow } from '@/shared/ui/SwitchRow';
import { navigateTo } from '@/shared/app/navigation';
import { confirmAction } from '@/shared/ui/dialog';

function DetectionSettingsScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const routeMatchingEnabled = useRouteSettings((s) => s.settings.enabled);
  const setRouteMatchingEnabled = useRouteSettings((s) => s.setEnabled);
  const retiredCount = useRetiredSectionCount();
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;
  const danger = isDark ? darkColors.errorText : colors.errorText;

  const {
    forceRescan,
    isScanning,
    cancelScan,
    result: rescanResult,
    failed: rescanFailed,
    stillRunning: rescanStillRunning,
    refusal: rescanRefusal,
  } = useSectionRescan();

  // The confirm dialog's Reanalyse used to drop the engine's answer, so a
  // refused rescan closed the alert and showed nothing at all.
  const refusalKey = rescanRefusalKey(rescanRefusal);

  const handleRescan = useCallback(() => {
    confirmAction({
      title: t('settings.reanalyzeSections'),
      message: t('settings.reanalyzeWarning'),
      confirmLabel: t('settings.reanalyzeSections'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => forceRescan(),
    });
  }, [t, forceRescan]);

  return (
    <ScreenSafeAreaView
      testID="detection-settings-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView showsVerticalScrollIndicator={false}>
        <BackgroundJobsActivityBar />
        <View style={styles.body}>
          <View style={styles.toggleFrame}>
            <Card variant="flat" padding="none">
              <SwitchRow
                icon="map-marker-path"
                title={t('settings.routeMatching')}
                value={routeMatchingEnabled}
                onValueChange={setRouteMatchingEnabled}
              />
            </Card>
          </View>

          <View>
            {!routeMatchingEnabled && (
              <Text
                testID="detection-matching-off"
                style={[styles.matchingOff, { color: textSecondary }]}
              >
                {t('settings.routeMatchingOff')}
              </Text>
            )}

            <View style={styles.previewFrame}>
              <Card variant="flat" padding="none">
                <RowGroup>
                  <SettingsNavRow
                    testID="detection-preview-row"
                    icon="map-search-outline"
                    title={t('settings.previewSections')}
                    onPress={() => navigateTo('/detection-preview')}
                    disabled={!routeMatchingEnabled}
                  />
                  <SettingsNavRow
                    testID="route-grouping-preview-row"
                    icon="source-branch"
                    title={t('settings.previewRouteGrouping')}
                    onPress={() => navigateTo('/route-grouping-preview')}
                    disabled={!routeMatchingEnabled}
                  />
                  <SettingsNavRow
                    testID="retired-sections-row"
                    icon="history"
                    title={t('sectionHistory.seeRetired')}
                    subtitle={
                      retiredCount > 0
                        ? t('sectionHistory.retiredCount', { count: retiredCount })
                        : t('sectionHistory.retiredEmpty')
                    }
                    onPress={() => navigateTo('/detection-preview?layer=retired')}
                    disabled={retiredCount === 0}
                  />
                </RowGroup>
              </Card>
            </View>

            <Button
              variant={isScanning ? 'secondary' : 'primary'}
              style={styles.rescanBtn}
              onPress={isScanning ? cancelScan : handleRescan}
              icon={isScanning ? { spinner: true } : 'refresh'}
              label={isScanning ? t('common.cancel') : t('settings.reanalyzeSections')}
              disabled={!routeMatchingEnabled && !isScanning}
              testID="detection-rescan-button"
            />

            {/* The result stays until the next rescan replaces it, never on a timer. */}
            {rescanResult ? (
              <StatusLine
                testID="detection-rescan-result"
                tone="success"
                message={t('settings.sectionsBeforeAfter', {
                  before: rescanResult.before,
                  after: rescanResult.after,
                })}
                textStyle={[styles.rescanResult, { color: textSecondary }]}
              />
            ) : null}

            {refusalKey !== null && (
              <StatusLine
                testID="detection-rescan-refused"
                tone="info"
                message={t(refusalKey)}
                textStyle={[styles.rescanResult, { color: textSecondary }]}
              />
            )}

            {rescanStillRunning ? (
              <StatusLine
                testID="detection-rescan-still-running"
                tone="pending"
                message={t('settings.stillRunning')}
                textStyle={[styles.rescanResult, { color: textSecondary }]}
              />
            ) : null}

            {rescanFailed ? (
              <StatusLine
                tone="error"
                message={t(
                  'settings.rescanFailed',
                  'The rescan could not finish. Some activity tracks could not be read.'
                )}
                textStyle={[styles.rescanResult, { color: danger }]}
              />
            ) : null}

            <CutoverStatus />
          </View>
          <ElevationBackfillStatus />
        </View>
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toggleFrame: {
    marginBottom: spacing.lg,
  },
  // The activity bar carries its own screen margin, so the padding sits on the body only.
  body: {
    paddingHorizontal: spacing.md,
  },
  matchingOff: {
    ...typography.bodySmall,
    marginTop: spacing.xs,
  },
  rescanBtn: {
    marginTop: spacing.lg,
  },
  rescanResult: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  previewFrame: {
    marginTop: spacing.md,
  },
});

export default withScreenBoundary(DetectionSettingsScreenContent, 'DetectionSettings');
