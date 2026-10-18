/**
 * Section row: a section's polyline preview and its stats. It draws the polyline its page carries.
 */

import React, { memo, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  brand,
  colors,
  darkColors,
  iconSize,
  layout,
  opacity,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { SportIcons } from '@/shared/activity/SportIcons';
import { Card } from '@/shared/ui/Card';
import { TrackPreview, normaliseTrackPoints } from '@/shared/ui/TrackPreview';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { AccessibleAction } from '@/shared/ui/accessibleActions';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { sectionElevation } from '@/features/routes/lib/sectionElevation';
import type { Section } from '@/types';
import {
  ROW_PREVIEW_HEIGHT,
  ROW_PREVIEW_WIDTH,
  rowContainers,
} from '@/features/routes/lib/rowLayout';
import { NameText } from '@/shared/ui/NameText';
import { Icon } from '@/shared/ui/Icon';
import { Badge } from '@/shared/ui/Badge';

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

  const elevation = useMemo(() => sectionElevation(section), [section]);

  // The page the list reads carries every row's polyline, so a row draws what it
  // was given and reads nothing. Twelve mounted rows each fetching their own was
  // twelve synchronous reads and decodes in one microtask, on every sections
  // event. An empty one draws no preview rather than going to the engine for it.
  const polyline = section.polyline?.length ? section.polyline : undefined;

  const handlePress = useCallback(() => {
    onPress?.(section.id);
  }, [onPress, section.id]);

  // The section's own polyline only, not its activities' traces, so the
  // thumbnail is the section's geometry.
  const previewPoints = useMemo(() => normaliseTrackPoints(polyline ?? []), [polyline]);

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
    <View style={rowContainers.wrapper}>
      <Card
        variant="flat"
        padding="sm"
        style={rowContainers.card}
        testID={`section-row-${section.id}`}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        actions={actions}
      >
        <View style={rowContainers.previewBox} pointerEvents="none">
          {previewPoints.length > 1 ? (
            <TrackPreview points={previewPoints} isDark={isDark} />
          ) : (
            <View style={[styles.previewPlaceholder, isDark && styles.previewPlaceholderDark]}>
              {/* The section's own mark: the sports that took it are drawn beside the name. */}
              <Icon
                name="road-variant"
                size={iconSize.md}
                color={isDark ? darkColors.iconMuted : colors.iconMuted}
              />
            </View>
          )}
        </View>

        {/* Section info */}
        <View style={rowContainers.infoContainer}>
          <View style={rowContainers.nameRow}>
            <NameText style={[rowContainers.name, styles.sectionName, isDark && styles.textLight]}>
              {section.name}
            </NameText>
            {section.isUserDefined && section.sectionType === 'auto' ? (
              <Icon
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
                <Icon name="trophy" size={iconSize.xs} color={brand.gold} />
              </View>
            ) : null}
            {section.trend != null && section.trend !== 0 && (
              <View
                testID={`section-row-trend-${section.id}`}
                accessibilityRole="image"
                accessibilityLabel={trendWord ?? undefined}
                style={{ marginLeft: spacing.xs }}
              >
                <Icon
                  name={section.trend > 0 ? 'trending-up' : 'trending-down'}
                  size={iconSize.sm}
                  color={
                    section.trend > 0
                      ? isDark
                        ? darkColors.successText
                        : colors.successText
                      : isDark
                        ? darkColors.warningText
                        : colors.warningText
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
          <View style={rowContainers.metaRow}>
            <Text style={[rowContainers.metaText, styles.metaText, isDark && styles.textSecondary]}>
              {distanceText}
            </Text>
            {elevation ? (
              <View style={styles.gainChip}>
                <Icon
                  name={elevation.direction === 'loss' ? 'arrow-bottom-right' : 'arrow-top-right'}
                  size={iconSize.xs}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
                <Text
                  style={[rowContainers.metaText, styles.metaText, isDark && styles.textSecondary]}
                >
                  {elevationText}
                </Text>
              </View>
            ) : null}
            {proximityText ? (
              <View style={styles.proximityTag}>
                <Icon
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
              <Badge tone="neutral" text={t('routes.custom')} isDark={isDark} />
            )}
            {isDisabled ? (
              <Badge tone="warning" icon="eye-off" text={t('sections.disabled')} isDark={isDark} />
            ) : null}
          </View>
        </View>

        <View style={styles.countCell}>
          <Badge
            tone="count"
            icon="repeat"
            text={section.visitCount}
            label={countLabel}
            isDark={isDark}
            testID={`section-row-${section.id}-count`}
          />
          <Icon name="chevron-right" size={iconSize.sm} color={palette.iconSecondary} />
        </View>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
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
  sportIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  sectionName: {
    color: colors.textPrimary,
  },
  metaText: {
    color: colors.textSecondary,
  },
  countCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  textLight: {
    color: colors.textOnFill,
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
});
