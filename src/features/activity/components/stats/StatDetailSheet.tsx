/**
 * The detail of one stat card, shown in the stat sheet route.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KeyDot, SheetHeader } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import {
  chartStreamColour,
  iconSize,
  layout,
  opacity,
  type Palette,
  spacing,
  themedStyles,
  typography,
  stroke,
} from '@/theme';
import type { StatDetail } from './types';

interface StatDetailSheetProps {
  stat: StatDetail;
  isDark: boolean;
  onClose: () => void;
}

export function StatDetailSheet({ stat, isDark, onClose }: StatDetailSheetProps) {
  const { t } = useTranslation();
  const styles = themedStyles(makeStyles, isDark);

  return (
    <View testID="stat-detail-sheet" style={styles.sheet}>
      <SheetHeader title={stat.title} onClose={onClose} />
      <View style={styles.body}>
        <View style={styles.valueRow}>
          <View testID="stat-icon-disc" style={styles.iconContainer}>
            <Icon name={stat.icon} size={iconSize.xl} color={styles.icon.color} />
          </View>
          <Text style={styles.value}>
            {stat.value}
            {stat.unit ? <Text style={styles.unit}> {stat.unit}</Text> : null}
          </Text>
          {stat.stream ? <KeyDot color={chartStreamColour(stat.stream, isDark)} /> : null}
        </View>

        {stat.context ? (
          <Text testID="stat-context" style={styles.context}>
            {stat.context}
          </Text>
        ) : null}

        {stat.explanation ? (
          <View style={styles.explanationBox}>
            <View style={styles.explanationHeader}>
              <Icon
                name="information-outline"
                size={iconSize.sm}
                color={styles.explanationTitle.color}
              />
              <Text style={styles.explanationTitle}>{t('activity.whatIsThis')}</Text>
            </View>
            <Text style={styles.explanationText}>{stat.explanation}</Text>
          </View>
        ) : null}

        {stat.details && stat.details.length > 0 ? (
          <View style={styles.detailsList}>
            {stat.details.map((detail, i) => (
              <View key={i} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{detail.label}</Text>
                <Text style={styles.detailValue}>{detail.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (palette: Palette, isDark: boolean) => {
  const overlay = isDark ? opacity.overlayDark : opacity.overlay;
  return StyleSheet.create({
    sheet: {
      paddingBottom: layout.screenPadding,
    },
    body: {
      paddingHorizontal: layout.screenPadding,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    iconContainer: {
      width: 56,
      height: 56,
      borderRadius: layout.borderRadius,
      backgroundColor: palette.fillNeutral,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    icon: {
      color: palette.textSecondary,
    },
    value: {
      ...typography.headlineNumber,
      flex: 1,
      color: palette.textPrimary,
    },
    unit: {
      ...typography.bodyBold,
      color: palette.textSecondary,
    },
    context: {
      ...typography.bodySmallBold,
      textAlign: 'center',
      color: palette.textPrimary,
      marginBottom: spacing.md,
    },
    explanationBox: {
      backgroundColor: overlay.subtle,
      borderRadius: layout.borderRadiusMd,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    explanationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xsPlus,
      marginBottom: spacing.xs,
    },
    explanationTitle: {
      ...typography.captionBold,
      color: palette.textSecondary,
    },
    explanationText: {
      ...typography.bodyCompact,
      color: palette.textSecondary,
    },
    detailsList: {
      marginBottom: spacing.md,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: stroke.one,
      borderBottomColor: overlay.light,
    },
    detailLabel: {
      ...typography.bodySmall,
      color: palette.textSecondary,
    },
    detailValue: {
      ...typography.bodySmallBold,
      color: palette.textPrimary,
    },
  });
};
