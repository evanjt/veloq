import React from 'react';
import { StyleSheet } from 'react-native';

import { useSheetRequest } from '@/shared/app/sheetRequest';
import { goBack } from '@/shared/app/navigation';
import type { ChartTable } from '@/shared/charts/chartSummary';
import { DataTable, SheetHeader, SheetScrollView } from '@/shared/ui';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { layout } from '@/theme';

/** The numbers behind a chart, a sheet route that lists the table it is given and returns nothing. */

function ChartDataSheetContent() {
  const { input } = useSheetRequest<ChartTable, never>();
  if (!input) return null;

  return (
    <SheetScrollView contentContainerStyle={styles.content}>
      <SheetHeader title={input.title} onClose={() => goBack()} closeTestID="chart-data-close" />
      <DataTable columns={input.columns} rows={input.rows} rowTestIDPrefix="chart-data-row-" />
    </SheetScrollView>
  );
}

export default withScreenBoundary(ChartDataSheetContent, 'Chart Data');

const styles = StyleSheet.create({
  content: {
    paddingBottom: layout.screenPadding,
  },
});
