/**
 * The divider between the rows of a group, and the group that draws it.
 *
 * A row has no divider of its own: the group behind it separates its rows
 * with one hairline in the border colour, kept soft by its thinness. The line
 * starts past the row's leading icon, so it divides the words and not the
 * icon column.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, stroke } from '@/theme';

/** Where a row's words start: its edge padding, a 24px icon and the gap after it. */
export const ROW_DIVIDER_INSET = spacing.md + iconSize.lg + spacing.sm;

/**
 * `icon` starts the line where the words of an icon row start, `edge` at the
 * rows' edge padding when they carry no icon, `none` runs it full width.
 */
export type RowDividerInset = 'icon' | 'edge' | 'none';

const INSET: Record<RowDividerInset, number | undefined> = {
  icon: ROW_DIVIDER_INSET,
  edge: spacing.md,
  none: undefined,
};

interface RowDividerProps {
  inset?: RowDividerInset;
}

/** One divider, for a group whose rows sit among other blocks. */
export function RowDivider({ inset = 'icon' }: RowDividerProps) {
  const { isDark } = useTheme();
  return (
    <View
      testID="row-divider"
      style={[
        styles.divider,
        isDark && styles.dividerDark,
        INSET[inset] !== undefined && { marginLeft: INSET[inset] },
      ]}
    />
  );
}

/** The drawn children, with fragments opened and empty slots dropped. */
function drawnChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment
      ? drawnChildren(child.props.children)
      : [child]
  );
}

interface RowGroupProps {
  children: React.ReactNode;
  inset?: RowDividerInset;
}

/** Lays out its rows with one divider between each pair. */
export function RowGroup({ children, inset = 'icon' }: RowGroupProps) {
  return (
    <>
      {drawnChildren(children).map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 && <RowDivider inset={inset} />}
          {child}
        </React.Fragment>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: stroke.hairline,
    backgroundColor: colors.border,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
});
