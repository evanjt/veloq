import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { chartStyles, colourTokens, layout, spacing, stroke } from '@/theme';

import { dotDisks } from './chartMarks';

interface RankRingProps {
  /** Second or third place. First is the record and takes the gold ring. */
  rank: 2 | 3;
  isDark: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

const DIAMETER = 2 * dotDisks().ring;

/**
 * Second or third place: a ring the size of a ringed dot in the reference
 * colour, its place printed beside it. It is never a medal tone, since gold is
 * the record alone and a second and third hue would be read as two more series.
 */
export function RankRing({ rank, isDark, testID, accessibilityLabel }: RankRingProps) {
  const reference = colourTokens[isDark ? 'dark' : 'light']['chart-reference'];
  return (
    <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={styles.row}>
      <View
        testID={testID ? `${testID}-ring` : undefined}
        style={[styles.ring, { borderColor: reference }]}
      />
      <Text style={[chartStyles.chartLabel, isDark && chartStyles.chartLabelDark]}>{rank}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  ring: {
    width: DIAMETER,
    height: DIAMETER,
    borderRadius: layout.borderRadiusFull,
    borderWidth: stroke.two,
  },
});
