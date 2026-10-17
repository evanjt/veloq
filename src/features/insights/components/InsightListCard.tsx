import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  insightCategoryColor,
  insightToneColor,
  layout,
  spacing,
  typography,
} from '@/theme';
import { Card } from '@/shared/ui/Card';
import { ChangeChip } from '@/shared/ui/ChangeChip';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { DataPoint, Insight } from '@/types';
import { InsightHistoryGraphic } from './InsightHistoryGraphic';
import { dataLinkLabel, historyTarget } from '../lib/dataLink';
import type { TFunc } from '../types';

interface InsightListCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
}

/** A value as the card prints it, its unit after it. */
function printed(point: DataPoint | undefined): string | null {
  if (!point) return null;
  return point.unit ? `${String(point.value)} ${point.unit}` : String(point.value);
}

/** The screen-reader action that opens what the graphic pictures. */
const OPEN_PICTURED = 'openPictured';

export const InsightListCard = React.memo(function InsightListCard({
  insight,
  onPress,
}: InsightListCardProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const categoryColor = insightCategoryColor(insight.category, isDark);
  const history = insight.supportingData?.history;
  // A card with too short a history to draw states its figure and its change instead.
  const figure = history ? null : printed(insight.supportingData?.hero);
  const change = figure ? printed(insight.supportingData?.change) : null;
  const target = historyTarget(insight);
  const linkLabel = useMemo(
    () => (history ? dataLinkLabel(insight, target, t as unknown as TFunc) : null),
    [history, target, insight, t]
  );

  const handlePress = useCallback(() => onPress(insight), [onPress, insight]);
  const actions = useMemo(
    () =>
      target && linkLabel
        ? [{ name: OPEN_PICTURED, label: linkLabel, run: () => tapTo(target) }]
        : undefined,
    [target, linkLabel]
  );

  return (
    <Card
      variant="raised"
      padding="none"
      style={{ flexDirection: 'row' }}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={composeAccessibilityLabel(
        insight.title,
        insight.isNew && t('a11y.isNew'),
        figure,
        change,
        insight.subtitle
      )}
      actions={actions}
      testID={`insight-card-${insight.id}`}
    >
      <View style={[styles.colorBar, { backgroundColor: categoryColor }]} />
      <View style={styles.content}>
        <View style={styles.header}>
          <View
            style={[styles.iconCircle, { backgroundColor: colorWithOpacity(categoryColor, 0.1) }]}
          >
            <MaterialCommunityIcons
              name={insight.icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={iconSize.sm}
              color={insightToneColor(insight.iconTone, isDark)}
            />
          </View>
          <View style={styles.titleRow}>
            <Text
              testID="insight-title"
              style={[styles.title, isDark && styles.titleDark]}
              numberOfLines={1}
            >
              {insight.title}
            </Text>
            {insight.isNew ? <View style={styles.newDot} /> : null}
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={iconSize.sm}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </View>

        {history && linkLabel ? (
          <InsightHistoryGraphic
            history={history}
            color={categoryColor}
            isDark={isDark}
            accessibilityLabel={linkLabel}
            onOpenSheet={handlePress}
          />
        ) : null}

        {figure ? (
          <View style={styles.figureRow}>
            <Text
              testID="insight-figure"
              style={[styles.figure, isDark && styles.titleDark]}
              numberOfLines={1}
            >
              {figure}
            </Text>
            {change ? (
              <ChangeChip
                text={change}
                trend={insight.supportingData?.trend}
                isDark={isDark}
                testID="insight-change"
              />
            ) : null}
          </View>
        ) : null}

        {insight.subtitle ? (
          <Text style={[styles.caption, isDark && styles.captionDark]} numberOfLines={1}>
            {insight.subtitle}
          </Text>
        ) : null}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  colorBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  content: {
    flex: 1,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  figureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  figure: {
    fontSize: typography.metricValue.fontSize,
    fontWeight: typography.metricValue.fontWeight,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: brand.tealLight,
  },
  caption: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  captionDark: {
    color: darkColors.textSecondary,
  },
});
