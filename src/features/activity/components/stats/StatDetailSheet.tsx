/**
 * The detail of one stat card, shown in the stat sheet route.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SheetHeader } from '@/shared/ui';
import { opacity, typography, spacing, layout, themedStyles, type Palette } from '@/theme';
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
          <View style={[styles.iconContainer, { backgroundColor: `${stat.color}20` }]}>
            <MaterialCommunityIcons name={stat.icon} size={28} color={stat.color} />
          </View>
          <Text style={styles.value}>
            {stat.value}
            {stat.unit ? <Text style={styles.unit}> {stat.unit}</Text> : null}
          </Text>
        </View>

        {stat.context ? (
          <View style={[styles.contextBanner, { backgroundColor: `${stat.color}15` }]}>
            <Text style={styles.contextBannerText}>{stat.context}</Text>
          </View>
        ) : null}

        {stat.explanation ? (
          <View style={styles.explanationBox}>
            <View style={styles.explanationHeader}>
              <MaterialCommunityIcons
                name="information-outline"
                size={16}
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
      backgroundColor: palette.surface,
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
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    value: {
      flex: 1,
      fontSize: typography.headlineNumber.fontSize,
      fontWeight: '700',
      color: palette.textPrimary,
    },
    unit: {
      fontSize: typography.body.fontSize,
      fontWeight: '600',
      color: palette.textSecondary,
    },
    contextBanner: {
      padding: spacing.sm,
      borderRadius: layout.borderRadiusMd,
      marginBottom: spacing.md,
    },
    contextBannerText: {
      fontSize: typography.bodySmall.fontSize,
      fontWeight: '600',
      textAlign: 'center',
      color: palette.textPrimary,
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
      fontSize: typography.caption.fontSize,
      fontWeight: '600',
      color: palette.textSecondary,
    },
    explanationText: {
      fontSize: typography.bodyCompact.fontSize,
      color: palette.textSecondary,
      lineHeight: 18,
    },
    detailsList: {
      marginBottom: spacing.md,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: overlay.light,
    },
    detailLabel: {
      fontSize: typography.bodySmall.fontSize,
      color: palette.textSecondary,
    },
    detailValue: {
      fontSize: typography.bodySmall.fontSize,
      fontWeight: '600',
      color: palette.textPrimary,
    },
  });
};
