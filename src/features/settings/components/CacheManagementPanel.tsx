import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { useTranslation } from 'react-i18next';
import { iconSize, themePalette, typography } from '@/theme';
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
      <ChromeIcon
        name="delete"
        size={iconSize.lg}
        color={isDemoMode ? palette.textSecondary : palette.errorText}
      />
      <Text
        style={[
          styles.actionText,
          { color: isDemoMode ? palette.textSecondary : palette.errorText },
        ]}
      >
        {t('settings.clearAllReload')}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  actionText: {
    ...typography.body,
    flex: 1,
  },
});
