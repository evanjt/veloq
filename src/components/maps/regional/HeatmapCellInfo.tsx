import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import type { CellQueryResult } from '@/hooks/useHeatmap';

interface HeatmapCellPopupProps {
  cell: CellQueryResult;
  bottom: number;
  onClose: () => void;
}

export function HeatmapCellInfo({ cell, bottom, onClose }: HeatmapCellPopupProps) {
  return (
    <View style={[styles.popup, { bottom }]}>
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={styles.popupTitle}>
            {cell.suggestedLabel || 'Heatmap Cell'}
          </Text>
          <Text style={styles.popupDate}>
            {cell.cell.visitCount} visits • {cell.cell.uniqueRouteCount} unique routes
          </Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.popupIconButton}
          accessibilityLabel="Close heatmap popup"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.popupStats}>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="fire" size={20} color={colors.chartOrange} />
          <Text style={styles.popupStatValue}>
            {Math.round(cell.cell.density * 100)}% density
          </Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="run" size={20} color={colors.chartBlue} />
          <Text style={styles.popupStatValue}>
            {cell.cell.activityIds.length} activities
          </Text>
        </View>
      </View>

      {cell.cell.routeRefs.length > 0 && (
        <View style={styles.heatmapRoutes}>
          <Text style={styles.heatmapRoutesTitle}>Routes:</Text>
          {cell.cell.routeRefs.slice(0, 3).map((ref, i) => (
            <Text key={i} style={styles.heatmapRouteItem} numberOfLines={1}>
              • {ref.name || ref.routeId} ({ref.activityCount}x)
            </Text>
          ))}
          {cell.cell.routeRefs.length > 3 && (
            <Text style={styles.heatmapRouteItem}>
              +{cell.cell.routeRefs.length - 3} more
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  popup: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: spacing.md,
    padding: spacing.md,
    ...shadows.modal,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: layout.cardMargin,
  },
  popupIconButton: {
    padding: spacing.xs,
  },
  popupInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  popupTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  popupDate: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  popupStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: layout.cardMargin,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: layout.cardMargin,
  },
  popupStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupStatValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  heatmapRoutes: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  heatmapRoutesTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  heatmapRouteItem: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textPrimary,
    marginBottom: 2,
  },
});
