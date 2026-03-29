import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import {
  FRONT_POSITIONS,
  BACK_POSITIONS,
  TAP_TARGET_RADIUS,
  findNearestMuscle,
} from '@/lib/strength/muscleHitRegions';

const LOUPE_SIZE = 90;
const LOUPE_OFFSET_Y = -100; // Above the finger
const LOUPE_SCALE = 2.5;
const LONG_PRESS_MS = 200;

interface TappableBodyProps {
  data: ReadonlyArray<ExtendedBodyPart>;
  gender: 'male' | 'female';
  side: 'front' | 'back';
  scale: number;
  colors: ReadonlyArray<string>;
  /** Quick tap — parent typically toggles selection */
  onMuscleTap?: (slug: string) => void;
  /** Scrub during long-press drag — parent sets selection directly (no toggle) */
  onMuscleScrub?: (slug: string) => void;
  tappableSlugs?: Set<string>;
  /** Currently selected muscle slug — shows a highlight ring */
  selectedSlug?: string | null;
}

/**
 * Body diagram with two interaction modes:
 * 1. Quick tap on a muscle → selects it immediately
 * 2. Long-press + drag → shows magnifying loupe, scrubs across muscles in real time
 */
export const TappableBody = React.memo(function TappableBody({
  data,
  gender,
  side,
  scale,
  colors,
  onMuscleTap,
  onMuscleScrub,
  tappableSlugs,
  selectedSlug,
}: TappableBodyProps) {
  const [layoutSize, setLayoutSize] = useState<{ width: number; height: number } | null>(null);
  const lastScrubSlug = useRef<string | null>(null);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      setLayoutSize({
        width: e.nativeEvent.layout.width,
        height: e.nativeEvent.layout.height,
      });
    },
    []
  );

  // Enhance body data with selection stroke on the selected muscle
  const enhancedData = useMemo(() => {
    if (!selectedSlug) return data;
    return data.map((part) =>
      part.slug === selectedSlug
        ? { ...part, styles: { stroke: '#1A1A1A', strokeWidth: 2.5 } }
        : part
    );
  }, [data, selectedSlug]);

  // Shared values for loupe
  const loupeX = useSharedValue(0);
  const loupeY = useSharedValue(0);
  const loupeOpacity = useSharedValue(0);
  // Body offset inside loupe (to center the touch point in the magnified view)
  const bodyOffsetX = useSharedValue(0);
  const bodyOffsetY = useSharedValue(0);

  const positions = side === 'front' ? FRONT_POSITIONS : BACK_POSITIONS;

  // JS callback for muscle detection during scrub
  const scrubCallback = onMuscleScrub ?? onMuscleTap;

  const handleScrubUpdate = useCallback(
    (x: number, y: number) => {
      if (!layoutSize || !tappableSlugs || tappableSlugs.size === 0 || !scrubCallback) return;
      const slug = findNearestMuscle(
        x,
        y,
        layoutSize.width,
        layoutSize.height,
        side,
        tappableSlugs
      );
      if (slug && slug !== lastScrubSlug.current) {
        lastScrubSlug.current = slug;
        scrubCallback(slug);
      }
    },
    [layoutSize, tappableSlugs, side, scrubCallback]
  );

  const handleScrubEnd = useCallback(() => {
    lastScrubSlug.current = null;
  }, []);

  // Long-press + pan gesture for loupe scrubbing
  const scrubGesture = Gesture.Pan()
    .minDistance(0)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart((e) => {
      'worklet';
      loupeX.value = e.x;
      loupeY.value = e.y;
      if (layoutSize) {
        bodyOffsetX.value = -e.x * LOUPE_SCALE + LOUPE_SIZE / 2;
        bodyOffsetY.value = -e.y * LOUPE_SCALE + LOUPE_SIZE / 2;
      }
      loupeOpacity.value = withTiming(1, { duration: 100 });
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onUpdate((e) => {
      'worklet';
      loupeX.value = e.x;
      loupeY.value = e.y;
      if (layoutSize) {
        bodyOffsetX.value = -e.x * LOUPE_SCALE + LOUPE_SIZE / 2;
        bodyOffsetY.value = -e.y * LOUPE_SCALE + LOUPE_SIZE / 2;
      }
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onEnd(() => {
      'worklet';
      loupeOpacity.value = withTiming(0, { duration: 150 });
      runOnJS(handleScrubEnd)();
    })
    .enabled(!!(scrubCallback && tappableSlugs && tappableSlugs.size > 0));

  // Loupe container style (positioned above finger)
  const loupeContainerStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: loupeOpacity.value,
      transform: [
        { translateX: loupeX.value - LOUPE_SIZE / 2 },
        { translateY: loupeY.value + LOUPE_OFFSET_Y },
      ],
    };
  });

  // Magnified body offset inside loupe
  const loupeBodyStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [
        { translateX: bodyOffsetX.value },
        { translateY: bodyOffsetY.value },
        { scale: LOUPE_SCALE },
      ],
    };
  });

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <GestureDetector gesture={scrubGesture}>
        <Animated.View>
          <Body data={enhancedData} gender={gender} side={side} scale={scale} colors={colors} />
        </Animated.View>
      </GestureDetector>

      {/* Tap targets + selection ring */}
      {layoutSize && tappableSlugs && tappableSlugs.size > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.tapOverlay]} pointerEvents="box-none">
          {Object.entries(positions).map(([slug, regions]) => {
            if (!tappableSlugs.has(slug)) return null;
            return regions.map((pos, idx) => {
              const left = pos.x * layoutSize.width - TAP_TARGET_RADIUS;
              const top = pos.y * layoutSize.height - TAP_TARGET_RADIUS;
              return (
                <Pressable
                  key={`${slug}-${idx}`}
                  style={[
                    styles.tapTarget,
                    {
                      left,
                      top,
                      width: TAP_TARGET_RADIUS * 2,
                      height: TAP_TARGET_RADIUS * 2,
                      borderRadius: TAP_TARGET_RADIUS,
                    },
                  ]}
                  onPress={() => onMuscleTap?.(slug)}
                />
              );
            });
          })}
        </View>
      )}

      {/* Magnifying loupe */}
      <Animated.View style={[styles.loupeContainer, loupeContainerStyle]} pointerEvents="none">
        <View style={styles.loupeClip}>
          <Animated.View style={[styles.loupeBody, loupeBodyStyle]}>
            <Body data={enhancedData} gender={gender} side={side} scale={scale} colors={colors} />
          </Animated.View>
          {/* Center crosshair dot */}
          <View style={styles.loupeCrosshair} />
        </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  tapOverlay: {
    zIndex: 10,
  },
  tapTarget: {
    position: 'absolute',
  },
  loupeContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: LOUPE_SIZE,
    height: LOUPE_SIZE,
    zIndex: 20,
  },
  loupeClip: {
    width: LOUPE_SIZE,
    height: LOUPE_SIZE,
    borderRadius: LOUPE_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FC4C02',
    backgroundColor: '#F0F0F0',
  },
  loupeBody: {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: 'top left',
  },
  loupeCrosshair: {
    position: 'absolute',
    top: LOUPE_SIZE / 2 - 3,
    left: LOUPE_SIZE / 2 - 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#fff',
  },
});
