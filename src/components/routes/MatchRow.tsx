/**
 * Row showing a discovered match between two activities.
 * Simple, stable component - no complex animations to avoid re-render issues.
 */

import React, { memo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { colors, spacing } from '@/theme';
import type { DiscoveredMatchInfo } from '@/types';

interface MatchRowProps {
  match: DiscoveredMatchInfo;
}

const RoutePreview = memo(function RoutePreview({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 2) return null;

  const width = 50;
  const height = 32;
  const padding = 3;

  const scaledPoints = points.map(p => ({
    x: p.x * (width - padding * 2) + padding,
    y: p.y * (height - padding * 2) + padding,
  }));

  const pointsString = scaledPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={pointsString}
        fill="none"
        stroke={colors.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
});

function MatchRowComponent({ match }: MatchRowProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const getTypeIcon = (): 'bike' | 'run' | 'swim' | 'walk' | 'map-marker' => {
    const t = match.type?.toLowerCase() || '';
    if (t.includes('ride') || t.includes('cycling')) return 'bike';
    if (t.includes('run')) return 'run';
    if (t.includes('swim')) return 'swim';
    if (t.includes('walk') || t.includes('hike')) return 'walk';
    return 'map-marker';
  };

  const formatDistance = (meters?: number) => {
    if (!meters) return '';
    return `${(meters / 1000).toFixed(1)}km`;
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Route preview or icon */}
      <View style={[styles.previewBox, isDark && styles.previewBoxDark]}>
        {match.previewPoints && match.previewPoints.length > 1 ? (
          <RoutePreview points={match.previewPoints} />
        ) : (
          <MaterialCommunityIcons
            name={getTypeIcon()}
            size={18}
            color={isDark ? '#555' : '#BBB'}
          />
        )}
      </View>

      {/* Match info */}
      <View style={styles.infoContainer}>
        <View style={styles.namesRow}>
          <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
            {match.activity1.name}
          </Text>
          <MaterialCommunityIcons
            name="arrow-left-right"
            size={12}
            color={colors.primary}
            style={styles.matchIcon}
          />
          <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
            {match.activity2.name}
          </Text>
        </View>
        <View style={styles.metaRow}>
          {match.distance && match.distance > 0 && (
            <Text style={[styles.metaText, isDark && styles.textMuted]}>
              {formatDistance(match.distance)}
            </Text>
          )}
          <Text style={[styles.matchPercent, { color: colors.success }]}>
            {Math.round(match.matchPercentage)}% match
          </Text>
        </View>
      </View>

      {/* Check icon */}
      <View style={styles.checkIcon}>
        <MaterialCommunityIcons
          name="check-circle"
          size={18}
          color={colors.success}
        />
      </View>
    </View>
  );
}

// Memoize - only re-render if match ID changes
export const MatchRow = memo(MatchRowComponent, (prevProps, nextProps) => {
  return prevProps.match.id === nextProps.match.id;
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  containerDark: {
    backgroundColor: '#1A1A1A',
  },
  previewBox: {
    width: 50,
    height: 32,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  previewBoxDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
  },
  namesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityName: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  matchIcon: {
    marginHorizontal: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.sm,
  },
  metaText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  matchPercent: {
    fontSize: 11,
    fontWeight: '600',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#777',
  },
  checkIcon: {
    width: 24,
    alignItems: 'center',
  },
});
