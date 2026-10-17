import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { useWriteAccessMissing } from '@/features/recording';
import { SettingsNavRow } from './SettingsNavRow';
import { settingsStyles } from './settingsStyles';
import { spacing } from '@/theme';

/**
 * A pointer from the hub to recording settings while the write permission is
 * missing. The grant control itself sits there, beside the Auto-upload switch
 * whose promise it decides. A failure the athlete can fix is shown where it is
 * seen, so it heads the hub under the account card rather than sitting in a
 * group of its own further down.
 */
export function RecordingPermissionSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const missing = useWriteAccessMissing();

  if (!missing) return null;

  return (
    <View
      style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark, styles.notice]}
    >
      <SettingsNavRow
        icon="shield-alert-outline"
        tone="warning"
        title={t('recording.permissionNeeded', 'Permission needed to upload activities')}
        onPress={() => navigateTo('/recording-settings')}
        testID="settings-recording-permission-link"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginTop: spacing.md,
  },
});
