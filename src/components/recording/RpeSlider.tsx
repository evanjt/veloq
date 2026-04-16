import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, typography } from '@/theme';

type RpeLabelKey = 'easy' | 'moderate' | 'hard' | 'veryHard' | 'max';

function getRpeLabelKey(value: number): RpeLabelKey {
  if (value <= 2) return 'easy';
  if (value <= 4) return 'moderate';
  if (value <= 6) return 'hard';
  if (value <= 8) return 'veryHard';
  return 'max';
}

function getRpeColor(value: number): string {
  if (value <= 2) return '#22C55E';
  if (value <= 4) return '#84CC16';
  if (value <= 6) return '#EAB308';
  if (value <= 8) return '#F97316';
  return '#EF4444';
}

interface RpeSliderProps {
  value: number;
  onValueChange: (value: number) => void;
  textSecondary: string;
}

function RpeSliderInner({ value, onValueChange, textSecondary }: RpeSliderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const trackWidth = useRef(0);
  const animValue = useRef(new Animated.Value(value)).current;
  const currentRef = useRef(value);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (trackWidth.current <= 0) return;
        const x = e.nativeEvent.locationX;
        const val = Math.max(1, Math.min(10, Math.round((x / trackWidth.current) * 9) + 1));
        animValue.setValue(val);
        currentRef.current = val;
      },
      onPanResponderMove: (e) => {
        if (trackWidth.current <= 0) return;
        const x = e.nativeEvent.locationX;
        const val = Math.max(1, Math.min(10, Math.round((x / trackWidth.current) * 9) + 1));
        animValue.setValue(val);
        currentRef.current = val;
      },
      onPanResponderRelease: () => {
        onValueChange(currentRef.current);
      },
    })
  ).current;

  const handleLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    trackWidth.current = e.nativeEvent.layout.width;
  }, []);

  return (
    <View testID="review-rpe" style={styles.rpeSection}>
      <View style={styles.rpeHeader}>
        <Text style={[styles.label, { color: textSecondary }]}>{t('recording.rpe', 'RPE')}</Text>
        <Text style={[styles.rpeValue, { color: getRpeColor(value) }]}>
          {value} — {t(`recording.rpeLabels.${getRpeLabelKey(value)}`)}
        </Text>
      </View>
      <Text style={[styles.rpeDescription, { color: textSecondary }]}>
        {t('recording.rpeDescription', '1 = effortless, 10 = maximum effort')}
      </Text>
      <View
        style={[
          styles.rpeTrack,
          { backgroundColor: isDark ? darkColors.surfaceElevated : colors.backgroundAlt },
        ]}
        onLayout={handleLayout}
        {...pan.panHandlers}
      >
        {/* Filled portion -- driven by Animated.Value for smooth drag */}
        <Animated.View
          style={[
            styles.rpeFill,
            {
              width: animValue.interpolate({
                inputRange: [1, 10],
                outputRange: ['0%', '100%'],
              }),
              backgroundColor: getRpeColor(value),
            },
          ]}
        />
        {/* Thumb -- driven by Animated.Value for smooth drag */}
        <Animated.View
          style={[
            styles.rpeThumb,
            {
              left: animValue.interpolate({
                inputRange: [1, 10],
                outputRange: ['0%', '100%'],
              }),
              backgroundColor: getRpeColor(value),
            },
          ]}
        />
      </View>
      {/* Scale labels */}
      <View style={styles.rpeScaleRow}>
        <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>1</Text>
        <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>5</Text>
        <Text style={[styles.rpeScaleLabel, { color: textSecondary }]}>10</Text>
      </View>
    </View>
  );
}

export const RpeSlider = React.memo(RpeSliderInner);

const styles = StyleSheet.create({
  rpeSection: {
    marginTop: spacing.lg,
  },
  rpeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    ...typography.label,
  },
  rpeValue: {
    ...typography.bodyBold,
  },
  rpeDescription: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  rpeTrack: {
    height: 32,
    borderRadius: 16,
    position: 'relative',
    justifyContent: 'center',
  },
  rpeFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 16,
    opacity: 0.3,
  },
  rpeThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: -14,
    top: 2,
  },
  rpeScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  rpeScaleLabel: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
