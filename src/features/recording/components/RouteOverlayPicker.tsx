import React from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Modal } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme, useMetricSystem } from '@/shared/app';
import { formatDistance } from '@/shared/format/format';
// Deep imports keep the routes barrel (and its map components) out of the
// recording module graph.
import { useRouteGroups } from '@/features/routes/hooks/useRouteGroups';
import { colors, darkColors, brand, spacing, layout, typography, opacity } from '@/theme';
import type { ActivityType } from '@/types';

interface RouteOverlayPickerProps {
  visible: boolean;
  activityType: ActivityType;
  selectedRouteId: string | null;
  onSelect: (routeId: string | null) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet picker of saved routes to overlay on the live recording map.
 * Lists route groups for the current sport; "no route" clears the overlay.
 */
export function RouteOverlayPicker({
  visible,
  activityType,
  selectedRouteId,
  onSelect,
  onClose,
}: RouteOverlayPickerProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { groups } = useRouteGroups({ type: activityType, minActivities: 2, sortBy: 'recent' });

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: textPrimary }]}>
              {t('recording.routeOverlay.title', 'Follow a route')}
            </Text>
            <TouchableOpacity
              testID="route-overlay-close"
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', 'Close')}
            >
              <MaterialCommunityIcons name="close" size={22} color={textSecondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            testID="route-overlay-none"
            style={[styles.row, { borderBottomColor: border }]}
            onPress={() => {
              onSelect(null);
              onClose();
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="close-circle-outline"
              size={20}
              color={selectedRouteId == null ? brand.teal : textSecondary}
            />
            <Text
              style={[
                styles.rowTitle,
                { color: selectedRouteId == null ? brand.teal : textPrimary },
              ]}
            >
              {t('recording.routeOverlay.none', 'No route')}
            </Text>
          </TouchableOpacity>

          {groups.length === 0 ? (
            <Text style={[styles.emptyHint, { color: textSecondary }]}>
              {t('recording.routeOverlay.empty', 'No saved routes for this sport yet.')}
            </Text>
          ) : (
            <FlatList
              testID="route-overlay-list"
              data={groups}
              keyExtractor={(g) => g.id}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedRouteId;
                return (
                  <TouchableOpacity
                    testID={`route-overlay-option-${item.id}`}
                    style={[styles.row, { borderBottomColor: border }]}
                    onPress={() => {
                      onSelect(item.id);
                      onClose();
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name="map-marker-path"
                      size={20}
                      color={isSelected ? brand.teal : textSecondary}
                    />
                    <View style={styles.rowBody}>
                      <Text
                        style={[styles.rowTitle, { color: isSelected ? brand.teal : textPrimary }]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <Text style={[styles.rowMeta, { color: textSecondary }]}>
                        {item.signature?.distance
                          ? `${formatDistance(item.signature.distance, isMetric)} · `
                          : ''}
                        {t('recording.routeOverlay.activities', { count: item.activityCount })}
                      </Text>
                    </View>
                    {isSelected && (
                      <MaterialCommunityIcons name="check" size={20} color={brand.teal} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: opacity.overlay.heavy,
  },
  sheet: {
    maxHeight: '65%',
    borderTopLeftRadius: layout.borderRadiusLg,
    borderTopRightRadius: layout.borderRadiusLg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    ...typography.sectionTitle,
  },
  closeButton: {
    width: layout.minTapTarget,
    height: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: layout.minTapTarget,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 1,
  },
  emptyHint: {
    ...typography.bodySmall,
    fontStyle: 'italic',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
