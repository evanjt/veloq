import React, { memo, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Platform,
  Text as RNText,
  type LayoutChangeEvent,
} from 'react-native';
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
  onSwipeableOpen: (sectionId: string) => void;
  /** Report the outer row's measured height so the parent can compute
   *  finger-Y → row-index arithmetically instead of querying per-row layouts. */
  onRowHeight?: (height: number) => void;
  /** Expose the first row's outer View ref to the parent. Only row 0 needs
   *  to be measured — subsequent rows' positions are pure arithmetic. */
  firstRowRef?: (ref: View | null) => void;
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
    onSwipeableOpen,
    onRowHeight,
    firstRowRef,
    renderRightActions,
    swipeableRefs,
  }: SectionInlinePlotProps) {
    const { t } = useTranslation();

    const handlePress = useCallback(() => {
      onPress?.(encounter.sectionId);
    }, [onPress, encounter.sectionId]);

    // Color the row's index number using the same palette + hash as the map's
    // section portions, so row N visually matches the color of section N on the map.
    const numberColor = sectionPalette[sectionPaletteIndex(encounter.sectionId)];

    // A single section can match in both directions, so `sectionId` alone
    // isn't unique per row. Use the same composite key as FlatList's keyExtractor.
    const swipeKey = `${encounter.sectionId}-${encounter.direction}`;
    const displayName =
      encounter.direction === 'reverse' ? `${encounter.sectionName} ↩` : encounter.sectionName;

    // Build sparkline-compatible data from encounter history.
    // Show a window of up to 5 points centered on the current activity
    // (2 before + current + 2 after). If the current activity is near the
    // start/end of the history, shift the window so 5 points still render.
    // If the current activity isn't in the history, fall back to the last 5.
    const sparklineData = useMemo((): (PerformanceDataPoint & { x: number })[] | undefined => {
      const total = encounter.historyTimes.length;
      if (total < 2) return undefined;

      const WINDOW_SIZE = 5;
      let startIdx = 0;
      let endIdx = total;

      if (total > WINDOW_SIZE) {
        const currentIdx = encounter.historyActivityIds.indexOf(activityId);
        if (currentIdx === -1) {
          startIdx = total - WINDOW_SIZE;
          endIdx = total;
        } else {
          const half = Math.floor(WINDOW_SIZE / 2);
          startIdx = currentIdx - half;
          endIdx = currentIdx + half + 1;
          if (startIdx < 0) {
            endIdx += -startIdx;
            startIdx = 0;
          }
          if (endIdx > total) {
            startIdx -= endIdx - total;
            endIdx = total;
          }
          if (startIdx < 0) startIdx = 0;
        }
      }

      const out: (PerformanceDataPoint & { x: number })[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        const time = encounter.historyTimes[i];
        out.push({
          x: i - startIdx,
          id: encounter.historyActivityIds[i] || '',
          activityId: encounter.historyActivityIds[i] || '',
          speed: time > 0 ? encounter.distanceMeters / time : 0,
          date: new Date(),
          activityName: '',
          direction: encounter.direction as 'same' | 'reverse',
          sectionTime: time,
        });
      }
      return out;
    }, [
      encounter.historyTimes,
      encounter.historyActivityIds,
      encounter.distanceMeters,
      encounter.direction,
      activityId,
    ]);

    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        onRowHeight?.(e.nativeEvent.layout.height);
      },
      [onRowHeight]
    );

    // Only row 0's ref is forwarded to the parent — it's the anchor point the
    // scrub hit-test measures at gesture start. Other rows don't need refs.
    const ownRef = useRef<View | null>(null);
    const handleRef = useCallback(
      (r: View | null) => {
        ownRef.current = r;
        if (index === 0) firstRowRef?.(r);
      },
      [firstRowRef, index]
    );

    return (
      <View ref={handleRef} testID={`section-inline-plot-${index}`} onLayout={handleLayout}>
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
