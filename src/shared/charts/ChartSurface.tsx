import React, { useCallback } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import { accessibleActions } from '@/shared/ui/accessibleActions';
import { heldRenderProps } from '@/shared/ui/HeldRender';
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
  /** The plot is the previous data, kept on screen while the new data is read. */
  held?: boolean;
  /**
   * False where the plot sits inside a pressable card, so Show data is the plot's action alone
   * rather than a second press target inside the card, or where the chart places
   * `ChartShowDataButton` itself, outside a scroll the plot sits in.
   */
  showDataButton?: boolean;
  testID?: string;
  children: React.ReactNode;
}

/** Opens the chart's rows in the table sheet, or null when it has none. */
function useShowData(table: ChartTable | null): (() => void) | null {
  const openSheet = useSheetOpener();
  const showData = useCallback(() => {
    if (table) void openSheet<ChartTable, never>('sheets/chart-data', table);
  }, [openSheet, table]);
  return table != null && table.rows.length > 0 ? showData : null;
}

/**
 * The one surface every chart's plot sits in. A canvas says nothing to a screen reader, so the
 * plot is one image labelled with its summary, and it offers Show data both as a custom action
 * and as a visible button under the plot, either opening the chart's rows in a table sheet. A
 * plot held over a refetch is dimmed and reported busy; Show data stays at full strength.
 */
export function ChartSurface({
  summary,
  table,
  style,
  held = false,
  showDataButton = true,
  testID,
  children,
}: ChartSurfaceProps) {
  const { t } = useTranslation();
  const showData = useShowData(table);
  const heldProps = heldRenderProps(held);

  return (
    <>
      <View
        style={[styles.plot, style, heldProps.style]}
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        accessibilityState={heldProps.accessibilityState}
        {...accessibleActions(
          showData ? [{ name: 'showData', label: t('charts.showData'), run: showData }] : undefined
        )}
      >
        {children}
      </View>
      {showDataButton ? <ChartShowDataButton table={table} testID={testID} /> : null}
    </>
  );
}

/**
 * The visible Show data button under a chart, nothing when the chart has no rows. `ChartSurface`
 * draws it; a chart whose plot sits in a scroll draws it under the scroll instead.
 */
export function ChartShowDataButton({
  table,
  testID,
}: {
  table: ChartTable | null;
  /** The plot's own test id, which the button carries with `-show-data` after it. */
  testID?: string | undefined;
}) {
  const { t } = useTranslation();
  const showData = useShowData(table);
  if (!showData) return null;
  return (
    <TextLink
      label={t('charts.showData')}
      onPress={showData}
      size="caption"
      accessibilityRole="button"
      style={styles.showData}
      {...(testID ? { testID: `${testID}-show-data` } : {})}
    />
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
