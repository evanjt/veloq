import React, { useEffect, useRef, useCallback } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { router, Href } from 'expo-router';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { Insight } from '@/types';

const ROTATION_INTERVAL = 8000;
const FADE_DURATION = 300;
const MAX_DISPLAY = 3;

interface InsightLineProps {
  insights: Insight[];
}

export const InsightLine = React.memo(function InsightLine({ insights }: InsightLineProps) {
  const { isDark } = useTheme();
  const opacity = useSharedValue(1);
  const indexRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const displayInsights = insights.slice(0, MAX_DISPLAY);

  useEffect(() => {
    if (displayInsights.length <= 1) return;

    const interval = setInterval(() => {
      opacity.value = withTiming(0, { duration: FADE_DURATION }, (finished) => {
        if (finished) {
          indexRef.current = (indexRef.current + 1) % displayInsights.length;
        }
      });

      // After fade out, update displayed index and fade in
      timeoutRef.current = setTimeout(() => {
        setCurrentIndex(indexRef.current);
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
    const insight = displayInsights[currentIndex];
    if (insight) {
      router.push((insight.navigationTarget ?? '/routes') as Href);
    }
  }, [displayInsights, currentIndex]);

  if (displayInsights.length === 0) return null;

  const insight = displayInsights[currentIndex];
  if (!insight) return null;

  return (
    <TouchableOpacity style={styles.container} onPress={handlePress} activeOpacity={0.7}>
      <Animated.View style={[styles.content, animatedStyle]}>
        <MaterialCommunityIcons
          name={insight.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={13}
          color={insight.iconColor}
          style={styles.icon}
        />
        <Text
          style={[styles.text, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
          numberOfLines={1}
        >
          {insight.title}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    maxWidth: '45%',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    flexShrink: 1,
  },
});
