import React from 'react';
import { TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadows } from '@/theme';

interface MapFABProps {
  onPress: () => void;
  style?: ViewStyle;
}

export function MapFAB({ onPress, style }: MapFABProps) {
  return (
    <TouchableOpacity
      style={[styles.fab, style]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name="map" size={24} color={colors.surface} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    // Platform-optimized FAB shadow
    ...shadows.fab,
  },
});
