import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSheetOpener } from '@/shared/app/sheetRequest';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import { accessibleActions } from '@/shared/ui/accessibleActions';
import { heldRenderProps } from '@/shared/ui/HeldRender';
import { TextLink } from '@/shared/ui/TextLink';
import { useScreenReaderEnabled } from '@/shared/ui/useScreenReaderEnabled';
import { chartStyles, spacing } from '@/theme';

import type { ChartTable } from './chartSummary';

/**
 * A chart's spoken summary and table, built on demand. Both cost a formatted label per plotted
 * point, and are read only by a screen reader or when Show data opens, so a chart passes this
 * rather than building them on every data change.
 */
export interface ChartReadingSource {
  /** Whether the plot has rows to list, known without building them. */
  hasRows: boolean;
  read: () => { summary: string; table: ChartTable | null };
}

export interface ChartSurfaceProps {
  /** The sentence a screen reader speaks for the plot, from `chartSummary`. */
  summary?: string;
  /** The rows behind the plot. With none, the plot offers no Show data. */
  table?: ChartTable | null | undefined;
  /** Instead of `summary` and `table`: built only when a screen reader is on or Show data opens. */
  reading?: ChartReadingSource;
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
function useShowData(
  table: ChartTable | null | undefined,
  reading: ChartReadingSource | undefined
): (() => void) | null {
  const openSheet = useSheetOpener();
  const showData = useCallback(() => {
    const rows = reading ? reading.read().table : table;
    if (rows) void openSheet<ChartTable, never>('sheets/chart-data', rows);
  }, [openSheet, table, reading]);
  const hasRows = reading ? reading.hasRows : table != null && table.rows.length > 0;
  return hasRows ? showData : null;
}

/**
 * The one surface every chart's plot sits in. A canvas says nothing to a screen reader, so the
 * plot is one image labelled with its summary, and it offers Show data both as a custom action
 * and as a visible button under the plot, either opening the chart's rows in a table sheet. A
 * plot held over a refetch is dimmed and reported busy; Show data stays at full strength. The
 * plot is laid out left to right in every layout direction, so its labels run the way its
 * canvas draws.
 */
export function ChartSurface({
  summary,
  table,
  reading,
  style,
  held = false,
  showDataButton = true,
  testID,
  children,
}: ChartSurfaceProps) {
  const { t } = useTranslation();
  const showData = useShowData(table, reading);
  const screenReader = useScreenReaderEnabled();
  const spoken = useMemo(
    () => (reading ? (screenReader ? reading.read().summary : '') : (summary ?? '')),
    [reading, screenReader, summary]
  );
  const heldProps = heldRenderProps(held);

  return (
    <>
      <View
        style={[styles.plot, chartStyles.plotDirection, style, heldProps.style]}
        testID={testID}
        accessible
        accessibilityRole="image"
        accessibilityLabel={composeAccessibilityLabel(spoken)}
        accessibilityState={heldProps.accessibilityState}
        {...accessibleActions(
          showData ? [{ name: 'showData', label: t('charts.showData'), run: showData }] : undefined
        )}
      >
        {children}
      </View>
      {showDataButton ? (
        <ChartShowDataButton table={table} reading={reading} testID={testID} />
      ) : null}
    </>
  );
}

/**
 * The visible Show data button under a chart, nothing when the chart has no rows. `ChartSurface`
 * draws it; a chart whose plot sits in a scroll draws it under the scroll instead.
 */
export function ChartShowDataButton({
  table,
  reading,
  testID,
}: {
  table?: ChartTable | null | undefined;
  reading?: ChartReadingSource | undefined;
  /** The plot's own test id, which the button carries with `-show-data` after it. */
  testID?: string | undefined;
}) {
  const { t } = useTranslation();
  const showData = useShowData(table, reading);
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
