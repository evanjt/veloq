/**
 * The detail of one stat card, shown in the stat sheet route.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, typography, spacing, layout } from '@/theme';
import type { StatDetail } from './types';

interface StatDetailSheetProps {
  stat: StatDetail;
  isDark: boolean;
}

export function StatDetailSheet({ stat, isDark }: StatDetailSheetProps) {
  const { t } = useTranslation();

  return (
    <View
      testID="stat-detail-sheet"
      style={[styles.sheet, { backgroundColor: isDark ? darkColors.surface : colors.surface }]}
    >
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: `${stat.color}20` }]}>
          <MaterialCommunityIcons name={stat.icon} size={28} color={stat.color} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.value, isDark && styles.textLight]}>{stat.value}</Text>
          <Text style={[styles.title, isDark && styles.textLight]} accessibilityRole="header">
            {stat.title}
          </Text>
        </View>
      </View>

      {stat.context && (
        <View style={[styles.contextBanner, { backgroundColor: `${stat.color}15` }]}>
          <Text style={[styles.contextBannerText, isDark && styles.textLight]}>{stat.context}</Text>
        </View>
      )}

      {stat.explanation && (
        <View style={styles.explanationBox}>
          <View style={styles.explanationHeader}>
            <MaterialCommunityIcons
              name="information-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text style={styles.explanationTitle}>{t('activity.whatIsThis')}</Text>
          </View>
          <Text style={styles.explanationText}>{stat.explanation}</Text>
        </View>
      )}

      {stat.details && stat.details.length > 0 && (
        <View style={styles.detailsList}>
          {stat.details.map((detail, i) => (
            <View key={i} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{detail.label}</Text>
              <Text style={[styles.detailValue, isDark && styles.textLight]}>{detail.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: layout.screenPadding,
  },
  header: {
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
  headerText: {
    flex: 1,
  },
  value: {
    fontSize: typography.headlineNumber.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  title: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
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
  },
  explanationBox: {
    backgroundColor: opacity.overlay.subtle,
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
    color: colors.textSecondary,
  },
  explanationText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
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
    borderBottomColor: opacity.overlay.light,
  },
  detailLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
