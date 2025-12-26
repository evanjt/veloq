import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, useColorScheme, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, typography, layout, spacing } from '@/theme';
import type { ChartConfig } from '@/lib/chartConfig';

interface ChartTypeSelectorProps {
  /** Available chart types (only those with data) */
  available: ChartConfig[];
  /** Currently selected chart type IDs */
  selected: string[];
  /** Toggle a chart type on/off */
  onToggle: (id: string) => void;
}

/** Convert hex color to rgba with opacity */
function hexToRgba(hex: string, opacity: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function ChartTypeSelector({
  available,
  selected,
  onToggle,
}: ChartTypeSelectorProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (available.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {available.map((config) => {
        const isSelected = selected.includes(config.id);
        // Use full color when selected, faded color when unselected
        const bgColor = isSelected
          ? config.color
          : hexToRgba(config.color, isDark ? 0.25 : 0.15);
        const textColor = isSelected
          ? colors.textOnDark
          : config.color;

        return (
          <TouchableOpacity
            key={config.id}
            style={[styles.chip, { backgroundColor: bgColor }]}
            onPress={() => onToggle(config.id)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={config.icon}
              size={12}
              color={textColor}
            />
            <Text style={[styles.chipLabel, { color: textColor }]}>
              {config.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: layout.borderRadius,
  },
  chipLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
  },
});
