import React, { useCallback } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import { accessibleActions } from '@/shared/ui/accessibleActions';
import { TextLink } from '@/shared/ui/TextLink';
import { spacing } from '@/theme';

import type { ChartTable } from './chartSummary';

export interface ChartSurfaceProps {
  /** The sentence a screen reader speaks for the plot, from `chartSummary`. */
  summary: string;
  /** The rows behind the plot. With none, the plot offers no Show data. */
  table: ChartTable | null;
  /** The plot's own box, `flex: 1` by default so it fills a sized parent. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
}

/**
 * The one surface every chart's plot sits in. A canvas says nothing to a screen reader, so the
 * plot is one image labelled with its summary, and it offers Show data both as a custom action
 * and as a visible button under the plot, either opening the chart's rows in a table sheet.
 */
export function ChartSurface({ summary, table, style, testID, children }: ChartSurfaceProps) {
  const { t } = useTranslation();
  const openSheet = useSheetOpener();
  const hasRows = table != null && table.rows.length > 0;
  const showData = useCallback(() => {
    if (table) void openSheet<ChartTable, never>('sheets/chart-data', table);
  }, [openSheet, table]);
  const label = t('charts.showData');

  return (
    <>
      <View
        style={[styles.plot, style]}
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        {...accessibleActions(hasRows ? [{ name: 'showData', label, run: showData }] : undefined)}
      >
        {children}
      </View>
      {hasRows ? (
        <TextLink
          label={label}
          onPress={showData}
          size="caption"
          accessibilityRole="button"
          style={styles.showData}
          {...(testID ? { testID: `${testID}-show-data` } : {})}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  plot: {
    flex: 1,
  },
  showData: {
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
  },
});
