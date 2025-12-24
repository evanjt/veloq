/**
 * Route card component.
 * Shows a route group with map preview and stats.
 */

import React from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { colors, spacing, layout } from '@/theme';
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
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: '#1A1A1A',
    shadowOpacity: 0.2,
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
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  subtitleDark: {
    color: '#888',
  },
  stats: {
    alignItems: 'flex-end',
  },
  countBadge: {
    backgroundColor: colors.primary + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
  },
  countText: {
    fontSize: 14,
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
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  footerDark: {
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  dateRange: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  dateRangeDark: {
    color: '#666',
  },
});
