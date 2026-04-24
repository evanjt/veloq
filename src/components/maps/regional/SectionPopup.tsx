import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, typography, spacing, shadows } from '@/theme';
import { getActivityTypeConfig } from '../ActivityTypeFilter';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import type { FrequentSection } from '@/types';

interface SectionPopupProps {
  section: FrequentSection;
  bottom: number;
  onClose: () => void;
  onViewDetails?: () => void;
}

export const SectionPopup = memo(function SectionPopup({
  section,
  bottom,
  onClose,
  onViewDetails,
}: SectionPopupProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const config = getActivityTypeConfig(section.sportType);

  // Names are stored in Rust (user-set or auto-generated on creation/migration)
  const displayName = section.name ?? section.id;

  return (
    <View testID="section-popup" style={[styles.popup, isDark && styles.popupDark, { bottom }]}>
      <View style={styles.popupHeader}>
        <View style={styles.popupInfo}>
          <Text style={[styles.popupTitle, isDark && styles.popupTitleDark]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.popupDate, isDark && styles.popupDateDark]}>
            {t('sections.visitsCount', { count: section.visitCount })} •{' '}
            {Math.round(section.distanceMeters)}
            {t('units.m')}
          </Text>
        </View>
        {onViewDetails && (
          <TouchableOpacity
            testID="section-popup-view-details"
            onPress={onViewDetails}
            style={styles.viewDetailsInline}
            accessibilityLabel={t('maps.viewSectionDetails')}
            accessibilityRole="button"
          >
            <Text style={styles.viewDetailsText}>{t('maps.viewDetails')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          testID="section-popup-close"
          onPress={onClose}
          style={styles.popupIconButton}
          accessibilityLabel={t('maps.closeSectionPopup')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="close"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      <View style={[styles.popupStats, isDark && styles.popupStatsDark]}>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons
            name={getActivityIcon(section.sportType)}
            size={20}
            color={config.color}
          />
          <Text style={[styles.popupStatValue, isDark && styles.popupStatValueDark]}>
            {section.sportType}
          </Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="run" size={20} color={colors.chartBlue} />
          <Text style={[styles.popupStatValue, isDark && styles.popupStatValueDark]}>
            {t('sections.activitiesCount', { count: section.activityIds.length })}
          </Text>
        </View>
        <View style={styles.popupStat}>
          <MaterialCommunityIcons name="map-marker-path" size={20} color={colors.chartAmber} />
          <Text style={[styles.popupStatValue, isDark && styles.popupStatValueDark]}>
            {t('sections.routesCountLabel', { count: section.routeIds?.length ?? 0 })}
          </Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  popup: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.modal,
  },
  popupDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  popupIconButton: {
    padding: 4,
  },
  popupInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  popupTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  popupTitleDark: {
    color: darkColors.textPrimary,
  },
  popupDate: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  popupDateDark: {
    color: darkColors.textSecondary,
  },
  popupStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
  },
  popupStatsDark: {},
  popupStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  popupStatValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  popupStatValueDark: {
    color: darkColors.textPrimary,
  },
  viewDetailsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  viewDetailsText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});
