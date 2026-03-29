import React, { useState, useCallback, useRef } from 'react';
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
const LOUPE_OFFSET_Y = -100;
const LOUPE_SCALE = 2.5;
const LONG_PRESS_MS = 200;

interface TappableBodyProps {
  data: ReadonlyArray<ExtendedBodyPart>;
  gender: 'male' | 'female';
  side: 'front' | 'back';
  scale: number;
  colors: ReadonlyArray<string>;
  onMuscleTap?: (slug: string) => void;
  onMuscleScrub?: (slug: string) => void;
  tappableSlugs?: Set<string>;
  /** Fill color for non-highlighted body parts */
  defaultFill?: string;
}

/**
 * Body diagram with tap and long-press loupe scrub.
 *
 * IMPORTANT: This component does NOT accept selectedSlug to avoid
 * re-rendering the expensive Body SVG on every selection change.
 * Selection highlighting is handled by the parent.
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
  defaultFill,
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

  const loupeX = useSharedValue(0);
  const loupeY = useSharedValue(0);
  const loupeOpacity = useSharedValue(0);
  const bodyOffsetX = useSharedValue(0);
  const bodyOffsetY = useSharedValue(0);

  const positions = side === 'front' ? FRONT_POSITIONS : BACK_POSITIONS;
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
          <Body
            data={data}
            gender={gender}
            side={side}
            scale={scale}
            colors={colors}
            defaultFill={defaultFill}
          />
        </Animated.View>
      </GestureDetector>

      {/* Tap targets */}
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
            <Body
              data={data}
              gender={gender}
              side={side}
              scale={scale}
              colors={colors}
              defaultFill={defaultFill}
            />
          </Animated.View>
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
