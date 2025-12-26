/**
 * Route card component.
 * Shows a route group with map preview and stats.
 */

import React from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { colors, darkColors, opacity, spacing, layout, shadows, typography } from '@/theme';
import { formatDistance, formatRelativeDate, getActivityIcon, getActivityColor } from '@/lib';
import type { RouteGroup } from '@/types';

interface RouteCardProps {
  /** The route group to display */
  route: RouteGroup;
}

export function RouteCard({ route }: RouteCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const handlePress = () => {
    router.push(`/route/${route.id}` as Href);
  };

  const activityColor = getActivityColor(route.type);
  const iconName = getActivityIcon(route.type);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.pressable,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.card, isDark && styles.cardDark]}>
        {/* Colored accent bar */}
        <View style={[styles.accentBar, { backgroundColor: activityColor + '80' }]} />

        <View style={styles.content}>
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
            <MaterialCommunityIcons
              name={iconName}
              size={20}
              color="#FFFFFF"
            />
          </View>

          {/* Main info */}
          <View style={styles.mainInfo}>
            <Text
              style={[styles.routeName, isDark && styles.textLight]}
              numberOfLines={1}
            >
              {route.name}
            </Text>
            <Text style={[styles.subtitle, isDark && styles.subtitleDark]} numberOfLines={1}>
              {formatDistance(route.signature.distance)} · {route.activityCount} activities
            </Text>
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{route.activityCount}</Text>
            </View>
          </View>
        </View>

        {/* Bottom row with date range */}
        <View style={[styles.footer, isDark && styles.footerDark]}>
          <Text style={[styles.dateRange, isDark && styles.dateRangeDark]}>
            {formatRelativeDate(route.firstDate)} - {formatRelativeDate(route.lastDate)}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? '#555' : '#CCC'}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  card: {
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    // Platform-optimized shadow
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
    ...shadows.elevated,
  },
  accentBar: {
    height: 2,
    width: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  subtitle: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  subtitleDark: {
    color: darkColors.textMuted,
  },
  stats: {
    alignItems: 'flex-end',
  },
  countBadge: {
    backgroundColor: colors.primary + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
  },
  countText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
  },
  footerDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  dateRange: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  dateRangeDark: {
    color: darkColors.textSecondary,
  },
});
