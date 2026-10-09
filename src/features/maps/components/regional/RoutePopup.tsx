import React, { memo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, typography, spacing, layout, shadows } from '@/theme';
import { Button, IconButton } from '@/shared/ui';

/** What the popup shows for a route, as the map read gives it. */
export interface MapRouteSummary {
  routeId: string;
  name: string;
  activityCount: number;
}

interface RoutePopupProps {
  route: MapRouteSummary;
  bottom: number;
  onClose: () => void;
  onViewDetails: () => void;
}

export const RoutePopup = memo(function RoutePopup({
  route,
  bottom,
  onClose,
  onViewDetails,
}: RoutePopupProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  // The engine names every route it draws; the id stands in only for a read
  // that found no name.
  const displayName = route.name || route.routeId;

  return (
    <View testID="route-popup" style={[styles.popup, isDark && styles.popupDark, { bottom }]}>
      <View style={styles.popupInfo}>
        <Text style={[styles.popupTitle, isDark && styles.popupTitleDark]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[styles.popupDetail, isDark && styles.popupDetailDark]}>
          {t('routes.activitiesCount', { count: route.activityCount })}
        </Text>
      </View>
      <Button
        testID="route-popup-view-details"
        onPress={onViewDetails}
        label={t('maps.viewRouteDetails')}
        variant="ghost"
        size="sm"
        icon={<MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />}
      />
      <IconButton
        testID="route-popup-close"
        onPress={onClose}
        variant="ghost"
        accessibilityLabel={t('maps.closeRoutePopup')}
      >
        <MaterialCommunityIcons
          name="close"
          size={22}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </IconButton>
    </View>
  );
});

const styles = StyleSheet.create({
  popup: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.modal,
  },
  popupDark: {
    backgroundColor: darkColors.surfaceCard,
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
  popupDetail: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  popupDetailDark: {
    color: darkColors.textSecondary,
  },
});
