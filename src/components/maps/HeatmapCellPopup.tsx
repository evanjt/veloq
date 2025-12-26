/**
 * HeatmapCellPopup component.
 * Displays details about a heatmap cell when tapped.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import type { CellQueryResult, HeatmapCell } from '@/hooks/useHeatmap';

interface HeatmapCellPopupProps {
  /** Query result from tapping a cell */
  cellResult: CellQueryResult;
  /** Called when popup is closed */
  onClose: () => void;
  /** Called when a route is tapped */
  onRoutePress?: (routeId: string) => void;
  /** Called when "See all activities" is tapped */
  onActivitiesPress?: (activityIds: string[]) => void;
}

export function HeatmapCellPopup({
  cellResult,
  onClose,
  onRoutePress,
  onActivitiesPress,
}: HeatmapCellPopupProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { cell, suggestedLabel } = cellResult;
  const hasRoutes = cell.routeRefs.length > 0;

  // Sort routes by activity count (most active first)
  const sortedRoutes = [...cell.routeRefs].sort(
    (a, b) => b.activityCount - a.activityCount
  );

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={[styles.label, isDark && styles.textMuted]}>
            {suggestedLabel}
          </Text>
          <Text style={[styles.stats, isDark && styles.textLight]}>
            {cell.uniqueRouteCount > 0
              ? `${cell.uniqueRouteCount} route${cell.uniqueRouteCount > 1 ? 's' : ''} • `
              : ''}
            {cell.activityIds.length} activit{cell.activityIds.length === 1 ? 'y' : 'ies'}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <MaterialCommunityIcons
            name="close"
            size={20}
            color={isDark ? '#888' : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Routes list */}
      {hasRoutes && (
        <View style={styles.routesList}>
          {sortedRoutes.slice(0, 3).map((route) => (
            <TouchableOpacity
              key={route.routeId}
              style={[styles.routeItem, isDark && styles.routeItemDark]}
              onPress={() => onRoutePress?.(route.routeId)}
              disabled={!onRoutePress}
            >
              <MaterialCommunityIcons
                name="repeat"
                size={16}
                color={colors.primary}
              />
              <Text
                style={[styles.routeName, isDark && styles.textLight]}
                numberOfLines={1}
              >
                {route.name || `Route ${route.routeId.slice(-6)}`}
              </Text>
              <Text style={[styles.routeCount, isDark && styles.textMuted]}>
                {route.activityCount}x
              </Text>
              {onRoutePress && (
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={isDark ? '#666' : '#CCC'}
                />
              )}
            </TouchableOpacity>
          ))}
          {sortedRoutes.length > 3 && (
            <Text style={[styles.moreRoutes, isDark && styles.textMuted]}>
              +{sortedRoutes.length - 3} more route{sortedRoutes.length - 3 > 1 ? 's' : ''}
            </Text>
          )}
        </View>
      )}

      {/* See all activities button */}
      {cell.activityIds.length > 0 && onActivitiesPress && (
        <TouchableOpacity
          style={styles.activitiesButton}
          onPress={() => onActivitiesPress(cell.activityIds)}
        >
          <Text style={styles.activitiesButtonText}>
            See all {cell.activityIds.length} activit{cell.activityIds.length === 1 ? 'y' : 'ies'}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={colors.primary}
          />
        </TouchableOpacity>
      )}

      {/* Density indicator */}
      <View style={styles.densityBar}>
        <View
          style={[
            styles.densityFill,
            { width: `${Math.round(cell.density * 100)}%` },
          ]}
        />
      </View>
      <Text style={[styles.densityLabel, isDark && styles.textMuted]}>
        {cell.visitCount} visit{cell.visitCount === 1 ? '' : 's'}
        {cell.isCommonPath && ' • Common path'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  containerDark: {
    backgroundColor: '#1E1E1E',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerInfo: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  stats: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  closeButton: {
    padding: 4,
  },
  routesList: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  routeItemDark: {
    borderBottomColor: '#333',
  },
  routeName: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  routeCount: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  moreRoutes: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  activitiesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  activitiesButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  densityBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  densityFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  densityLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
});
