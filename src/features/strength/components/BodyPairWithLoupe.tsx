import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';

import { CHART_CONFIG } from '@/constants';
import { bodyDiagram, brand, loupeChrome, layout } from '@/theme';
import { useTheme } from '@/shared/app';

import { findMuscleAtPoint } from '../lib/polygons';

const LOUPE_SIZE = 90;
const LOUPE_OFFSET_Y = -100;
const LOUPE_SCALE = 2.5;

/** The loupe's fade out, and so how long its bodies outlive the scrub. */
const LOUPE_FADE_MS = 150;

// Body component intrinsic dimensions (from react-native-body-highlighter source)
const BODY_INTRINSIC_W = 200;
const BODY_INTRINSIC_H = 400;

interface BodyPairWithLoupeProps {
  data: readonly ExtendedBodyPart[];
  /** The muscle drawn with the selection stroke. Kept out of `data` so a scrub does not rebuild it. */
  selectedSlug?: string | null | undefined;
  gender: 'male' | 'female';
  scale: number;
  colors: readonly string[];
  defaultFill?: string | undefined;
  onMuscleTap?: ((slug: string) => void) | undefined;
  onMuscleScrub?: ((slug: string) => void) | undefined;
  tappableSlugs?: Set<string> | undefined;
  gap?: number | undefined;
  centerContent?: React.ReactNode | undefined;
  centerWidth?: number | undefined;
}

export const BodyPairWithLoupe = React.memo(function BodyPairWithLoupe({
  data: baseData,
  selectedSlug,
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
  const { isDark } = useTheme();
  const stroke = isDark ? bodyDiagram.selectedStrokeDark : bodyDiagram.selectedStroke;
  // Each part's selected form is made once per data and theme, so a scrub step hands
  // Body the same objects for every part whose stroke did not change.
  const selectedParts = useMemo(
    () =>
      new Map(
        baseData.map((part) => [
          part.slug,
          { ...part, styles: { ...part.styles, stroke, strokeWidth: 2.5 } },
        ])
      ),
    [baseData, stroke]
  );
  const data = useMemo(
    () =>
      selectedSlug == null
        ? baseData
        : baseData.map((part) =>
            part.slug === selectedSlug ? (selectedParts.get(part.slug) ?? part) : part
          ),
    [baseData, selectedSlug, selectedParts]
  );
  const [layoutSize, setLayoutSize] = useState<{ width: number; height: number } | null>(null);
  const lastScrubSlug = useRef<string | null>(null);
  // The loupe's two bodies are drawn two and a half times larger than the pair
  // on screen, so they are mounted for the scrub and not for the life of the
  // tab. Opacity alone left them laid out and composited behind a clip nobody
  // was looking through.
  const [scrubbing, setScrubbing] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showLoupe = useCallback(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = null;
    setScrubbing(true);
  }, []);

  // Kept until the fade has run, so the loupe still goes out rather than
  // vanishing on the frame the finger lifts.
  const hideLoupe = useCallback(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setScrubbing(false);
    }, LOUPE_FADE_MS);
  }, []);

  useEffect(
    () => () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    },
    []
  );

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

  // Convert touch coordinates to normalized SVG space (0-1) and find muscle
  const touchToMuscle = useCallback(
    (x: number, y: number): string | null => {
      if (!layoutSize || !tappableSlugs || tappableSlugs.size === 0) return null;
      const bodyW = (layoutSize.width - totalGap) / 2;
      const midpoint = bodyW + totalGap / 2;
      const side: 'front' | 'back' = x < midpoint ? 'front' : 'back';
      const localX = side === 'front' ? x : x - bodyW - totalGap;
      // SVG centering within flex container
      const padX = (bodyW - bodyPixelW) / 2;
      // Normalized 0-1 coordinates within the SVG viewBox
      const nx = (localX - padX) / bodyPixelW;
      const ny = y / bodyPixelH;
      return findMuscleAtPoint(nx, ny, side, tappableSlugs, gender);
    },
    [layoutSize, tappableSlugs, totalGap, bodyPixelW, bodyPixelH, gender]
  );

  const handleScrubUpdate = useCallback(
    (x: number, y: number) => {
      if (!scrubCallback) return;
      const slug = touchToMuscle(x, y);
      if (slug && slug !== lastScrubSlug.current) {
        lastScrubSlug.current = slug;
        scrubCallback(slug);
      }
    },
    [touchToMuscle, scrubCallback]
  );

  const handleScrubEnd = useCallback(() => {
    lastScrubSlug.current = null;
    hideLoupe();
  }, [hideLoupe]);

  const handleTap = useCallback(
    (x: number, y: number) => {
      if (!onMuscleTap) return;
      const slug = touchToMuscle(x, y);
      if (slug) onMuscleTap(slug);
    },
    [touchToMuscle, onMuscleTap]
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

  const scrubEnabled = !!(scrubCallback && tappableSlugs && tappableSlugs.size > 0);

  // LongPress gates activation - ScrollView can claim touch before this fires
  const longPressGesture = Gesture.LongPress()
    .minDuration(CHART_CONFIG.LONG_PRESS_DURATION)
    .enabled(scrubEnabled)
    .onStart((e) => {
      'worklet';
      loupeOpacity.value = withTiming(1, { duration: 100 });
      runOnJS(showLoupe)();
      updateLoupePosition(e.x, e.y);
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .shouldCancelWhenOutside(false);

  // Pan with manual activation - only activates after long-press shows loupe
  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .enabled(scrubEnabled)
    .onTouchesMove((_, manager) => {
      'worklet';
      if (loupeOpacity.value > 0) {
        manager.activate();
      }
    })
    .onUpdate((e) => {
      'worklet';
      updateLoupePosition(e.x, e.y);
      runOnJS(handleScrubUpdate)(e.x, e.y);
    })
    .onEnd(() => {
      'worklet';
      loupeOpacity.value = withTiming(0, { duration: LOUPE_FADE_MS });
      runOnJS(handleScrubEnd)();
    })
    .onFinalize(() => {
      'worklet';
      loupeOpacity.value = withTiming(0, { duration: LOUPE_FADE_MS });
      runOnJS(handleScrubEnd)();
    });

  const scrubGesture = Gesture.Simultaneous(longPressGesture, panGesture);
  const composedGesture = Gesture.Exclusive(scrubGesture, tapGesture);

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

  // Loupe bodies use only translate (no scale transform - body is rendered at loupeScale directly)
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
              {...(defaultFill !== undefined && { defaultFill })}
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
              {...(defaultFill !== undefined && { defaultFill })}
            />
          </View>

          {/* Magnifying loupe - bodies rendered at larger scale, no CSS scale transform */}
          {scrubbing && (
            <Animated.View
              style={[styles.loupeContainer, loupeContainerStyle]}
              pointerEvents="none"
            >
              <View style={[styles.loupeClip, isDark && styles.loupeClipDark]}>
                <Animated.View style={[styles.loupeBody, loupeFrontStyle]}>
                  <Body
                    data={data}
                    gender={gender}
                    side="front"
                    scale={loupeScale}
                    colors={colors}
                    {...(defaultFill !== undefined && { defaultFill })}
                  />
                </Animated.View>
                <Animated.View style={[styles.loupeBody, loupeBackStyle]}>
                  <Body
                    data={data}
                    gender={gender}
                    side="back"
                    scale={loupeScale}
                    colors={colors}
                    {...(defaultFill !== undefined && { defaultFill })}
                  />
                </Animated.View>
                <View style={styles.loupeCrosshair} />
              </View>
            </Animated.View>
          )}
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
    borderColor: brand.tealLight,
    backgroundColor: loupeChrome.bgLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loupeClipDark: {
    backgroundColor: loupeChrome.bgDark,
  },
  loupeBody: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  loupeCrosshair: {
    width: 6,
    height: 6,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: loupeChrome.crosshairDot,
    borderWidth: 1,
    borderColor: loupeChrome.crosshairRing,
    zIndex: 5,
  },
});
