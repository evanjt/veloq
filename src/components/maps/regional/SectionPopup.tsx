import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { shadows } from '@/theme/shadows';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { FrequentSection } from '@/types';

interface SectionPopupProps {
  section: FrequentSection;
  bottom: number;
  onClose: () => void;
  onViewDetails?: () => void;
}

export function SectionPopup({ section, bottom, onClose, onViewDetails }: SectionPopupProps) {
  const { t } = useTranslation();
  const config = getActivityTypeConfig(section.sportType);

  // Get custom name from Rust engine (single source of truth)
  const displayName = useMemo(() => {
    const engine = getRouteEngine();
    const customName = engine?.getSectionName(section.id);
    if (customName) return customName;
    if (section.name) return section.name;
    return t('sections.defaultName', { number: section.id.slice(-6) }) as string;
  }, [section.id, section.name, t]);

  return (
    <View testID="section-popup" style={[styles.popup, { bottom }]}>
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={styles.popupTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.popupDate}>
            {section.visitCount} visits • {Math.round(section.distanceMeters)}m
          </Text>
        </View>
        <TouchableOpacity
          testID="section-popup-close"
          onPress={onClose}
          style={styles.popupIconButton}
          accessibilityLabel="Close section popup"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.popupStats}>
        <View style={styles.popupStat}>
          <Ionicons name={config.icon} size={20} color={config.color} />
          <Text style={styles.popupStatValue}>{section.sportType}</Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="run" size={20} color={colors.chartBlue} />
          <Text style={styles.popupStatValue}>{section.activityIds.length} activities</Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="map-marker-path" size={20} color={colors.chartAmber} />
          <Text style={styles.popupStatValue}>{section.routeIds.length} routes</Text>
        </View>
      </View>

      {onViewDetails && (
        <TouchableOpacity
          testID="section-popup-view-details"
          onPress={onViewDetails}
          style={styles.viewDetailsButton}
          accessibilityLabel="View section details"
          accessibilityRole="button"
        >
          <Text style={styles.viewDetailsText}>{t('maps.viewDetails')}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
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
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    gap: 4,
  },
  viewDetailsText: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});
