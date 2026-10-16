import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, typography } from '@/theme';

export interface DataTableRow {
  key: string;
  cells: string[];
}

export interface DataTableProps {
  /** One header per column, the unit carried in the header rather than every cell. */
  columns: string[];
  rows: DataTableRow[];
  /** Each row's test id is this prefix and the row's index. */
  rowTestIDPrefix?: string | undefined;
}

/**
 * A read-only table of values, every column after the first right-aligned in tabular figures.
 * A screen reader reads each row as one element, every cell after its column's header, so a row
 * makes sense heard alone.
 */
export function DataTable({ columns, rows, rowTestIDPrefix }: DataTableProps) {
  const { isDark } = useTheme();
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const divider = isDark ? darkColors.border : colors.border;

  return (
    <View>
      <View style={[styles.tableRow, { borderBottomColor: divider }]} accessibilityRole="header">
        {columns.map((column, i) => (
          <Text
            key={column}
            style={[styles.header, i > 0 && styles.numeric, { color: textSecondary }]}
          >
            {column}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View
          key={row.key}
          testID={rowTestIDPrefix ? `${rowTestIDPrefix}${r}` : undefined}
          accessible
          accessibilityLabel={row.cells
            .map((cell, i) => `${columns[i] ?? ''} ${cell}`.trim())
            .join(', ')}
          style={[styles.tableRow, { borderBottomColor: divider }]}
        >
          {row.cells.map((cell, i) => (
            <Text key={i} style={[styles.cell, i > 0 && styles.numeric, { color: textPrimary }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tableRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    ...typography.label,
    flex: 1,
  },
  cell: {
    ...typography.bodySmall,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  numeric: {
    textAlign: 'right',
  },
});
