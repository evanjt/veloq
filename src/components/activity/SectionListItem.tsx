import React, { memo, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, typography, opacity, layout } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { formatDistance } from '@/lib';
import { SectionMiniPreview } from '@/components/routes';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';

interface SectionListItemProps {
  item: UnifiedSectionItem;
  sectionId: string;
  isCustom: boolean;
  sectionType: string;
  sectionName: string;
  sectionTime: number | undefined;
  distance: number;
  visitCount: number;
  bestTime: number | undefined;
  delta: { text: string; isAhead: boolean } | null;
  style: { color: string };
  index: number;
  isHighlighted: boolean;
  isDark: boolean;
  isMetric: boolean;
  isScrubbing: boolean;
  onLongPress: (sectionId: string) => void;
  onLayout: (y: number, height: number) => void;
  onPress: (sectionId: string) => void;
  onSwipeableOpen: (sectionId: string) => void;
  renderRightActions: (progress: any, dragX: any) => React.ReactNode;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
  formatSectionTime: (seconds: number) => string;
  formatSectionPace: (seconds: number, meters: number) => string;
}

type UnifiedSectionItem =
  | { type: 'engine'; match: SectionMatch; index: number }
  | { type: 'custom'; section: any; index: number };

export const SectionListItem = memo(
  function SectionListItem({
    sectionId,
    isCustom,
    sectionType,
    sectionName,
    sectionTime,
    distance,
    visitCount,
    bestTime,
    delta,
    style,
    index,
    isHighlighted,
    isDark,
    isMetric,
    isScrubbing,
    item,
    onLongPress,
    onLayout,
    onPress,
    onSwipeableOpen,
    renderRightActions,
    swipeableRefs,
    formatSectionTime,
    formatSectionPace,
  }: SectionListItemProps) {
    const { t } = useTranslation();
    const containerRef = useRef<View>(null);

    const handleLayout = useCallback(() => {
      containerRef.current?.measureInWindow((x, y, width, height) => {
        onLayout(y, height);
      });
    }, [onLayout]);

    const handleLongPress = useCallback(() => {
      // Long press initiates scrubbing mode
      onLongPress?.(sectionId);
    }, [onLongPress, sectionId]);

    const handlePress = useCallback(() => {
      // Only navigate if not scrubbing
      if (!isScrubbing) {
        onPress?.(sectionId);
      }
    }, [onPress, sectionId, isScrubbing]);

    return (
      <View ref={containerRef} onLayout={handleLayout}>
        <Swipeable
          ref={(ref) => {
            swipeableRefs.current.set(sectionId, ref);
          }}
          renderRightActions={renderRightActions}
          onSwipeableOpen={() => onSwipeableOpen(sectionId)}
          overshootRight={false}
          friction={2}
        >
          <Pressable
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
            style={({ pressed }) => [
              styles.sectionCard,
              isDark && styles.cardDark,
              isHighlighted && styles.sectionCardHighlighted,
              pressed && Platform.OS === 'ios' && !isScrubbing && { opacity: 0.7 },
            ]}
          >
            <View style={styles.sectionCardContent}>
              {/* Numbered badge matching map marker */}
              <View style={[styles.sectionNumberBadge, { borderColor: style.color }]}>
                <Text style={styles.sectionNumberBadgeText}>{index + 1}</Text>
              </View>

              {/* Mini trace preview */}
              <View style={styles.sectionPreviewBox}>
                <SectionMiniPreview
                  sectionId={sectionId}
                  polyline={isCustom && item.type === 'custom' ? item.section.polyline : undefined}
                  color={style.color}
                  width={56}
                  height={40}
                  isDark={isDark}
                />
              </View>

              {/* Section info */}
              <View style={styles.sectionInfo}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionName, isDark && styles.textLight]} numberOfLines={1}>
                    {sectionName}
                  </Text>
                  <View
                    style={[
                      sectionType === 'custom' ? styles.customBadge : styles.autoDetectedBadge,
                      isDark &&
                        (sectionType === 'custom'
                          ? styles.customBadgeDark
                          : styles.autoDetectedBadgeDark),
                    ]}
                  >
                    <Text
                      style={
                        sectionType === 'custom' ? styles.customBadgeText : styles.autoDetectedText
                      }
                    >
                      {sectionType === 'custom' ? t('routes.custom') : t('routes.autoDetected')}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.sectionMeta, isDark && styles.textMuted]}>
                  {formatDistance(distance, isMetric)} · {visitCount} {t('routes.visits')}
                </Text>
                {sectionTime != null && (
                  <View style={styles.sectionTimeRow}>
                    <Text style={[styles.sectionTime, isDark && styles.textLight]}>
                      {formatSectionTime(sectionTime)} · {formatSectionPace(sectionTime, distance)}
                    </Text>
                    {delta && (
                      <Text
                        style={[
                          styles.sectionDelta,
                          delta.isAhead ? styles.deltaAhead : styles.deltaBehind,
                        ]}
                      >
                        {delta.text}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        </Swipeable>
      </View>
    );
  },
  (prev, next) => {
    // Custom memo comparator: only re-render if highlight state or data changes
    return (
      prev.isHighlighted === next.isHighlighted &&
      prev.isScrubbing === next.isScrubbing &&
      prev.item === next.item &&
      prev.bestTime === next.bestTime &&
      prev.sectionTime === next.sectionTime &&
      prev.delta === next.delta &&
      prev.isDark === next.isDark
    );
  }
);

const styles = StyleSheet.create({
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
    // Add transparent border so dimensions stay constant when highlighted
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  sectionCardHighlighted: {
    backgroundColor: colors.chartGold + '26', // ~15% opacity
    borderColor: colors.chartGold,
    // borderWidth already set in base style
  },
  sectionCardContent: {
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  sectionNumberBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionPreviewBox: {
    marginRight: spacing.sm,
  },
  sectionInfo: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  sectionName: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.xs,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  customBadge: {
    backgroundColor: colors.primary + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadgeDark: {
    backgroundColor: darkColors.primary + '33',
  },
  customBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  autoDetectedBadge: {
    backgroundColor: colors.chartCyan + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  autoDetectedBadgeDark: {
    backgroundColor: colors.chartCyan + '33', // chartCyan not in darkColors, use light version
  },
  autoDetectedText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.chartCyan,
  },
  sectionMeta: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  sectionTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTime: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionDelta: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
  deltaAhead: {
    color: colors.success,
  },
  deltaBehind: {
    color: colors.error,
  },
});
