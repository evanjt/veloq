/**
 * A tour picture made of the app's own rows: each one an icon, the label the screen it opens
 * carries, and optionally the caption under it, so the athlete sees the words they will meet.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { Icon, type IconName } from '@/shared/ui/Icon';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { tourPanelColour } from './tourPanel';

export interface TourRow {
  icon: IconName;
  /** i18n key of the row's label. */
  labelKey: string;
  /** i18n key of the line under the label. */
  captionKey?: string;
}

export function TourRowsPicture({ rows, testID }: { rows: readonly TourRow[]; testID: string }) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const palette = isDark ? darkColors : colors;
  const translate = t as unknown as (key: string) => string;

  return (
    <View style={styles.container} testID={testID}>
      {rows.map((row) => (
        <View key={row.labelKey} style={[styles.row, { backgroundColor: tourPanelColour(isDark) }]}>
          <Icon name={row.icon} size={iconSize.lg} color={palette.actionPrimary} />
          <View style={styles.text}>
            <Text style={[styles.label, { color: palette.textPrimary }]}>
              {translate(row.labelKey)}
            </Text>
            {row.captionKey ? (
              <Text style={[styles.caption, { color: palette.textSecondary }]}>
                {translate(row.captionKey)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  text: {
    flex: 1,
  },
  label: {
    ...typography.bodyBold,
  },
  caption: {
    ...typography.bodySmall,
  },
});
