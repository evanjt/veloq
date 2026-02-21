/**
 * Unified chart container component.
 *
 * Provides consistent wrapper for all charts with:
 * - Gesture handling integration
 * - Loading/error states
 * - Consistent padding and layout
 */

import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { GestureDetector, GestureType } from 'react-native-gesture-handler';
import { colors, typography, chartStyles } from '@/theme';
import { useTheme } from '@/hooks';

export interface ChartPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface ChartContainerProps {
  /** Chart height */
  height: number;
  /** Chart title */
  title?: string;
  /** Gesture from useChartGestures */
  gesture?: GestureType;
  /** Loading state */
  isLoading?: boolean;
  /** Loading text */
  loadingText?: string;
  /** Error state */
  error?: boolean;
  /** Error/empty text */
  emptyText?: string;
  /** Chart content */
  children: ReactNode;
  /** Header content (right side of title) */
  headerRight?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
}

export const ChartContainer = React.memo(function ChartContainer({
  height,
  title,
  gesture,
  isLoading,
  loadingText = 'Loading...',
  error,
  emptyText = 'No data available',
  children,
  headerRight,
  footer,
}: ChartContainerProps) {
  const { isDark } = useTheme();

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        {title && (
          <View style={styles.header}>
            <Text style={[styles.title, isDark && styles.textLight]}>{title}</Text>
            {headerRight}
          </View>
        )}
        <View style={styles.centerContent}>
          <Text style={[styles.statusText, isDark && chartStyles.textDark]}>{loadingText}</Text>
        </View>
      </View>
    );
  }

  // Error/empty state
  if (error) {
    return (
      <View style={[styles.container, { height }]}>
        {title && (
          <View style={styles.header}>
            <Text style={[styles.title, isDark && styles.textLight]}>{title}</Text>
            {headerRight}
          </View>
        )}
        <View style={styles.centerContent}>
          <Text style={[styles.statusText, isDark && chartStyles.textDark]}>{emptyText}</Text>
        </View>
      </View>
    );
  }

  // Normal render
  const chartContent = <View style={chartStyles.chartWrapper}>{children}</View>;

  return (
    <View style={[styles.container, { height }]}>
      {title && (
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>{title}</Text>
          {headerRight}
        </View>
      )}
      {gesture ? <GestureDetector gesture={gesture}>{chartContent}</GestureDetector> : chartContent}
      {footer}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
});

export default ChartContainer;
