import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { opacity } from '@/theme';

/**
 * How a render held over a refetch is drawn: at the dim step and reported busy, so it reads as
 * the previous data rather than the data asked for. Spread onto the element that carries the
 * content's accessibility, which for a chart is its plot.
 */
export function heldRenderProps(held: boolean): {
  style: ViewStyle | undefined;
  accessibilityState: { busy: true } | undefined;
} {
  return held
    ? { style: { opacity: opacity.dim }, accessibilityState: { busy: true } }
    : { style: undefined, accessibilityState: undefined };
}

interface HeldRenderProps {
  /** The content is the previous data, kept on screen while the new data is read. */
  held: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: React.ReactNode;
}

/**
 * Holds a screen part that is not a chart while its data refetches. A chart takes `held` on its
 * `ChartSurface` instead. Touches pass through to the content, which stays live.
 */
export function HeldRender({ held, style, testID, children }: HeldRenderProps) {
  const heldProps = heldRenderProps(held);
  return (
    <View
      style={[style, heldProps.style]}
      accessibilityState={heldProps.accessibilityState}
      pointerEvents="box-none"
      testID={testID}
    >
      {children}
    </View>
  );
}
