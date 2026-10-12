import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import { useWriteAccessMissing } from '@/features/recording';
import { ListSectionHeader } from '@/shared/ui/ListSectionHeader';
import { SettingsNavRow } from './SettingsNavRow';
import { settingsStyles } from './settingsStyles';

/**
 * A pointer from the hub to recording settings while the write permission is
 * missing. The grant control itself sits there, beside the Auto-upload switch
 * whose promise it decides.
 */
export function RecordingPermissionSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const missing = useWriteAccessMissing();

  if (!missing) return null;

  return (
    <>
      <ListSectionHeader>{t('settings.recording', 'Recording')}</ListSectionHeader>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <SettingsNavRow
          icon="shield-alert-outline"
          title={t('recording.permissionNeeded', 'Permission needed to upload activities')}
          onPress={() => tapTo('/recording-settings')}
          testID="settings-recording-permission-link"
        />
      </View>
    </>
  );
}
