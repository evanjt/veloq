import React, { memo, type ReactNode, type RefObject } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, typography, spacing, layout, shadows } from '@/theme';
import { Button, IconButton } from '@/shared/ui';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The size every stat glyph is drawn at */
export const MAP_POPUP_STAT_ICON_SIZE = 20;

export interface MapPopupStat {
  key: string;
  /** A glyph name, drawn in the neutral ink every stat shares */
  icon?: IconName;
  /** Drawn instead of `icon` when the stat needs more than one glyph */
  renderIcon?: (color: string) => ReactNode;
  value?: string;
}

export interface MapPopupAction {
  testID: string;
  onPress: () => void;
}

interface MapPopupProps {
  testID: string;
  titleTestID: string;
  closeTestID: string;
  titleRef: RefObject<Text | null>;
  title: string;
  subtitle?: string;
  stats: MapPopupStat[];
  closeLabel: string;
  onClose: () => void;
  viewDetails?: MapPopupAction | undefined;
  zoom?: (MapPopupAction & { label: string }) | undefined;
  /** Placement and any entry animation the caller runs */
  style?: StyleProp<ViewStyle>;
  /** The host view, an `Animated.View` when the caller animates the entry */
  container?: React.ComponentType<React.ComponentProps<typeof View>>;
}

/**
 * The card the regional map shows for a tapped activity, section or route: a
 * title, a subtitle, a row of stats and the same actions in the same order.
 */
export const MapPopup = memo(function MapPopup({
  testID,
  titleTestID,
  closeTestID,
  titleRef,
  title,
  subtitle,
  stats,
  closeLabel,
  onClose,
  viewDetails,
  zoom,
  style,
  container: Container = View,
}: MapPopupProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const ink = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Container
      testID={testID}
      style={[styles.popup, isDark && styles.popupDark, style]}
      pointerEvents="auto"
    >
      <View style={styles.header}>
        <View style={styles.info}>
          <Text
            ref={titleRef}
            testID={titleTestID}
            style={[styles.title, isDark && styles.titleDark]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]}>{subtitle}</Text>
          ) : null}
        </View>
        {viewDetails ? (
          <Button
            testID={viewDetails.testID}
            onPress={viewDetails.onPress}
            label={t('maps.viewDetails')}
            variant="ghost"
            size="sm"
            icon={<MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />}
          />
        ) : null}
        {zoom ? (
          <IconButton
            testID={zoom.testID}
            onPress={zoom.onPress}
            variant="ghost"
            accessibilityLabel={zoom.label}
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.primary} />
          </IconButton>
        ) : null}
        <IconButton
          testID={closeTestID}
          onPress={onClose}
          variant="ghost"
          accessibilityLabel={closeLabel}
        >
          <MaterialCommunityIcons name="close" size={22} color={ink} />
        </IconButton>
      </View>

      <View testID="map-popup-stats" style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.key} style={styles.stat}>
            {stat.renderIcon
              ? stat.renderIcon(ink)
              : stat.icon && (
                  <MaterialCommunityIcons
                    name={stat.icon}
                    size={MAP_POPUP_STAT_ICON_SIZE}
                    color={ink}
                  />
                )}
            {stat.value !== undefined && (
              <Text style={[styles.statValue, isDark && styles.statValueDark]}>{stat.value}</Text>
            )}
          </View>
        ))}
      </View>
    </Container>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xsPlus,
  },
  info: {
    flex: 1,
    marginRight: spacing.sm,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  subtitle: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  subtitleDark: {
    color: darkColors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xsPlus,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statValueDark: {
    color: darkColors.textPrimary,
  },
});
