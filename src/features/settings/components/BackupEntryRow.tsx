/**
 * One backup a restore can pick, as a row: when it was made, to the minute, and
 * beneath it the size, version and activity count it knows. Every restore list
 * draws its entries through this row, so an entry reads the same wherever it is
 * offered, and the entry being restored is busy on every screen.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { Row, Spinner } from '@/shared/ui';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { useTheme } from '@/shared/app';
import { colors, darkColors, typography } from '@/theme';

import type { BackupEntry } from '../lib/autobackup/backends';
import { backupEntryParts } from '../lib/backupEntryLabel';

interface BackupEntryRowProps {
  entry: BackupEntry;
  testID: string;
  onPress: () => void;
  /** This entry is being restored. */
  busy: boolean;
  /** Another restore holds every entry. */
  disabled: boolean;
  /** `none` inside a container that already pads its edges. */
  inset?: 'row' | 'none';
}

export function BackupEntryRow({
  entry,
  testID,
  onPress,
  busy,
  disabled,
  inset = 'row',
}: BackupEntryRowProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { when, details } = backupEntryParts(entry, t);
  const title = t('backup.restoreDatedBackup', { date: when });

  return (
    <Row
      testID={testID}
      behaviour="act"
      onPress={onPress}
      accessibilityLabel={composeAccessibilityLabel(title, details)}
      busy={busy}
      disabled={disabled}
      inset={inset}
    >
      <View style={styles.fill}>
        <Text style={[styles.title, isDark && styles.titleDark]}>{title}</Text>
        {details ? (
          <Text style={[styles.detail, isDark && styles.detailDark]}>{details}</Text>
        ) : null}
      </View>
      {busy ? <Spinner label={title} testID={`${testID}-spinner`} /> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  title: {
    ...typography.body,
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  detailDark: {
    color: darkColors.textSecondary,
  },
});
