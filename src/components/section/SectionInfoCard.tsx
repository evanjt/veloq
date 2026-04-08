/**
 * Compact info card showing first/last visited dates and reference activity.
 * Displayed between the scatter chart and the calendar history.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { navigateTo, getIntlLocale } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { PerformanceDataPoint } from '@/types';

/** Format date as "Jan '24" */
function formatShortYearDate(date: Date): string {
  const month = date.toLocaleDateString(getIntlLocale(), { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${month} '${year}`;
}

export interface SectionInfoCardProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  referenceActivityId?: string;
  referenceActivityName?: string;
  isReferenceUserDefined: boolean;
  isDark: boolean;
}

export function SectionInfoCard({
  chartData,
  referenceActivityId,
  referenceActivityName,
  isReferenceUserDefined,
  isDark,
}: SectionInfoCardProps) {
  const { t } = useTranslation();

  // Compute first and last visited dates from chart data
  const { firstDate, lastDate } = useMemo(() => {
    if (chartData.length === 0) return { firstDate: null, lastDate: null };

    let min = chartData[0].date;
    let max = chartData[0].date;
    for (const p of chartData) {
      if (p.isExcluded) continue;
      if (p.date < min) min = p.date;
      if (p.date > max) max = p.date;
    }
    return { firstDate: min, lastDate: max };
  }, [chartData]);

  if (!firstDate || !lastDate) return null;

  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      {/* Date row */}
      <View style={styles.dateRow}>
        <View style={styles.dateItem}>
          <MaterialCommunityIcons name="calendar-arrow-left" size={14} color={textSecondary} />
          <Text style={[styles.dateLabel, { color: textSecondary }]}>
            {t('sections.firstVisited', 'First')}
          </Text>
          <Text style={[styles.dateValue, { color: textColor }]}>
            {formatShortYearDate(firstDate)}
          </Text>
        </View>
        <View style={styles.dateSeparator} />
        <View style={styles.dateItem}>
          <MaterialCommunityIcons name="calendar-arrow-right" size={14} color={textSecondary} />
          <Text style={[styles.dateLabel, { color: textSecondary }]}>
            {t('sections.lastVisited', 'Last')}
          </Text>
          <Text style={[styles.dateValue, { color: textColor }]}>
            {formatShortYearDate(lastDate)}
          </Text>
        </View>
      </View>

      {/* Reference activity row */}
      {referenceActivityId && (
        <TouchableOpacity
          style={styles.referenceRow}
          onPress={() => navigateTo(`/activity/${referenceActivityId}`)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name={isReferenceUserDefined ? 'star' : 'star-outline'}
            size={14}
            color={isReferenceUserDefined ? colors.primary : textSecondary}
          />
          <Text style={[styles.referenceName, { color: textColor }]} numberOfLines={1}>
            {referenceActivityName || referenceActivityId}
          </Text>
          <View
            style={[styles.referenceBadge, isReferenceUserDefined && styles.referenceBadgeCustom]}
          >
            <Text
              style={[
                styles.referenceBadgeText,
                isReferenceUserDefined && styles.referenceBadgeTextCustom,
              ]}
            >
              {isReferenceUserDefined
                ? t('sections.customReference', 'Custom')
                : t('sections.autoReference', 'Auto')}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={14}
            color={isDark ? darkColors.textMuted : colors.border}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateSeparator: {
    width: 1,
    height: 16,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  dateLabel: {
    fontSize: typography.caption.fontSize,
  },
  dateValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  referenceName: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
  },
  referenceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  referenceBadgeCustom: {
    backgroundColor: colors.primary + '20',
  },
  referenceBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  referenceBadgeTextCustom: {
    color: colors.primary,
  },
});
