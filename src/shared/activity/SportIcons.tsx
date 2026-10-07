/**
 * The icon of every sport that has taken a piece of ground, side by side.
 *
 * A section or route has no sport of its own, so a surface that marks one by
 * sport draws the whole set in one colour rather than picking a member.
 */

import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '@/theme';
import { getActivityIcon } from './activityUtils';

interface SportIconsProps {
  sportTypes: readonly string[];
  size: number;
  color: string;
}

export const SportIcons = memo(function SportIcons({ sportTypes, size, color }: SportIconsProps) {
  if (sportTypes.length === 0) return null;
  return (
    <View style={styles.row}>
      {sportTypes.map((sport) => (
        <MaterialCommunityIcons
          key={sport}
          name={getActivityIcon(sport)}
          size={size}
          color={color}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
});
