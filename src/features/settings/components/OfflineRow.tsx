import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useIsOnline } from '@/shared/app/NetworkContext';
import { Icon } from '@/shared/ui/Icon';
import { Row } from '@/shared/ui/Row';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

/**
 * The offline state as a row at the head of Settings, while the device has no
 * connection. It says what still works, which the floating pill does not, and
 * it is absent while online, so the top of the screen is the account card then.
 */
export function OfflineRow() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const isOnline = useIsOnline();

  if (isOnline) return null;

  const palette = isDark ? darkColors : colors;

  return (
    <View
      style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark, styles.card]}
    >
      <Row testID="settings-offline-row">
        <Icon name="cloud-off-outline" size={iconSize.lg} color={palette.warningText} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>
            {t('emptyState.offline.title')}
          </Text>
          <Text style={[styles.detail, { color: palette.textSecondary }]}>
            {t('settings.offlineRow.detail')}
          </Text>
        </View>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.body,
  },
  detail: {
    ...typography.bodySmall,
  },
});
