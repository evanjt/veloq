/**
 * How each recorded wellness variable relates to attempt speed on one section, per direction.
 * The engine computes every figure and its order; this draws them and states no cause.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Switch } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { FfiCorrelation_Tags } from 'veloqrs';
import type { FfiSectionCorrelation } from 'veloqrs';
import { Card } from '@/shared/ui';
import { correlationReading, type CorrelationStrength } from '../../lib/correlationReading';
import { colors, darkColors, spacing, typography } from '@/theme';

/** Label keys per variable token: the wellness and fitness labels where one exists. */
const VARIABLE_LABEL_KEYS: Record<string, string> = {
  ctl: 'fitnessScreen.ctl',
  atl: 'fitnessScreen.atl',
  ramp_rate: 'sections.correlationVarRampRate',
  hrv: 'metrics.hrv',
  resting_hr: 'wellness.restingHR',
  weight: 'metrics.weight',
  sleep_secs: 'wellness.sleep',
  sleep_score: 'wellness.sleepScore',
  soreness: 'sections.correlationVarSoreness',
  fatigue: 'sections.correlationVarFatigue',
  stress: 'sections.correlationVarStress',
  mood: 'sections.correlationVarMood',
  motivation: 'sections.correlationVarMotivation',
};

const STRENGTH_LABEL_KEYS: Record<CorrelationStrength, string> = {
  none: 'sections.correlationNoClearLink',
  veryWeak: 'sections.correlationStrengthVeryWeak',
  weak: 'sections.correlationStrengthWeak',
  moderate: 'sections.correlationStrengthModerate',
  strong: 'sections.correlationStrengthStrong',
  veryStrong: 'sections.correlationStrengthVeryStrong',
};

const DIRECTION_LABEL_KEYS: Record<string, string> = {
  same: 'sections.correlationDirectionSame',
  reverse: 'sections.correlationDirectionReverse',
};

export interface SectionCorrelationCardProps {
  correlations: FfiSectionCorrelation[];
  /** Attempts with a value the engine required before it reported a coefficient. */
  floor: number;
  isDark: boolean;
}

function hasCoefficient(row: FfiSectionCorrelation): boolean {
  return (
    row.result.tag === FfiCorrelation_Tags.Mover ||
    row.result.tag === FfiCorrelation_Tags.Inconclusive
  );
}

/** Rows grouped by direction, each group in the order the engine sent its rows. */
function groupByDirection(rows: FfiSectionCorrelation[]): [string, FfiSectionCorrelation[]][] {
  const groups = new Map<string, FfiSectionCorrelation[]>();
  for (const row of rows) {
    const group = groups.get(row.direction);
    if (group) group.push(row);
    else groups.set(row.direction, [row]);
  }
  return [...groups.entries()];
}

export function SectionCorrelationCard({
  correlations,
  floor,
  isDark,
}: SectionCorrelationCardProps) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  if (correlations.length === 0) return null;

  const mutedStyle = [styles.muted, isDark && styles.mutedDark];
  const primaryStyle = [styles.row, isDark && styles.rowDark];

  const renderRow = (row: FfiSectionCorrelation) => {
    const labelKey = VARIABLE_LABEL_KEYS[row.variable];
    const label = labelKey ? t(labelKey as never) : row.variable;
    const testID = `section-correlation-row-${row.direction}-${row.variable}`;
    const result = row.result;

    if (
      result.tag === FfiCorrelation_Tags.Mover ||
      result.tag === FfiCorrelation_Tags.Inconclusive
    ) {
      const { r, n, low, high } = result.inner;
      const inconclusive = result.tag === FfiCorrelation_Tags.Inconclusive;
      const reading = inconclusive
        ? { strength: 'none' as const, direction: null }
        : correlationReading(r, low, high);
      return (
        <View key={testID} style={styles.rowGroup}>
          <View testID={testID} style={styles.columns}>
            <Text style={[styles.inputCell, inconclusive ? mutedStyle : primaryStyle]}>
              {label}
            </Text>
            <Text style={[styles.strengthCell, inconclusive ? mutedStyle : primaryStyle]}>
              {t(STRENGTH_LABEL_KEYS[reading.strength] as never)}
            </Text>
            <Text style={[styles.directionCell, mutedStyle]}>
              {reading.direction === 'higher'
                ? t('sections.correlationFasterWhenHigher')
                : reading.direction === 'lower'
                  ? t('sections.correlationFasterWhenLower')
                  : ''}
            </Text>
            <Text style={[styles.countCell, mutedStyle]}>
              {t('sections.correlationAttempts', { n })}
            </Text>
          </View>
          {showRaw ? (
            <Text
              testID={`section-correlation-raw-${row.direction}-${row.variable}`}
              style={mutedStyle}
            >
              {t('sections.correlationFigures', {
                r: r.toFixed(2),
                n,
                low: low.toFixed(2),
                high: high.toFixed(2),
              })}
            </Text>
          ) : null}
        </View>
      );
    }

    const notEnough =
      result.tag === FfiCorrelation_Tags.TooFew
        ? t('sections.correlationNotEnoughDataOfFloor', {
            n: result.inner.n,
            floor,
          })
        : t('sections.correlationNotEnoughData', { n: result.inner.n });
    return (
      <Text key={testID} testID={testID} style={mutedStyle}>
        {label}: {notEnough}
      </Text>
    );
  };

  const renderCollapsed = (direction: string, rows: FfiSectionCorrelation[]) => {
    const largest = Math.max(
      ...rows.map((row) => (row.result as { inner: { n: number } }).inner.n)
    );
    return (
      <Text
        key={`collapsed-${direction}`}
        testID={`section-correlation-collapsed-${direction}`}
        style={mutedStyle}
      >
        {t('sections.correlationCollapsed', { n: largest, floor })}
      </Text>
    );
  };

  return (
    <Card
      variant="flat"
      testID="section-correlation-card"
      accessibilityRole="summary"
      style={{ gap: spacing.xs }}
    >
      <Text style={[styles.heading, isDark && styles.headingDark]}>
        {t('sections.correlationTitle')}
      </Text>
      <Text style={mutedStyle}>{t('sections.correlationMethod')}</Text>
      <View style={styles.switchRow}>
        <Text style={mutedStyle}>{t('sections.correlationShowRaw')}</Text>
        <Switch
          testID="section-correlation-raw-switch"
          value={showRaw}
          onValueChange={setShowRaw}
          accessibilityLabel={t('sections.correlationShowRaw')}
        />
      </View>

      {groupByDirection(correlations).map(([direction, rows]) => (
        <View key={direction} style={styles.group}>
          <Text style={[styles.direction, isDark && styles.directionDark]}>
            {DIRECTION_LABEL_KEYS[direction]
              ? t(DIRECTION_LABEL_KEYS[direction] as never)
              : direction}
          </Text>
          {rows.some(hasCoefficient) ? rows.map(renderRow) : renderCollapsed(direction, rows)}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  headingDark: {
    color: darkColors.textPrimary,
  },
  rowGroup: {
    gap: spacing.xxs,
  },
  columns: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  inputCell: {
    flex: 3,
  },
  strengthCell: {
    flex: 3,
  },
  directionCell: {
    flex: 4,
  },
  countCell: {
    flex: 3,
    textAlign: 'right',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  group: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  direction: {
    ...typography.label,
    color: colors.textPrimary,
  },
  directionDark: {
    color: darkColors.textPrimary,
  },
  row: {
    ...typography.bodySmall,
    color: colors.textPrimary,
  },
  rowDark: {
    color: darkColors.textPrimary,
  },
  muted: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  mutedDark: {
    color: darkColors.textSecondary,
  },
});
