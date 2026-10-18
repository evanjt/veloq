import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Shimmer } from '@/shared/ui';

/**
 * Stands in for a curve that is still on its way, at the height of the plot it
 * will become. It moves, so a fetch in flight does not read as a settled
 * "not downloaded".
 */
export function CurveLoadingPlaceholder({ plotHeight }: { plotHeight: number }) {
  return (
    <View testID="curve-loading-placeholder" style={styles.container}>
      <Shimmer height={plotHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
});
