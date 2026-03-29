import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import { findNearestMuscle } from '@/lib/strength/muscleHitRegions';

const LOUPE_SIZE = 90;
const LOUPE_OFFSET_Y = -100;
const LOUPE_SCALE = 2.5;
const LONG_PRESS_MS = 200;

interface BodyPairWithLoupeProps {
  data: ReadonlyArray<ExtendedBodyPart>;
  gender: 'male' | 'female';
  scale: number;
  colors: ReadonlyArray<string>;
  defaultFill?: string;
  onMuscleTap?: (slug: string) => void;
  onMuscleScrub?: (slug: string) => void;
  tappableSlugs?: Set<string>;
}

/**
 * Renders front + back body diagrams side by side with a single unified
 * gesture handler, so the loupe scrub can go seamlessly from front to back.
 */
export const BodyPairWithLoupe = React.memo(function BodyPairWithLoupe({
  data,
  gender,
  scale,
  colors,
  defaultFill,
  onMuscleTap,
  onMuscleScrub,
  tappableSlugs,
}: BodyPairWithLoupeProps) {
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

  const scrubCallback = onMuscleScrub ?? onMuscleTap;

  // Determine which side (front/back) based on X position, then find nearest muscle
  const handleScrubUpdate = useCallback(
    (x: number, y: number) => {
      if (!layoutSize || !tappableSlugs || tappableSlugs.size === 0 || !scrubCallback) return;
      const halfW = layoutSize.width / 2;
      const side: 'front' | 'back' = x < halfW ? 'front' : 'back';
      const localX = side === 'front' ? x : x - halfW;
      const slug = findNearestMuscle(localX, y, halfW, layoutSize.height, side, tappableSlugs);
      if (slug && slug !== lastScrubSlug.current) {
        lastScrubSlug.current = slug;
        scrubCallback(slug);
      }
    },
    [layoutSize, tappableSlugs, scrubCallback]
  );

  const handleScrubEnd = useCallback(() => {
    lastScrubSlug.current = null;
  }, []);

  // Quick tap — find nearest muscle and call onMuscleTap
  const handleTap = useCallback(
    (x: number, y: number) => {
      if (!layoutSize || !tappableSlugs || tappableSlugs.size === 0 || !onMuscleTap) return;
      const halfW = layoutSize.width / 2;
      const side: 'front' | 'back' = x < halfW ? 'front' : 'back';
      const localX = side === 'front' ? x : x - halfW;
      const slug = findNearestMuscle(localX, y, halfW, layoutSize.height, side, tappableSlugs);
      if (slug) onMuscleTap(slug);
    },
    [layoutSize, tappableSlugs, onMuscleTap]
  );

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      'worklet';
      runOnJS(handleTap)(e.x, e.y);
    })
    .enabled(!!(onMuscleTap && tappableSlugs && tappableSlugs.size > 0));

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart((e) => {
      'worklet';
      loupeX.value = e.x;
      loupeY.value = e.y;
      loupeOpacity.value = withTiming(1, { duration: 100 });
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onUpdate((e) => {
      'worklet';
      loupeX.value = e.x;
      loupeY.value = e.y;
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onEnd(() => {
      'worklet';
      loupeOpacity.value = withTiming(0, { duration: 150 });
      runOnJS(handleScrubEnd)();
    })
    .enabled(!!(scrubCallback && tappableSlugs && tappableSlugs.size > 0));

  // Tap fires immediately, pan fires after long press — they don't conflict
  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  const loupeStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: loupeOpacity.value,
      transform: [
        { translateX: loupeX.value - LOUPE_SIZE / 2 },
        { translateY: loupeY.value + LOUPE_OFFSET_Y },
      ],
    };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View>
        <View onLayout={handleLayout} style={styles.row}>
          <View style={styles.bodyView}>
            <Body
              data={data}
              gender={gender}
              side="front"
              scale={scale}
              colors={colors}
              defaultFill={defaultFill}
            />
          </View>
          <View style={styles.bodyView}>
            <Body
              data={data}
              gender={gender}
              side="back"
              scale={scale}
              colors={colors}
              defaultFill={defaultFill}
            />
          </View>

          {/* Loupe */}
          <Animated.View style={[styles.loupeContainer, loupeStyle]} pointerEvents="none">
            <View style={styles.loupeClip}>
              <View style={styles.loupeCrosshair} />
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  bodyView: {
    flex: 1,
    alignItems: 'center',
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
    backgroundColor: 'rgba(128,128,128,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loupeCrosshair: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#fff',
  },
});
