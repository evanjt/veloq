import React, { memo } from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useMetricSystem, useTheme } from '@/shared/app';
import { formatDistance } from '@/shared/format/format';
import { colors, darkColors, typography, spacing, layout, shadows } from '@/theme';
import { SportIcons } from '@/shared/activity/SportIcons';
import type { FrequentSection } from '@/types';
import { pressable, pressRipple } from '@/shared/ui';

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
  const isMetric = useMetricSystem();

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
            {formatDistance(section.distanceMeters, isMetric)}
          </Text>
        </View>
        {onViewDetails && (
          <Pressable
            testID="section-popup-view-details"
            onPress={onViewDetails}
            style={pressable(styles.viewDetailsInline)}
            android_ripple={pressRipple}
            accessibilityLabel={t('maps.viewSectionDetails')}
            accessibilityRole="button"
          >
            <Text style={[styles.viewDetailsText, isDark && { color: darkColors.linkTeal }]}>
              {t('maps.viewDetails')}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
          </Pressable>
        )}
        <Pressable
          testID="section-popup-close"
          onPress={onClose}
          style={pressable(styles.popupIconButton)}
          android_ripple={pressRipple}
          accessibilityLabel={t('maps.closeSectionPopup')}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons
            name="close"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      </View>

      <View style={[styles.popupStats, isDark && styles.popupStatsDark]}>
        {/* Every sport that has taken the ground, in one colour: none is the section's. */}
        <View style={styles.popupStat}>
          <SportIcons
            sportTypes={section.sportTypes}
            size={20}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
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
    borderRadius: layout.borderRadius,
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
    marginBottom: spacing.xsPlus,
  },
  popupIconButton: {
    padding: spacing.xs,
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
    marginTop: spacing.xxs,
  },
  popupDateDark: {
    color: darkColors.textSecondary,
  },
  popupStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xsPlus,
  },
  popupStatsDark: {},
  popupStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xs,
  },
  viewDetailsText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.linkTeal,
  },
});
