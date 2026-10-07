import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography } from '@/theme';
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

  return (
    <Row
      testID="settings-clear-cache"
      onPress={onClearCache}
      accessibilityLabel={t('settings.clearAllReload')}
      disabled={isDemoMode}
    >
      <MaterialCommunityIcons
        name="delete-outline"
        size={22}
        color={isDemoMode ? colors.textSecondary : colors.error}
      />
      <Text
        style={[
          styles.actionText,
          isDemoMode ? styles.actionTextDisabled : styles.actionTextDanger,
          !isDemoMode && isDark && styles.actionTextDangerDark,
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
    color: colors.textPrimary,
  },
  actionTextDisabled: {
    color: colors.textSecondary,
  },
  actionTextDanger: {
    color: colors.errorDeep,
  },
  actionTextDangerDark: {
    color: darkColors.errorDeep,
  },
});
