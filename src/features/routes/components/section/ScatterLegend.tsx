/**
 * Legend for the attempt scatter, one row: the shown direction's dot, the
 * trend, the record, this activity and the hollow mark for a route attempt
 * outside its distance band, each only when the plot draws it. Every key is
 * drawn by the mark it names. Shared by the route detail, section detail and
 * activity Routes tab surfaces.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { chartStyles, spacing } from '@/theme';
import { Button } from '@/shared/ui';
import { ChartMarkKey, type ChartMarkKeyKind } from '@/shared/charts';
import { directionColour } from '@/features/routes/lib/directionColour';
import type { ChartDirection } from '@/features/routes/lib/scatterData';

export interface ScatterLegendProps {
  isDark: boolean;
  /** The direction the plot shows, whose colour its dots and trend are drawn in. */
  direction: ChartDirection;
  showRecord: boolean;
  showThisActivity: boolean;
  showOutsideBand?: boolean;
  showTrend?: boolean;
}

export function ScatterLegend({
  isDark,
  direction,
  showRecord,
  showThisActivity,
  showOutsideBand = false,
  showTrend = false,
}: ScatterLegendProps) {
  const colour = directionColour(direction, isDark);
  const { t } = useTranslation();
  const [showMethod, setShowMethod] = useState(false);

  return (
    <View style={styles.legend} testID="scatter-legend">
      <LegendKey
        mark="dot"
        color={colour}
        isDark={isDark}
        label={t(direction === 'reverse' ? 'sections.reverse' : 'sections.forward')}
        testID="scatter-legend-direction"
      />
      {showTrend ? (
        <Button
          variant="ghost"
          size="sm"
          label={t('sections.legendTrend')}
          // The legend key takes the trend line's own colour, which is what it names.
          icon={{ name: 'minus', ink: colour }}
          onPress={() => setShowMethod((shown) => !shown)}
        />
      ) : null}
      {showRecord ? (
        <LegendKey
          mark="record"
          isDark={isDark}
          label={t('sections.legendRecord')}
          testID="scatter-legend-record"
        />
      ) : null}
      {showThisActivity ? (
        <LegendKey
          mark="reticle"
          isDark={isDark}
          label={t('sections.legendThisActivity')}
          testID="scatter-legend-this-activity"
        />
      ) : null}
      {showOutsideBand ? (
        <LegendKey
          mark="hollow"
          color={colour}
          isDark={isDark}
          label={t('sections.legendOutsideBand')}
          testID="scatter-legend-outside-band"
        />
      ) : null}
      {showTrend && showMethod ? (
        <Text
          style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark, styles.methodText]}
        >
          {t('sections.legendTrendMethod')}
        </Text>
      ) : null}
    </View>
  );
}

function LegendKey({
  mark,
  color,
  isDark,
  label,
  testID,
}: {
  mark: ChartMarkKeyKind;
  color?: string;
  isDark: boolean;
  label: string;
  testID: string;
}) {
  return (
    <View style={styles.legendItem} testID={testID}>
      <ChartMarkKey mark={mark} {...(color ? { color } : {})} />
      <Text style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    columnGap: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsPlus,
  },
  methodText: {
    width: '100%',
    textAlign: 'center',
  },
});
