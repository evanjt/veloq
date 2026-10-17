/**
 * Section row: a section's polyline preview and its stats. It draws the polyline its page carries.
 */

import React, { memo, useCallback, useMemo, useId } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Polyline, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import {
  brand,
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  mapPreviewColors,
  opacity,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { SportIcons } from '@/shared/activity/SportIcons';
import { Card } from '@/shared/ui/Card';
import { TrackEndpointMarkers } from '@/shared/ui/TrackEndpointMarkers';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { AccessibleAction } from '@/shared/ui/accessibleActions';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { getBoundsFromPoints } from '@/shared/geo/polyline';
import { sectionElevation } from '@/features/routes/lib/sectionElevation';
import type { Section } from '@/types';
import {
  ROW_MARGIN_BOTTOM,
  ROW_MARGIN_HORIZONTAL,
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
} from '@/features/routes/lib/rowLayout';
import { NameText } from '@/shared/ui/NameText';

interface SectionRowProps {
  section: Section;
  /** Whether this section is disabled/hidden */
  isDisabled?: boolean | undefined;
  /** Distance from user's current location in meters */
  distanceFromUser?: number | undefined;
  onPress?: ((id: string) => void) | undefined;
  /** What a swipe over the row does, offered to a screen reader on the row itself. */
  actions?: readonly AccessibleAction[] | undefined;
}

const PREVIEW_WIDTH = ROW_PREVIEW_WIDTH;
const PREVIEW_HEIGHT = ROW_PREVIEW_HEIGHT;
const PREVIEW_PADDING = 4;

export const SectionRow = memo(function SectionRow({
  section,
  isDisabled,
  distanceFromUser,
  onPress,
  actions,
}: SectionRowProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const isMetric = useMetricSystem();
  // Unique ID for SVG gradient to avoid collisions between multiple instances
  const uniqueId = useId();
  const gradientId = `sectionGradient-${uniqueId}`;

  const elevation = useMemo(() => sectionElevation(section), [section]);

  // The page the list reads carries every row's polyline, so a row draws what it
  // was given and reads nothing. Twelve mounted rows each fetching their own was
  // twelve synchronous reads and decodes in one microtask, on every sections
  // event. An empty one draws no preview rather than going to the engine for it.
  const polyline = section.polyline?.length ? section.polyline : undefined;

  const handlePress = useCallback(() => {
    onPress?.(section.id);
  }, [onPress, section.id]);

  // Compute bounds from section polyline only (not activity traces)
  // This ensures the thumbnail accurately represents the section geometry
  const bounds = useMemo(() => {
    if (!polyline?.length) return null;

    // Use utility for bounds calculation
    const mapBounds = getBoundsFromPoints(polyline);
    if (!mapBounds) return null;

    // Extract min/max from MapLibre bounds format
    const [minLng, minLat] = mapBounds.sw;
    const [maxLng, maxLat] = mapBounds.ne;

    // Calculate range for SVG normalisation
    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;
    const range = Math.max(latRange, lngRange);

    return { minLat, maxLat, minLng, maxLng, range };
  }, [polyline]);

  // Normalise point to SVG coordinates
  const normalisePoint = useCallback(
    (lat: number, lng: number): { x: number; y: number } => {
      if (!bounds) return { x: 0, y: 0 };
      return {
        x:
          PREVIEW_PADDING +
          ((lng - bounds.minLng) / bounds.range) * (PREVIEW_WIDTH - 2 * PREVIEW_PADDING),
        y:
          PREVIEW_PADDING +
          (1 - (lat - bounds.minLat) / bounds.range) * (PREVIEW_HEIGHT - 2 * PREVIEW_PADDING),
      };
    },
    [bounds]
  );

  // Normalise section polyline
  const sectionPolylineString = useMemo(() => {
    if (!polyline?.length || !bounds) return '';
    return polyline
      .map((p) => {
        const { x, y } = normalisePoint(p.lat, p.lng);
        return `${x},${y}`;
      })
      .join(' ');
  }, [polyline, bounds, normalisePoint]);

  const hasSectionPolyline = sectionPolylineString.length > 0;

  // The app's own colour: ground has no sport to colour it by.
  const activityColor = palette.primary;

  // Background colors for map-like appearance
  const preview = isDark ? mapPreviewColors.dark : mapPreviewColors.light;
  const bgColor = preview.bg;
  const gridColor = preview.grid;

  // Get start/end points for markers
  const polylinePoints = useMemo(() => {
    if (!polyline?.length || !bounds) return null;
    const normalised = polyline.map((p) => normalisePoint(p.lat, p.lng));
    return {
      start: normalised[0],
      end: normalised[normalised.length - 1],
    };
  }, [polyline, bounds, normalisePoint]);

  const distanceText = formatDistance(section.distanceMeters, isMetric);
  const elevationText = elevation ? formatElevation(elevation.metres, isMetric) : null;
  const proximityText =
    distanceFromUser != null && Number.isFinite(distanceFromUser)
      ? formatDistance(distanceFromUser, isMetric)
      : null;
  const countLabel = t('sections.traversalsCount', { count: section.visitCount });
  // The trend badge is drawn only for a non-zero trend, so only that is spoken,
  // in the words the badge itself carries.
  const trendWord =
    section.trend != null && section.trend !== 0
      ? t(section.trend > 0 ? 'sections.trendingFaster' : 'sections.trendingSlower')
      : null;
  // The row is one element: on iOS the badges inside it are unreachable, so
  // their text is read here. An unnamed section draws no name and speaks none.
  const accessibilityLabel = composeAccessibilityLabel(
    section.name,
    distanceText,
    elevationText &&
      `${t(elevation?.direction === 'loss' ? 'a11y.elevationLoss' : 'sections.elevationGain')} ${elevationText}`,
    proximityText,
    section.sectionType === 'custom' && t('routes.custom'),
    isDisabled && t('sections.disabled'),
    section.latestIsRecord && t('sections.latestIsRecord'),
    trendWord,
    countLabel
  );

  return (
    <View style={styles.wrapper}>
      <Card
        variant="flat"
        padding="sm"
        style={{ flexDirection: 'row', alignItems: 'center' }}
        testID={`section-row-${section.id}`}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        actions={actions}
      >
        {/* Section polyline preview with map-like backdrop */}
        <View style={styles.previewBox} pointerEvents="none">
          {hasSectionPolyline ? (
            <Svg width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
              <Defs>
                <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={bgColor} stopOpacity="1" />
                  <Stop offset="1" stopColor={preview.bgBottom} stopOpacity="1" />
                </LinearGradient>
              </Defs>

              {/* Map-like background */}
              <Rect
                x="0"
                y="0"
                width={PREVIEW_WIDTH}
                height={PREVIEW_HEIGHT}
                fill={`url(#${gradientId})`}
                rx="4"
              />

              {/* Subtle grid lines for map effect */}
              <Polyline
                points={`${PREVIEW_WIDTH / 3},0 ${PREVIEW_WIDTH / 3},${PREVIEW_HEIGHT}`}
                stroke={gridColor}
                strokeWidth={0.5}
                strokeOpacity={0.5}
              />
              <Polyline
                points={`${(2 * PREVIEW_WIDTH) / 3},0 ${(2 * PREVIEW_WIDTH) / 3},${PREVIEW_HEIGHT}`}
                stroke={gridColor}
                strokeWidth={0.5}
                strokeOpacity={0.5}
              />
              <Polyline
                points={`0,${PREVIEW_HEIGHT / 2} ${PREVIEW_WIDTH},${PREVIEW_HEIGHT / 2}`}
                stroke={gridColor}
                strokeWidth={0.5}
                strokeOpacity={0.5}
              />

              {/* Route shadow for depth */}
              <Polyline
                points={sectionPolylineString}
                fill="none"
                stroke={ink.black}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={0.15}
                transform="translate(0.5, 0.5)"
              />

              {/* Section polyline on top */}
              <Polyline
                points={sectionPolylineString}
                fill="none"
                stroke={activityColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {polylinePoints ? (
                <TrackEndpointMarkers start={polylinePoints.start} end={polylinePoints.end} />
              ) : null}
            </Svg>
          ) : (
            <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
              {/* The section's own mark: the sports that took it are drawn beside the name. */}
              <MaterialCommunityIcons
                name="road-variant"
                size={iconSize.md}
                color={isDark ? darkColors.iconFaint : colors.iconFaint}
              />
            </View>
          )}
        </View>

        {/* Section info */}
        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <NameText style={[styles.sectionName, isDark && styles.textLight]}>
              {section.name}
            </NameText>
            {section.isUserDefined && section.sectionType === 'auto' ? (
              <MaterialCommunityIcons
                name="pin"
                size={iconSize.xs}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
                style={{ marginLeft: spacing.xs }}
              />
            ) : null}
            {section.latestIsRecord ? (
              // A View rather than the icon alone: the icon does not carry an
              // accessibility label through, and a trophy says nothing by itself.
              <View
                testID={`section-row-record-${section.id}`}
                accessibilityRole="image"
                accessibilityLabel={t('sections.latestIsRecord')}
                style={{ marginLeft: spacing.xs }}
              >
                <MaterialCommunityIcons name="trophy" size={iconSize.xs} color={brand.gold} />
              </View>
            ) : null}
            {section.trend != null && section.trend !== 0 && (
              <View
                testID={`section-row-trend-${section.id}`}
                accessibilityRole="image"
                accessibilityLabel={trendWord ?? undefined}
                style={{ marginLeft: spacing.xs }}
              >
                <MaterialCommunityIcons
                  name={section.trend > 0 ? 'trending-up' : 'trending-down'}
                  size={iconSize.sm}
                  color={
                    section.trend > 0
                      ? isDark
                        ? darkColors.successDeep
                        : colors.successDeep
                      : isDark
                        ? darkColors.amberIcon
                        : colors.amberIcon
                  }
                />
              </View>
            )}
            {/* Every sport that has taken the ground, in one colour: none is the section's. */}
            <View style={styles.sportIconsRow}>
              <SportIcons
                sportTypes={section.sportTypes}
                size={iconSize.xs}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, isDark && styles.textSecondary]}>{distanceText}</Text>
            {elevation ? (
              <View style={styles.gainChip}>
                <MaterialCommunityIcons
                  name={elevation.direction === 'loss' ? 'arrow-bottom-right' : 'arrow-top-right'}
                  size={iconSize.xs}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.metaText, isDark && styles.textSecondary]}>
                  {elevationText}
                </Text>
              </View>
            ) : null}
            {proximityText ? (
              <View style={styles.proximityTag}>
                <MaterialCommunityIcons
                  name="map-marker-distance"
                  size={iconSize.xs}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text style={[styles.proximityText, isDark && styles.proximityTextDark]}>
                  {proximityText}
                </Text>
              </View>
            ) : null}
            {section.sectionType === 'custom' && (
              <View style={[styles.customTag, isDark && styles.customTagDark]}>
                <Text style={[styles.customTagText, isDark && styles.customTagTextDark]}>
                  {t('routes.custom')}
                </Text>
              </View>
            )}
            {isDisabled ? (
              <View style={[styles.disabledTag, isDark && styles.disabledTagDark]}>
                <MaterialCommunityIcons
                  name="eye-off"
                  size={iconSize.xs}
                  color={isDark ? darkColors.amberIcon : colors.amberIcon}
                />
                <Text style={[styles.disabledTagText, isDark && styles.disabledTagTextDark]}>
                  {t('sections.disabled')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Visit count badge */}
        <View
          style={[styles.countBadge, { backgroundColor: palette.primary }]}
          accessible
          accessibilityLabel={countLabel}
          testID={`section-row-${section.id}-count`}
        >
          <MaterialCommunityIcons
            name="repeat"
            size={iconSize.sm}
            color={colors.textOnPrimary}
            testID={`section-row-${section.id}-count-glyph`}
          />
          <Text style={styles.countText}>{section.visitCount}</Text>
          <MaterialCommunityIcons name="chevron-right" size={iconSize.sm} color={ink.white} />
        </View>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: ROW_MARGIN_HORIZONTAL,
    marginBottom: ROW_MARGIN_BOTTOM,
  },
  previewBox: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
  },
  previewPlaceholder: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: layout.borderRadiusXs,
    backgroundColor: opacity.overlay.subtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewPlaceholderDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  infoContainer: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sportIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  sectionName: {
    ...typography.bodyCompactBold,
    flexShrink: 1,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xxs,
    gap: spacing.sm,
  },
  metaText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    gap: spacing.xxs,
  },
  countText: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  gainChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  proximityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  proximityText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  proximityTextDark: {
    color: darkColors.textSecondary,
  },
  customTag: {
    backgroundColor: colorWithOpacity(colors.chartPurple, opacity.tint2),
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
  },
  customTagDark: {
    backgroundColor: colorWithOpacity(darkColors.chartPurple, 0.15),
  },
  customTagText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.chartPurpleText,
  },
  customTagTextDark: {
    color: darkColors.chartPurpleText,
  },
  disabledTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colorWithOpacity(colors.amberIcon, opacity.tint2),
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
  },
  disabledTagDark: {
    backgroundColor: colorWithOpacity(darkColors.amberIcon, 0.15),
  },
  disabledTagText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.amberIcon,
  },
  disabledTagTextDark: {
    color: darkColors.amberIcon,
  },
});
