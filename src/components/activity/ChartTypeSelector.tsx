import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '@/theme';
import type { ChartConfig } from '@/lib/chartConfig';

interface ChartTypeSelectorProps {
  /** Available chart types (only those with data) */
  available: ChartConfig[];
  /** Currently selected chart type IDs */
  selected: string[];
  /** Toggle a chart type on/off */
  onToggle: (id: string) => void;
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
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {available.map((config) => {
          const isSelected = selected.includes(config.id);
          return (
            <TouchableOpacity
              key={config.id}
              style={[
                styles.chip,
                isDark && styles.chipDark,
                isSelected && { backgroundColor: config.color },
              ]}
              onPress={() => onToggle(config.id)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={config.icon as any}
                size={16}
                color={isSelected ? '#FFFFFF' : (isDark ? '#AAA' : '#666')}
                style={styles.chipIcon}
              />
              <Text
                style={[
                  styles.chipLabel,
                  isDark && styles.chipLabelDark,
                  isSelected && styles.chipLabelSelected,
                ]}
              >
                {config.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  chipIcon: {
    marginRight: 4,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
  },
  chipLabelDark: {
    color: '#AAA',
  },
  chipLabelSelected: {
    color: '#FFFFFF',
  },
});
