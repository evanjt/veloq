import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing } from '@/theme';

interface DecouplingChartProps {
  /** Power or pace data */
  power?: number[];
  /** Heart rate data */
  heartrate?: number[];
  /** Height of the chart area */
  height?: number;
}

function calculateDecoupling(power: number[], heartrate: number[]): {
  firstHalfEf: number;
  secondHalfEf: number;
  decoupling: number;
  isGood: boolean;
} {
  const midpoint = Math.floor(power.length / 2);

  // Calculate efficiency (power/HR) for each half
  const firstHalfPower = power.slice(0, midpoint);
  const firstHalfHR = heartrate.slice(0, midpoint);
  const secondHalfPower = power.slice(midpoint);
  const secondHalfHR = heartrate.slice(midpoint);

  const avgFirstPower = firstHalfPower.reduce((a, b) => a + b, 0) / firstHalfPower.length;
  const avgFirstHR = firstHalfHR.reduce((a, b) => a + b, 0) / firstHalfHR.length;
  const avgSecondPower = secondHalfPower.reduce((a, b) => a + b, 0) / secondHalfPower.length;
  const avgSecondHR = secondHalfHR.reduce((a, b) => a + b, 0) / secondHalfHR.length;

  const firstHalfEf = avgFirstPower / avgFirstHR;
  const secondHalfEf = avgSecondPower / avgSecondHR;

  // Decoupling percentage: how much efficiency dropped
  const decoupling = ((firstHalfEf - secondHalfEf) / firstHalfEf) * 100;

  // < 5% decoupling is considered good aerobic fitness
  const isGood = decoupling < 5;

  return { firstHalfEf, secondHalfEf, decoupling, isGood };
}

export function DecouplingChart({ power, heartrate, height = 150 }: DecouplingChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // All hooks must be called before any conditional returns
  const analysis = useMemo(() => {
    if (!power || !heartrate || power.length === 0 || heartrate.length === 0) {
      return { firstHalfEf: 0, secondHalfEf: 0, decoupling: 0, isGood: true };
    }
    return calculateDecoupling(power, heartrate);
  }, [power, heartrate]);

  const midpoint = useMemo(() => {
    if (!power) return 0;
    return Math.floor(power.length / 2);
  }, [power]);

  // Show empty state if no data
  if (!power || !heartrate || power.length === 0 || heartrate.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Aerobic Decoupling</Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No decoupling data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete a sustained effort with power and heart rate data to see decoupling analysis
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Aerobic Decoupling</Text>
        <Text
          style={[
            styles.decouplingValue,
            { color: analysis.isGood ? colors.success : colors.warning },
          ]}
        >
          {analysis.decoupling.toFixed(1)}%
        </Text>
      </View>

      {/* Status indicator */}
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: analysis.isGood ? colors.success : colors.warning },
          ]}
        >
          <Text style={styles.statusText}>
            {analysis.isGood ? 'Good Aerobic Fitness' : 'Needs Improvement'}
          </Text>
        </View>
        <Text style={[styles.targetText, isDark && styles.textDark]}>
          Target: &lt; 5%
        </Text>
      </View>

      {/* Mini chart visualization */}
      <View style={[styles.chartContainer, { height }]}>
        {/* First half */}
        <View style={[styles.halfSection, styles.firstHalf]}>
          <Text style={[styles.halfLabel, isDark && styles.textDark]}>First Half</Text>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>Avg Power</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(power.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint)}W
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>Avg HR</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(heartrate.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint)} bpm
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>Efficiency</Text>
            <Text style={[styles.dataValue, { color: colors.primary }]}>
              {analysis.firstHalfEf.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Divider with arrow */}
        <View style={styles.divider}>
          <View style={[styles.dividerLine, isDark && styles.dividerLineDark]} />
          <Text style={styles.arrow}>→</Text>
          <View style={[styles.dividerLine, isDark && styles.dividerLineDark]} />
        </View>

        {/* Second half */}
        <View style={[styles.halfSection, styles.secondHalf]}>
          <Text style={[styles.halfLabel, isDark && styles.textDark]}>Second Half</Text>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>Avg Power</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(power.slice(midpoint).reduce((a, b) => a + b, 0) / (power.length - midpoint))}W
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>Avg HR</Text>
            <Text style={[styles.dataValue, isDark && styles.textLight]}>
              {Math.round(heartrate.slice(midpoint).reduce((a, b) => a + b, 0) / (heartrate.length - midpoint))} bpm
            </Text>
          </View>
          <View style={styles.dataRow}>
            <Text style={[styles.dataLabel, isDark && styles.textDark]}>Efficiency</Text>
            <Text style={[styles.dataValue, { color: analysis.isGood ? colors.primary : colors.warning }]}>
              {analysis.secondHalfEf.toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      {/* Explanation */}
      <Text style={[styles.explanation, isDark && styles.textDark]}>
        Decoupling measures cardiac drift - how much your heart rate rises relative to power output during sustained efforts.
        Lower is better, indicating efficient aerobic energy production.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  decouplingValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  targetText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  halfSection: {
    flex: 1,
    padding: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 8,
  },
  firstHalf: {
    marginRight: 4,
  },
  secondHalf: {
    marginLeft: 4,
  },
  halfLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dataLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  dataValue: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  divider: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dividerLine: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  dividerLineDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  arrow: {
    fontSize: 16,
    color: colors.textSecondary,
    marginVertical: 4,
  },
  explanation: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
});
