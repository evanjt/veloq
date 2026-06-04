/**
 * Card component for displaying potential section suggestions.
 * Shows sections detected from 1-2 activity overlaps that users can promote.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { colors, typography, spacing, layout, shadows } from '@/theme';
import { getBoundsFromPoints, formatDistance } from '@/lib';
import { useMetricSystem } from '@/hooks';
import type { Section, RoutePoint } from '@/types';

interface PotentialSectionCardProps {
  /** The potential section to display */
  section: Section;
  /** Called when user wants to promote this to a full section */
  onPromote: () => void;
  /** Called when user dismisses this suggestion */
  onDismiss: () => void;
}

/**
 * Render a mini polyline preview
 */
function MiniPolylinePreview({ polyline }: { polyline: RoutePoint[] }) {
  const { svgPath, viewBox } = useMemo(() => {
    if (polyline.length < 2) {
      return { svgPath: '', viewBox: '0 0 60 40' };
    }

    // Calculate bounds using utility
    const mapBounds = getBoundsFromPoints(polyline);
    if (!mapBounds) {
      return { svgPath: '', viewBox: '0 0 60 40' };
    }

    // Extract min/max from MapLibre bounds format
    const [minLng, minLat] = mapBounds.sw;
    const [maxLng, maxLat] = mapBounds.ne;

    const width = 60;
    const height = 40;
    const padding = 4;

    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;

    // Normalize points to SVG coordinates
    const points = polyline
      .map((p) => {
        const x = padding + ((p.lng - minLng) / lngRange) * (width - padding * 2);
        const y = padding + ((maxLat - p.lat) / latRange) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(' ');

    return { svgPath: points, viewBox: `0 0 ${width} ${height}` };
  }, [polyline]);

  return (
    <Svg width={60} height={40} viewBox={viewBox}>
      <Polyline
        points={svgPath}
        fill="none"
        stroke={colors.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Card showing a potential section suggestion with promote/dismiss actions.
 */
export function PotentialSectionCard({ section, onPromote, onDismiss }: PotentialSectionCardProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const getScaleLabel = (scale: string | undefined): string => {
    if (!scale) return '';
    switch (scale) {
      case 'short':
        return t('routes.scaleShort' as never) as string;
      case 'medium':
        return t('routes.scaleMedium' as never) as string;
      case 'long':
        return t('routes.scaleLong' as never) as string;
      default:
        return scale;
    }
  };

  return (
    <View style={styles.card}>
      {/* Header with suggestion icon */}
      <View style={styles.header}>
        <View style={styles.suggestionBadge}>
          <MaterialCommunityIcons name="lightbulb-outline" size={14} color={colors.warning} />
          <Text style={styles.suggestionText}>{t('routes.suggestion' as never)}</Text>
        </View>
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Content row */}
      <View style={styles.content}>
        {/* Polyline preview */}
        <View style={styles.previewContainer}>
          <MiniPolylinePreview polyline={section.polyline} />
        </View>

        {/* Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.description}>
            {t('routes.potentialSectionDescription' as never, {
              sport: section.sportType.toLowerCase(),
              count: section.visitCount,
            })}
          </Text>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MaterialCommunityIcons
                name="map-marker-distance"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.metaText}>
                {formatDistance(section.distanceMeters, isMetric)}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <MaterialCommunityIcons name="ruler" size={14} color={colors.textSecondary} />
              <Text style={styles.metaText}>{getScaleLabel(section.scale)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Action button */}
      <TouchableOpacity style={styles.promoteButton} onPress={onPromote} activeOpacity={0.8}>
        <MaterialCommunityIcons name="plus-circle" size={18} color={colors.textOnDark} />
        <Text style={styles.promoteButtonText}>{t('routes.createSection')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning + '40',
    ...shadows.elevated,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  suggestionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warning + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius / 2,
  },
  suggestionText: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
  },
  dismissButton: {
    padding: spacing.xs,
  },
  content: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  previewContainer: {
    backgroundColor: colors.background,
    borderRadius: layout.borderRadius / 2,
    padding: spacing.xs,
  },
  infoContainer: {
    flex: 1,
  },
  description: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  highlight: {
    fontWeight: '700',
    color: colors.primary,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  promoteButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadius,
  },
  promoteButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textOnDark,
  },
});
