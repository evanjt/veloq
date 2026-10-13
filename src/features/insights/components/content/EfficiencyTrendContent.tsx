import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '@/theme';
import type { Insight } from '@/types';
import { SupportingDataSection } from '../SupportingDataSection';
import { SheetContext } from './SheetContext';

interface EfficiencyTrendContentProps {
  insight: Insight;
}

/**
 * Detail content for aerobic efficiency trend insights: what the matched
 * efforts compare, then the series. The heart rate change is the sheet's
 * figure, and the one section is reached through the data link in the method
 * fold, so this draws no row of its own for it.
 */
export const EfficiencyTrendContent = React.memo(function EfficiencyTrendContent({
  insight,
}: EfficiencyTrendContentProps) {
  const { t } = useTranslation();
  const supportingData = insight.supportingData;

  return (
    <View style={styles.container}>
      <SheetContext
        heading={t('insights.efficiencyTrend.sheetHeading')}
        body={t('insights.efficiencyTrend.sheetBody')}
        meta={t('insights.efficiencyTrend.sheetMeta')}
      />

      {supportingData ? <SupportingDataSection data={{ ...supportingData, sections: [] }} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
});
