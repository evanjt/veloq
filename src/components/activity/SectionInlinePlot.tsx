import React, { memo, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, Pressable, Platform, Text as RNText } from 'react-native';
import { Text } from 'react-native-paper';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  brand,
  colors,
  darkColors,
  sectionPalette,
  sectionPaletteIndex,
  spacing,
  typography,
  layout,
} from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { formatDistance, formatPace } from '@/lib';
import { SectionSparkline } from '@/components/section/SectionSparkline';
import type { SectionEncounter } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';

interface SectionInlinePlotProps {
  encounter: SectionEncounter;
  activityId: string;
  index: number;
  style: { color: string };
  isHighlighted: boolean;
  isDark: boolean;
  isMetric: boolean;
  onPress: (sectionId: string) => void;
  onLongPress?: (sectionId: string) => void;
  onSwipeableOpen: (sectionId: string) => void;
  /** Report measured row layout for drag-scrub row detection */
  onRowLayout?: (sectionId: string, y: number, height: number) => void;
  /** Register/unregister this row's outer View so the parent can re-measure
   *  it on demand (outer-page scroll invalidates the cached pageY). */
  registerRowRef?: (sectionId: string, ref: View | null) => void;
  renderRightActions: (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => React.ReactNode;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
}

export const SectionInlinePlot = memo(
  function SectionInlinePlot({
    encounter,
    activityId,
    index,
    style,
    isHighlighted,
    isDark,
    isMetric,
    onPress,
    onLongPress,
    onSwipeableOpen,
    onRowLayout,
    registerRowRef,
    renderRightActions,
    swipeableRefs,
  }: SectionInlinePlotProps) {
    const { t } = useTranslation();

    const handleLongPress = useCallback(() => {
      onLongPress?.(encounter.sectionId);
    }, [onLongPress, encounter.sectionId]);

    const handlePress = useCallback(() => {
      onPress?.(encounter.sectionId);
    }, [onPress, encounter.sectionId]);

    // Color the row's index number using the same palette + hash as the map's
    // section portions, so row N visually matches the color of section N on the map.
    const numberColor = sectionPalette[sectionPaletteIndex(encounter.sectionId)];

    const swipeKey = `${encounter.sectionId}-${encounter.direction}`;
    const displayName =
      encounter.direction === 'reverse' ? `${encounter.sectionName} \u21A9` : encounter.sectionName;

    // Build sparkline-compatible data from encounter history
    const sparklineData = useMemo((): (PerformanceDataPoint & { x: number })[] | undefined => {
      if (encounter.historyTimes.length < 2) return undefined;
      return encounter.historyTimes.map((time, i) => ({
        x: i,
        id: encounter.historyActivityIds[i] || '',
        activityId: encounter.historyActivityIds[i] || '',
        speed: time > 0 ? encounter.distanceMeters / time : 0,
        date: new Date(),
        activityName: '',
        direction: encounter.direction as 'same' | 'reverse',
        sectionTime: time,
      }));
    }, [
      encounter.historyTimes,
      encounter.historyActivityIds,
      encounter.distanceMeters,
      encounter.direction,
    ]);

    // Report the row's absolute window-Y (not parent-relative y) so the parent
    // scrub gesture can map a finger pageY to a row directly.
    const rowRef = useRef<View>(null);
    const handleLayout = useCallback(
      (e: { nativeEvent: { layout: { y: number; height: number } } }) => {
        const { height } = e.nativeEvent.layout;
        rowRef.current?.measureInWindow?.((_x: number, pageY: number) => {
          onRowLayout?.(encounter.sectionId, pageY, height);
        });
      },
      [onRowLayout, encounter.sectionId]
    );

    return (
      <View
        ref={(r) => {
          rowRef.current = r;
          registerRowRef?.(encounter.sectionId, r);
        }}
        testID={`section-inline-plot-${index}`}
        onLayout={handleLayout}
      >
        <Swipeable
          ref={(ref) => {
            if (ref) {
              swipeableRefs.current.set(swipeKey, ref);
            } else {
              swipeableRefs.current.delete(swipeKey);
            }
          }}
          renderRightActions={renderRightActions}
          onSwipeableOpen={() => onSwipeableOpen(swipeKey)}
          overshootRight={false}
          friction={2}
        >
          <Pressable
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
            style={({ pressed }) => [
              styles.card,
              isDark && styles.cardDark,
              isHighlighted && styles.cardHighlighted,
              pressed && Platform.OS === 'ios' && { opacity: 0.7 },
            ]}
          >
            <View style={styles.header}>
              <Text style={[styles.numberLabel, { color: numberColor }]}>{index + 1}</Text>
              <View style={styles.headerInfo}>
                <Text style={[styles.name, isDark && styles.textLight]} numberOfLines={1}>
                  {displayName}
                </Text>
                <View style={styles.metaRow}>
                  <RNText style={[styles.meta, isDark && styles.textMuted]}>
                    {formatDistance(encounter.distanceMeters, isMetric)} · {encounter.visitCount}{' '}
                    {t('routes.visits')}
                    {encounter.lapTime > 0 && (
                      <>
                        <RNText style={[styles.meta, isDark && styles.textMuted]}> · </RNText>
                        <RNText style={[styles.timeValue, isDark && styles.textLight]}>
                          {formatPace(encounter.distanceMeters / encounter.lapTime, isMetric)}
                        </RNText>
                      </>
                    )}
                  </RNText>
                  {encounter.isPr && (
                    <MaterialCommunityIcons
                      testID={`section-inline-trophy-${index}`}
                      name="trophy"
                      size={11}
                      color={brand.gold}
                      style={{ marginLeft: 2 }}
                    />
                  )}
                </View>
              </View>
              {sparklineData && (
                <View testID={`section-inline-sparkline-${index}`}>
                  <SectionSparkline
                    data={sparklineData}
                    width={80}
                    height={28}
                    isDark={isDark}
                    highlightActivityId={activityId}
                  />
                </View>
              )}
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={isDark ? '#71717A' : '#CCC'}
              />
            </View>
          </Pressable>
        </Swipeable>
      </View>
    );
  },
  (prev, next) => {
    return (
      prev.isHighlighted === next.isHighlighted &&
      prev.encounter === next.encounter &&
      prev.isDark === next.isDark &&
      prev.activityId === next.activityId
    );
  }
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  cardHighlighted: {
    backgroundColor: '#00E5FF26',
    borderColor: '#00E5FF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  numberLabel: {
    width: 26,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  headerInfo: {
    flex: 1,
  },
  name: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  meta: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  timeValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
