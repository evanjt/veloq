import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, ScreenSafeAreaView, ScreenScrollView, SwitchRow } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';
import { useRecordingPreferences, UploadPermissionNotice } from '@/features/recording';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function RecordingUploadScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const autoUploadEnabled = useRecordingPreferences((s) => s.autoUploadEnabled);
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;

  const handleToggleAutoUpload = useCallback((value: boolean) => {
    useRecordingPreferences.getState().setAutoUpload(value);
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
