import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';

interface GpsSignalIndicatorProps {
  accuracy: number | null;
}

export function GpsSignalIndicator({ accuracy }: GpsSignalIndicatorProps) {
  let color: string;
  let icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  let label: string;

  if (accuracy == null) {
    color = colors.iconNeutral;
    icon = 'crosshairs-question';
    label = '--';
  } else if (accuracy < 5) {
    color = colors.success;
    icon = 'crosshairs-gps';
    label = `${Math.round(accuracy)}m`;
  } else if (accuracy <= 15) {
    color = colors.warning;
    icon = 'crosshairs';
    label = `${Math.round(accuracy)}m`;
  } else {
    color = colors.error;
    icon = 'crosshairs-question';
    label = `${Math.round(accuracy)}m`;
  }

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name={icon} size={14} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
