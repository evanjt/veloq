import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { tapTo } from '@/shared/app/navigation';
import { colors, darkColors, iconSize, layout, opacity, spacing, typography } from '@/theme';
import type { DataPoint, Insight } from '@/types';
import { pressable, pressRipple } from '@/shared/ui';
import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { DataPointRow } from './DataPointRow';
import { RankingFactorsGroup } from './RankingFactorsGroup';
import { dataLinkLabel, insightDataTarget } from '../lib/dataLink';
import { timeMethodKey } from '../lib/timeMethod';
import type { TFunc } from '../types';

interface MethodologySectionProps {
  insight: Insight;
  /** Runs before the data link opens its screen, so a routed sheet can close first. */
  onLeave?: (() => void) | undefined;
}

/** Whether a row is the figure the sheet already leads with. */
function isHero(row: DataPoint, hero: DataPoint | undefined): boolean {
  return (
    hero != null && row.label === hero.label && row.value === hero.value && row.unit === hero.unit
  );
}

/**
 * "How was this calculated?": the method, the formula, the athlete's numbers
 * and a link to the data they were taken from, folded under one disclosure
 * that is collapsed when the sheet opens, so the sheet leads with the picture.
 */
export const MethodologySection = React.memo(function MethodologySection({
  insight,
  onLeave,
}: MethodologySectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const methodology = insight.methodology;
  const supportingData = insight.supportingData;

  const formula = supportingData?.formula ?? methodology?.formula;
  const algorithmDescription = supportingData?.algorithmDescription;
  const description = methodology?.description ?? null;
  // The figure the sheet leads with is drawn once, above the fold.
  const rows = (supportingData?.dataPoints ?? []).filter(
    (row) => !isHero(row, supportingData?.hero)
  );
  const dataPoints = rows.length ? rows : null;
  const ranking = insight.meta?.ranking;
  const dataTarget = insightDataTarget(insight);
  const timeMethod = timeMethodKey(insight);

  const hasAnyContent =
    ranking != null ||
    formula != null ||
    algorithmDescription != null ||
    description != null ||
    dataPoints != null ||
    timeMethod != null ||
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

          {timeMethod ? (
            <Text
              testID="insight-time-method"
              style={[styles.algorithmText, isDark && styles.algorithmTextDark]}
            >
              {t(timeMethod)}
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
              onLeave={onLeave}
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
  onLeave,
  label,
  isDark,
}: {
  target: string;
  onLeave: (() => void) | undefined;
  label: string;
  isDark: boolean;
}) {
  const handlePress = useCallback(() => {
    onLeave?.();
    tapTo(target);
  }, [onLeave, target]);

  return (
    <Pressable
      testID="insight-data-link"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={pressable([styles.linkRow, isDark && styles.linkRowDark])}
      android_ripple={pressRipple}
      onPress={handlePress}
    >
      <Text style={[styles.linkText, isDark && styles.linkTextDark]}>{label}</Text>
      <MaterialCommunityIcons
        name="chevron-right"
        size={iconSize.md}
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
    ...typography.code,
    color: colors.textPrimary,
  },
  formulaTextDark: {
    color: darkColors.textPrimary,
  },
  // Algorithm description
  algorithmText: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
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
    ...typography.bodySmallBold,
    flex: 1,
    color: colors.textPrimary,
  },
  linkTextDark: {
    color: darkColors.textPrimary,
  },
});
