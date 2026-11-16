import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, ScreenSafeAreaView, ScreenScrollView, SwitchRow } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { useRecordingPreferences, UploadPermissionNotice } from '@/features/recording';
import { getSetting, setSetting } from '@/shared/storage';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** The engine builds a strength upload's description from this row, and leaves the summary out only for "0". */
const STRENGTH_SUMMARY_KEY = 'veloq-strength-summary';

function RecordingUploadScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const autoUploadEnabled = useRecordingPreferences((s) => s.autoUploadEnabled);
  const [strengthSummary, setStrengthSummary] = useState(true);
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;

  const handleToggleAutoUpload = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setAutoUpload(value);
  }, []);

  useEffect(() => {
    let live = true;
    void getSetting(STRENGTH_SUMMARY_KEY).then((stored) => {
      if (live) setStrengthSummary(stored !== '0');
    });
    return () => {
      live = false;
    };
  }, []);

  const handleToggleStrengthSummary = useCallback((value: boolean) => {
    setStrengthSummary(value);
    void setSetting(STRENGTH_SUMMARY_KEY, value ? '1' : '0');
  }, []);

  return (
    <ScreenSafeAreaView
      testID="recording-upload-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Card testID="settings-upload-card" variant="flat">
            <SwitchRow
              inset="none"
              title={t('recording.autoUpload', 'Auto-upload')}
              description={t(
                'recording.autoUploadDescription',
                'Uploads recordings to intervals.icu when you save them. When off, they stay on this device until you upload them.'
              )}
              value={autoUploadEnabled}
              onValueChange={handleToggleAutoUpload}
              testID="settings-auto-upload"
            />
            <SwitchRow
              inset="none"
              title={t('recording.strengthSummary', 'Strength summary')}
              description={t(
                'recording.strengthSummaryDescription',
                'Adds the exercises, sets, reps and weights of a strength session to its description on intervals.icu.'
              )}
              value={strengthSummary}
              onValueChange={handleToggleStrengthSummary}
              testID="settings-strength-summary"
            />
            <UploadPermissionNotice />
          </Card>
        </View>
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingTop: spacing.sm },
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.lg },
});

export default withScreenBoundary(RecordingUploadScreenContent, 'RecordingUpload');
