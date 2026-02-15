import React from 'react';
import { Text, StyleSheet, TextStyle } from 'react-native';

// GradientText simplified - shows solid color (gradient requires dev build)
// Brand: Teal primary, Gold for achievements only
export function GradientText({
  children,
  colors = ['#2DD4BF', '#14B8A6'],
  style,
}: {
  children: string | number;
  colors?: string[];
  style?: TextStyle;
}) {
  // In Expo Go, just use the first color
  // In dev builds, you could use MaskedView + LinearGradient
  return <Text style={[styles.text, style, { color: colors[0] }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  text: {
    fontSize: 16,
  },
});
