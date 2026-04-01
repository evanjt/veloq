import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { navigateTo } from '@/lib';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, colorWithOpacity } from '@/theme';
import type { Insight, InsightCategory } from '@/types';

const ROTATION_INTERVAL = 8000;
const FADE_DURATION = 300;
const MAX_DISPLAY = 5;

/** Categories worth showing in a single-line home screen context */
const HOME_CATEGORIES: Set<InsightCategory> = new Set([
  'section_pr',
  'fitness_milestone',
  'section_cluster',
  'strength_progression',
  'strength_balance',
]);

const CATEGORY_COLORS: Record<string, string> = {
  section_pr: '#FFD700',
  fitness_milestone: '#4CAF50',
  period_comparison: '#2196F3',
  strength_progression: '#F97316',
  strength_balance: '#EF4444',
  hrv_trend: '#66BB6A',
  tsb_form: '#42A5F5',
  intensity_context: '#FFA726',
  stale_pr: '#FF9800',
  section_cluster: '#66BB6A',
};

interface InsightLineProps {
  insights: Insight[];
}

export const InsightLine = React.memo(function InsightLine({ insights }: InsightLineProps) {
  const { isDark } = useTheme();
  const opacity = useSharedValue(1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  // Only show PRs, patterns, milestones, and improving clusters; filter consecutive identical titles
  const displayInsights = useMemo(() => {
    const relevant = insights.filter((i) => {
      if (!HOME_CATEGORIES.has(i.category)) return false;
      // Only show improving clusters on home (declining feels negative)
      if (i.category === 'section_cluster' && !i.id.includes('improving')) return false;
      return true;
    });
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

  const handlePress = useCallback(() => {
    // Always navigate to insights tab — detail navigation happens from there
    navigateTo('/(tabs)/routes');
  }, []);

  if (displayInsights.length === 0) return null;

  const insight = displayInsights[currentIndex];
  if (!insight) return null;

  const categoryColor = CATEGORY_COLORS[insight.category] ?? colors.primary;
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;

  return (
    <View style={styles.wrapper}>
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
              { color: isDark ? darkColors.textSecondary : colors.textSecondary },
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
                      ? (CATEGORY_COLORS[displayInsights[i].category] ?? colors.primary)
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
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
    maxWidth: '100%',
  },
  title: {
    fontSize: 12,
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
