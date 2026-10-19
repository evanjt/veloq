import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  iconSize,
  insightToneColor,
  layout,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { Card } from '@/shared/ui/Card';
import { Badge } from '@/shared/ui/Badge';
import { FitText } from '@/shared/ui/FitText';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { Insight } from '@/types';
import { InsightRowTrend, rowTrendHistory } from './InsightRowTrend';
import { drawsRowTrend, insightCategoryIcon, insightGraphicColour } from '../lib/insightCategory';
import { Icon, type IconName } from '@/shared/ui/Icon';

interface InsightListCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
}

/** Every row is this tall, whatever it holds: one line of the sentence and its padding. */
const ROW_HEIGHT = spacing.xl + spacing.xs;

/**
 * One insight in the list, as one row: the category icon, the sentence on one
 * line, the experimental badge and the new dot, a small trend for the types
 * whose shape answers the card, the insight's glyph and the chevron. The whole
 * row opens the sheet, which holds the full history labelled.
 */
export const InsightListCard = React.memo(function InsightListCard({
  insight,
  onPress,
}: InsightListCardProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { t } = useTranslation();
  const trend = drawsRowTrend(insight.category)
    ? rowTrendHistory(insight.supportingData?.history)
    : null;

  const handlePress = useCallback(() => onPress(insight), [onPress, insight]);

  return (
    <Card
      variant="raised"
      padding="none"
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={composeAccessibilityLabel(
        insight.line,
        insight.isNew && t('a11y.isNew'),
        insight.experimental && t('common.experimental')
      )}
      testID={`insight-card-${insight.id}`}
    >
      <View testID="insight-row" style={styles.row}>
        <Icon
          testID="insight-category-icon"
          name={insightCategoryIcon(insight.category)}
          size={iconSize.sm}
          color={palette.iconSecondary}
        />
        <View style={styles.lineRow}>
          {/* The sentence carries figures, so it shrinks to fit its one line before it is cut. */}
          <FitText
            testID="insight-line"
            ellipsizeMode="tail"
            style={[styles.line, isDark && styles.lineDark]}
          >
            {insight.line}
          </FitText>
          {insight.experimental ? (
            <Badge
              testID="insight-experimental"
              tone="neutral"
              size="sm"
              text={t('common.experimental')}
              isDark={isDark}
            />
          ) : null}
          {insight.isNew ? (
            <View style={[styles.newDot, { backgroundColor: palette.actionPrimary }]} />
          ) : null}
        </View>
        {trend ? (
          <InsightRowTrend
            history={trend}
            color={insightGraphicColour(insight.category, isDark)}
            isDark={isDark}
          />
        ) : null}
        <Icon
          testID="insight-trend-glyph"
          name={insight.icon as IconName}
          size={iconSize.sm}
          color={insightToneColor(insight.iconTone, isDark)}
        />
        <Icon
          name="chevron-right"
          size={iconSize.sm}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.xsPlus,
  },
  lineRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  line: {
    ...typography.bodyCompact,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  lineDark: {
    color: darkColors.textPrimary,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: layout.borderRadiusFull,
  },
});
