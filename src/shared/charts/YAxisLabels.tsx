import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { chartStyles, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { DenseText } from '@/shared/ui/DenseText';
import { axisLabelTops, type AxisTick } from './axisLabels';
import type { Domain } from './cartesian';

/** The height of one tick label's box, which its centre is placed from. */
export const Y_LABEL_BOX = typography.caption.lineHeight;

export interface YAxisLabelsProps {
  ticks: readonly AxisTick[];
  /** The plot's y domain, the same one its canvas draws with. */
  domain: Domain;
  /** The plot's top and bottom padding inside the box this gutter shares a row with. */
  padding: { top?: number; bottom?: number };
  testID?: string;
}

/**
 * The value axis in a gutter left of the plot. Each label is centred on its
 * value's pixel, and the gutter is as wide as its widest label.
 */
export function YAxisLabels({ ticks, domain, padding, testID }: YAxisLabelsProps) {
  const { isDark } = useTheme();
  const [height, setHeight] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setHeight((prev) => (prev === next ? prev : next));
  }, []);

  const labelStyle = [chartStyles.axisLabel, isDark && chartStyles.axisLabelDark];
  const tops =
    height > 0
      ? axisLabelTops(
          ticks.map((tick) => tick.value),
          domain,
          { top: padding.top ?? 0, bottom: height - (padding.bottom ?? 0) },
          Y_LABEL_BOX
        )
      : null;

  return (
    <View style={styles.gutter} onLayout={onLayout} pointerEvents="none" testID={testID}>
      {/* Sizes the gutter to the widest label without taking any height. */}
      <View style={styles.sizer} importantForAccessibility="no-hide-descendants">
        {ticks.map((tick, i) => (
          <DenseText key={i} style={labelStyle}>
            {tick.label}
          </DenseText>
        ))}
      </View>
      {tops
        ? ticks.map((tick, i) => (
            <DenseText
              key={i}
              style={[labelStyle, styles.label, { top: tops[i] ?? 0 }]}
              testID={tick.testID ?? (testID ? `${testID}-${i}` : undefined)}
            >
              {tick.label}
            </DenseText>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gutter: {
    alignSelf: 'stretch',
    paddingRight: spacing.xs,
  },
  sizer: {
    height: 0,
    overflow: 'hidden',
  },
  label: {
    position: 'absolute',
    right: spacing.xs,
    height: Y_LABEL_BOX,
    textAlign: 'right',
  },
});
