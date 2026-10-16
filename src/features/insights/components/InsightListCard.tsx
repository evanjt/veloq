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
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { Insight } from '@/types';
import { InsightHistoryGraphic } from './InsightHistoryGraphic';
import { dataLinkLabel, historyTarget } from '../lib/dataLink';
import type { TFunc } from '../types';

interface InsightListCardProps {
  insight: Insight;
  onPress: (insight: Insight) => void;
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
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  titleDark: {
    color: darkColors.textPrimary,
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
