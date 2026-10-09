import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import { colors, darkColors, spacing, opacity, layout, typography } from '@/theme';
import type { Insight } from '@/types';
import { pressable, pressRipple } from '@/shared/ui';
import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { DataPointRow } from './DataPointRow';
import { RankingFactorsGroup } from './RankingFactorsGroup';
import { dataLinkLabel, insightDataTarget } from '../lib/dataLink';
import type { TFunc } from '../types';

interface MethodologySectionProps {
  insight: Insight;
}

/**
 * "How was this calculated?": the method, the formula, the athlete's numbers
 * and a link to the data they were taken from, folded under one disclosure
 * that is collapsed when the sheet opens, so the sheet leads with the picture.
 */
export const MethodologySection = React.memo(function MethodologySection({
  insight,
}: MethodologySectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const methodology = insight.methodology;
  const supportingData = insight.supportingData;

  const formula = supportingData?.formula ?? methodology?.formula;
  const algorithmDescription = supportingData?.algorithmDescription;
  const description = methodology?.description ?? null;
  const dataPoints = supportingData?.dataPoints?.length ? supportingData.dataPoints : null;
  const ranking = insight.meta?.ranking;
  const dataTarget = insightDataTarget(insight);

  const hasAnyContent =
    ranking != null ||
    formula != null ||
    algorithmDescription != null ||
    description != null ||
    dataPoints != null ||
    dataTarget != null;

  if (!hasAnyContent) return null;

  return (
    <View testID="methodology-section" style={styles.container}>
      <CollapsibleSection
        title={t('insights.howCalculated')}
        expanded={expanded}
        onToggle={setExpanded}
        testID="methodology-toggle"
      >
        <View style={styles.body}>
          {algorithmDescription ? (
            <Text style={[styles.algorithmText, isDark && styles.algorithmTextDark]}>
              {algorithmDescription}
            </Text>
          ) : description ? (
            <Text style={[styles.algorithmText, isDark && styles.algorithmTextDark]}>
              {description}
            </Text>
          ) : null}

          {formula ? <FormulaBlock formula={formula} isDark={isDark} /> : null}

          {dataPoints ? (
            <View>
              {dataPoints.map((dataPoint, i) => (
                <DataPointRow key={`dp-${i}`} dataPoint={dataPoint} />
              ))}
            </View>
          ) : null}

          {/* Why the engine chose this card */}
          {ranking ? <RankingFactorsGroup ranking={ranking} /> : null}

          {dataTarget ? (
            <DataLink
              target={dataTarget}
              label={dataLinkLabel(insight, dataTarget, t as unknown as TFunc)}
              isDark={isDark}
            />
          ) : null}
        </View>
      </CollapsibleSection>
    </View>
  );
});

/** Renders a formula in a monospace styled box */
const FormulaBlock = React.memo(function FormulaBlock({
  formula,
  isDark,
}: {
  formula: string;
  isDark: boolean;
}) {
  return (
    <View style={[styles.formulaContainer, isDark && styles.formulaContainerDark]}>
      <Text style={[styles.formulaText, isDark && styles.formulaTextDark]}>{formula}</Text>
    </View>
  );
});

/** The row that opens the screen the card's numbers were taken from. */
const DataLink = React.memo(function DataLink({
  target,
  label,
  isDark,
}: {
  target: string;
  label: string;
  isDark: boolean;
}) {
  const handlePress = useCallback(() => tapTo(target), [target]);

  return (
    <Pressable
      testID="insight-data-link"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={pressable([styles.linkRow, isDark && styles.linkRowDark])}
      android_ripple={pressRipple}
      onPress={handlePress}
    >
      <Text style={[styles.linkText, isDark && styles.linkTextDark]} numberOfLines={1}>
        {label}
      </Text>
      <MaterialCommunityIcons
        name="chevron-right"
        size={16}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // The disclosure's header pads itself by `md`; this lines it and its body up
  // with the sheet's `lg` gutter.
  container: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.md,
  },
  body: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  // Formula
  formulaContainer: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  formulaContainerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  formulaText: {
    fontFamily: 'monospace',
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  formulaTextDark: {
    color: darkColors.textPrimary,
  },
  // Algorithm description
  algorithmText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  algorithmTextDark: {
    color: darkColors.textSecondary,
  },
  // Data link
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.subtle,
  },
  linkRowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  linkText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  linkTextDark: {
    color: darkColors.textPrimary,
  },
});
