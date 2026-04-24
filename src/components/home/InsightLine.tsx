import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { navigateTo } from '@/lib';
import { useTheme } from '@/hooks';
import {
  colors,
  darkColors,
  spacing,
  layout,
  typography,
  colorWithOpacity,
  insightCategoryColors,
} from '@/theme';
import type { Insight, InsightCategory } from '@/types';

const ROTATION_INTERVAL = 8000;
const FADE_DURATION = 300;
const MAX_DISPLAY = 5;

/** Categories worth showing in a single-line home screen context */
const HOME_CATEGORIES: Set<InsightCategory> = new Set([
  'section_pr',
  'fitness_milestone',
  'strength_progression',
  'strength_balance',
]);

interface InsightLineProps {
  insights: Insight[];
}

export const InsightLine = React.memo(function InsightLine({ insights }: InsightLineProps) {
  const { isDark } = useTheme();
  const opacity = useSharedValue(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  // Only show PRs, milestones, and strength insights; filter consecutive identical titles
  const displayInsights = useMemo(() => {
    const relevant = insights.filter((i) => HOME_CATEGORIES.has(i.category));
    const sliced = relevant.slice(0, MAX_DISPLAY);
    return sliced.filter((insight, i) => i === 0 || insight.title !== sliced[i - 1].title);
  }, [insights]);

  // Reset index when the number of display insights changes to prevent out-of-bounds
  useEffect(() => {
    setCurrentIndex((prev) => (prev >= displayInsights.length ? 0 : prev));
  }, [displayInsights.length]);

  useEffect(() => {
    if (displayInsights.length <= 1) return;

    const interval = setInterval(() => {
      opacity.value = withTiming(0, { duration: FADE_DURATION });

      // After fade out, advance index on JS thread and fade in
      timeoutRef.current = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % displayInsights.length);
        opacity.value = withTiming(1, { duration: FADE_DURATION });
      }, FADE_DURATION);
    }, ROTATION_INTERVAL);

    return () => {
      clearInterval(interval);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [displayInsights.length, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  // Tapping the chip should land on the insights tab and surface the matching
  // insight in context (open its detail sheet). The insight's `navigationTarget`
  // is used by the detail sheet's "View in detail" link to drill into the
  // source (section/fitness/etc), but the chip itself always opens insights.
  const handlePress = useCallback(() => {
    const id = displayInsights[currentIndex]?.id;
    if (id) {
      navigateTo(`/(tabs)/routes?insightId=${encodeURIComponent(id)}`);
    } else {
      navigateTo('/(tabs)/routes');
    }
  }, [displayInsights, currentIndex]);

  if (displayInsights.length === 0) return null;

  const insight = displayInsights[currentIndex];
  if (!insight) return null;

  const categoryColor = insightCategoryColors[insight.category] ?? colors.primary;
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;

  return (
    <View testID="insight-line" style={styles.wrapper}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        <Animated.View
          style={[
            styles.pill,
            { backgroundColor: colorWithOpacity(categoryColor, 0.1) },
            animatedStyle,
          ]}
        >
          <MaterialCommunityIcons
            name={insight.icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={13}
            color={insight.iconColor}
          />
          <Text
            style={[
              styles.title,
              {
                color: isDark ? darkColors.textSecondary : colors.textSecondary,
              },
            ]}
            numberOfLines={1}
          >
            {insight.title}
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={10} color={mutedColor} />
        </Animated.View>
      </TouchableOpacity>

      {displayInsights.length > 1 ? (
        <View style={styles.dots}>
          {displayInsights.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === currentIndex
                      ? (insightCategoryColors[displayInsights[i].category] ?? colors.primary)
                      : isDark
                        ? darkColors.textMuted
                        : colors.textDisabled,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
    maxWidth: '100%',
  },
  title: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    flexShrink: 1,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: 3,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
});
