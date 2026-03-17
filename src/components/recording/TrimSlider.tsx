import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
import { formatDuration } from '@/lib';

const HANDLE_WIDTH = 28;
const HANDLE_HEIGHT = 48;
const TRACK_HEIGHT = 6;
const MIN_SELECTION = 0.05; // 5% minimum

interface TrimSliderProps {
  totalDuration: number;
  totalPoints: number;
  onTrimChange: (startIdx: number, endIdx: number) => void;
  startIdx: number;
  endIdx: number;
}

export function TrimSlider({
  totalDuration,
  totalPoints,
  onTrimChange,
  startIdx,
  endIdx,
}: TrimSliderProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const trackWidthRef = useRef(0);

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const trackBg = isDark ? darkColors.surfaceElevated : colors.backgroundAlt;
  const handleBg = isDark ? darkColors.surface : colors.surface;

  const startFraction = totalPoints > 1 ? startIdx / (totalPoints - 1) : 0;
  const endFraction = totalPoints > 1 ? endIdx / (totalPoints - 1) : 1;

  const startTime = totalDuration * startFraction;
  const endTime = totalDuration * endFraction;

  // Store current values in refs so PanResponder closures always read fresh state
  const startFracRef = useRef(startFraction);
  const endFracRef = useRef(endFraction);
  const startIdxRef = useRef(startIdx);
  const endIdxRef = useRef(endIdx);
  const totalPointsRef = useRef(totalPoints);
  const onTrimChangeRef = useRef(onTrimChange);
  useEffect(() => {
    startFracRef.current = startFraction;
  }, [startFraction]);
  useEffect(() => {
    endFracRef.current = endFraction;
  }, [endFraction]);
  useEffect(() => {
    startIdxRef.current = startIdx;
  }, [startIdx]);
  useEffect(() => {
    endIdxRef.current = endIdx;
  }, [endIdx]);
  useEffect(() => {
    totalPointsRef.current = totalPoints;
  }, [totalPoints]);
  useEffect(() => {
    onTrimChangeRef.current = onTrimChange;
  }, [onTrimChange]);

  const startPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (trackWidthRef.current <= 0) return;
        const delta = gesture.dx / trackWidthRef.current;
        const raw = startFracRef.current + delta;
        const clamped = Math.max(0, Math.min(raw, endFracRef.current - MIN_SELECTION));
        const idx = Math.round(clamped * (totalPointsRef.current - 1));
        onTrimChangeRef.current(idx, endIdxRef.current);
      },
    })
  ).current;

  const endPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (trackWidthRef.current <= 0) return;
        const delta = gesture.dx / trackWidthRef.current;
        const raw = endFracRef.current + delta;
        const clamped = Math.max(startFracRef.current + MIN_SELECTION, Math.min(1, raw));
        const idx = Math.round(clamped * (totalPointsRef.current - 1));
        onTrimChangeRef.current(startIdxRef.current, idx);
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: textPrimary }]}>
        {t('recording.trimActivity', 'Trim Activity')}
      </Text>

      {/* Time labels */}
      <View style={styles.timeRow}>
        <Text style={[styles.timeLabel, { color: textSecondary }]}>
          {formatDuration(startTime)}
        </Text>
        <Text style={[styles.timeLabel, { color: textSecondary }]}>{formatDuration(endTime)}</Text>
      </View>

      {/* Track */}
      <View
        style={[styles.track, { backgroundColor: trackBg }]}
        onLayout={(e) => {
          trackWidthRef.current = e.nativeEvent.layout.width;
        }}
      >
        {/* Active range */}
        <View
          style={[
            styles.activeRange,
            {
              left: `${startFraction * 100}%` as `${number}%`,
              right: `${(1 - endFraction) * 100}%` as `${number}%`,
              backgroundColor: brand.teal,
            },
          ]}
        />

        {/* Start handle */}
        <View
          style={[
            styles.handle,
            {
              left: `${startFraction * 100}%` as `${number}%`,
              backgroundColor: handleBg,
              borderColor: brand.teal,
            },
          ]}
          {...startPan.panHandlers}
        >
          <View style={[styles.handleBar, { backgroundColor: brand.teal }]} />
        </View>

        {/* End handle */}
        <View
          style={[
            styles.handle,
            {
              left: `${endFraction * 100}%` as `${number}%`,
              backgroundColor: handleBg,
              borderColor: brand.teal,
            },
          ]}
          {...endPan.panHandlers}
        >
          <View style={[styles.handleBar, { backgroundColor: brand.teal }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  timeLabel: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    marginVertical: HANDLE_HEIGHT / 2 - TRACK_HEIGHT / 2,
    position: 'relative',
  },
  activeRange: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
    opacity: 0.6,
  },
  handle: {
    position: 'absolute',
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: 4,
    borderWidth: 2,
    marginLeft: -HANDLE_WIDTH / 2,
    top: -(HANDLE_HEIGHT - TRACK_HEIGHT) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleBar: {
    width: 4,
    height: 24,
    borderRadius: 2,
  },
});
