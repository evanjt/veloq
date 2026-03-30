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

// Body component intrinsic dimensions (from react-native-body-highlighter source)
const BODY_INTRINSIC_W = 200;
const BODY_INTRINSIC_H = 400;

interface BodyPairWithLoupeProps {
  data: ReadonlyArray<ExtendedBodyPart>;
  gender: 'male' | 'female';
  scale: number;
  colors: ReadonlyArray<string>;
  defaultFill?: string;
  onMuscleTap?: (slug: string) => void;
  onMuscleScrub?: (slug: string) => void;
  tappableSlugs?: Set<string>;
  gap?: number;
  centerContent?: React.ReactNode;
  centerWidth?: number;
}

export const BodyPairWithLoupe = React.memo(function BodyPairWithLoupe({
  data,
  gender,
  scale,
  colors,
  defaultFill,
  onMuscleTap,
  onMuscleScrub,
  tappableSlugs,
  gap = 0,
  centerContent,
  centerWidth = 0,
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
  const loupeSide = useSharedValue(0);
  const bodyOffsetX = useSharedValue(0);
  const bodyOffsetY = useSharedValue(0);

  const scrubCallback = onMuscleScrub ?? onMuscleTap;

  // Sizes
  const totalGap = gap + centerWidth;
  const bodyPixelW = BODY_INTRINSIC_W * scale;
  const bodyPixelH = BODY_INTRINSIC_H * scale;
  // The loupe renders the body at a larger scale directly (no CSS transform)
  const loupeScale = scale * LOUPE_SCALE;

  const handleScrubUpdate = useCallback(
    (x: number, y: number) => {
      if (!layoutSize || !tappableSlugs || tappableSlugs.size === 0 || !scrubCallback) return;
      const bodyW = (layoutSize.width - totalGap) / 2;
      const midpoint = bodyW + totalGap / 2;
      const side: 'front' | 'back' = x < midpoint ? 'front' : 'back';
      const localX = side === 'front' ? x : x - bodyW - totalGap;
      const slug = findNearestMuscle(localX, y, bodyW, layoutSize.height, side, tappableSlugs);
      if (slug && slug !== lastScrubSlug.current) {
        lastScrubSlug.current = slug;
        scrubCallback(slug);
      }
    },
    [layoutSize, tappableSlugs, scrubCallback, totalGap]
  );

  const handleScrubEnd = useCallback(() => {
    lastScrubSlug.current = null;
  }, []);

  const handleTap = useCallback(
    (x: number, y: number) => {
      if (!layoutSize || !tappableSlugs || tappableSlugs.size === 0 || !onMuscleTap) return;
      const bodyW = (layoutSize.width - totalGap) / 2;
      const midpoint = bodyW + totalGap / 2;
      const side: 'front' | 'back' = x < midpoint ? 'front' : 'back';
      const localX = side === 'front' ? x : x - bodyW - totalGap;
      const slug = findNearestMuscle(localX, y, bodyW, layoutSize.height, side, tappableSlugs);
      if (slug) onMuscleTap(slug);
    },
    [layoutSize, tappableSlugs, onMuscleTap, totalGap]
  );

  const updateLoupePosition = (x: number, y: number) => {
    'worklet';
    loupeX.value = x;
    loupeY.value = y;
    if (layoutSize) {
      const bodyW = (layoutSize.width - totalGap) / 2;
      const midpoint = bodyW + totalGap / 2;
      const isBack = x >= midpoint;
      loupeSide.value = isBack ? 1 : 0;

      // Touch position relative to the body's flex container
      const localX = isBack ? x - bodyW - totalGap : x;
      // The body SVG is centered in its flex container
      const svgPadX = (bodyW - bodyPixelW) / 2;
      // Touch position on the SVG in SVG-local pixels
      const svgX = localX - svgPadX;
      const svgY = y;

      // The loupe renders at loupeScale (= scale * LOUPE_SCALE)
      // So svgX maps to svgX * (LOUPE_SCALE) in the loupe body
      // (because the loupe body is loupeScale/scale = LOUPE_SCALE times bigger)
      // We want this point at the center of the loupe clip (LOUPE_SIZE/2)
      bodyOffsetX.value = LOUPE_SIZE / 2 - svgX * LOUPE_SCALE;
      bodyOffsetY.value = LOUPE_SIZE / 2 - svgY * LOUPE_SCALE;
    }
  };

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
      updateLoupePosition(e.x, e.y);
      loupeOpacity.value = withTiming(1, { duration: 100 });
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onUpdate((e) => {
      'worklet';
      updateLoupePosition(e.x, e.y);
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onEnd(() => {
      'worklet';
      loupeOpacity.value = withTiming(0, { duration: 150 });
      runOnJS(handleScrubEnd)();
    })
    .enabled(!!(scrubCallback && tappableSlugs && tappableSlugs.size > 0));

  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

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

  // Loupe bodies use only translate (no scale transform — body is rendered at loupeScale directly)
  const loupeFrontStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: loupeSide.value === 0 ? 1 : 0,
      transform: [{ translateX: bodyOffsetX.value }, { translateY: bodyOffsetY.value }],
    };
  });

  const loupeBackStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: loupeSide.value === 1 ? 1 : 0,
      transform: [{ translateX: bodyOffsetX.value }, { translateY: bodyOffsetY.value }],
    };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={styles.gestureWrapper}>
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

          {centerContent}
          {!centerContent && gap > 0 && <View style={{ width: gap }} />}

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

          {/* Magnifying loupe — bodies rendered at larger scale, no CSS scale transform */}
          <Animated.View style={[styles.loupeContainer, loupeContainerStyle]} pointerEvents="none">
            <View style={styles.loupeClip}>
              <Animated.View style={[styles.loupeBody, loupeFrontStyle]}>
                <Body
                  data={data}
                  gender={gender}
                  side="front"
                  scale={loupeScale}
                  colors={colors}
                  defaultFill={defaultFill}
                />
              </Animated.View>
              <Animated.View style={[styles.loupeBody, loupeBackStyle]}>
                <Body
                  data={data}
                  gender={gender}
                  side="back"
                  scale={loupeScale}
                  colors={colors}
                  defaultFill={defaultFill}
                />
              </Animated.View>
              <View style={styles.loupeCrosshair} />
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  gestureWrapper: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
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
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loupeBody: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loupeCrosshair: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 5,
  },
});
