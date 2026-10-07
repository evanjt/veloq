import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Shimmer } from '@/shared/ui';
import { spacing } from '@/theme';

/** Room the card's title and padding take above the plot. */
const CHROME_HEIGHT = spacing.xl * 2;

/**
 * Stands in for a curve that is still on its way, at the height of the plot it
 * will become. It moves, so a fetch in flight does not read as a settled
 * "not downloaded".
 */
export function CurveLoadingPlaceholder({ height }: { height: number }) {
  return (
    <View testID="curve-loading-placeholder" style={styles.container}>
      <Shimmer height={Math.max(height - CHROME_HEIGHT, 0)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
});
