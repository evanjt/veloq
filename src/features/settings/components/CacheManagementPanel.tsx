import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { typography, themePalette } from '@/theme';
import { Row } from '@/shared/ui/Row';

export interface CacheManagementPanelProps {
  isDark: boolean;
  isDemoMode: boolean;
  onClearCache: () => void;
}

export function CacheManagementPanel({
  isDark,
  isDemoMode,
  onClearCache,
}: CacheManagementPanelProps) {
  const { t } = useTranslation();
  const palette = themePalette(isDark);

  return (
    <Row
      testID="settings-clear-cache"
      behaviour="act"
      onPress={onClearCache}
      accessibilityLabel={t('settings.clearAllReload')}
      disabled={isDemoMode}
    >
      <MaterialCommunityIcons
        name="delete-outline"
        size={22}
        color={isDemoMode ? palette.textSecondary : palette.error}
      />
      <Text
        style={[
          styles.actionText,
          { color: isDemoMode ? palette.textSecondary : palette.errorDeep },
        ]}
      >
        {t('settings.clearAllReload')}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  actionText: {
    flex: 1,
    fontSize: typography.body.fontSize,
  },
});
