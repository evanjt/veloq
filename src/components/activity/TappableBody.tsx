import React, { useState, useCallback } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import {
  FRONT_POSITIONS,
  BACK_POSITIONS,
  TAP_TARGET_RADIUS,
} from '@/lib/strength/muscleHitRegions';

interface TappableBodyProps {
  data: ReadonlyArray<ExtendedBodyPart>;
  gender: 'male' | 'female';
  side: 'front' | 'back';
  scale: number;
  colors: ReadonlyArray<string>;
  /** Called when a highlighted muscle group is tapped */
  onMuscleTap?: (slug: string) => void;
  /** Set of slugs that are tappable (highlighted muscles only) */
  tappableSlugs?: Set<string>;
}

/**
 * Wraps react-native-body-highlighter's Body component with transparent
 * Pressable overlays for reliable touch handling.
 *
 * react-native-svg's Path.onPress doesn't work reliably on RN 0.81+ with
 * the new architecture. This component bypasses SVG touch entirely and uses
 * standard React Native Pressable components positioned over each muscle.
 */
export const TappableBody = React.memo(function TappableBody({
  data,
  gender,
  side,
  scale,
  colors,
  onMuscleTap,
  tappableSlugs,
}: TappableBodyProps) {
  const [layoutSize, setLayoutSize] = useState<{ width: number; height: number } | null>(null);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      setLayoutSize({
        width: e.nativeEvent.layout.width,
        height: e.nativeEvent.layout.height,
      });
    },
    []
  );

  const positions = side === 'front' ? FRONT_POSITIONS : BACK_POSITIONS;

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <Body data={data} gender={gender} side={side} scale={scale} colors={colors} />

      {/* Invisible tap targets over highlighted muscles */}
      {onMuscleTap && layoutSize && tappableSlugs && tappableSlugs.size > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-none">
          {Object.entries(positions).map(([slug, pos]) => {
            if (!tappableSlugs.has(slug)) return null;
            const left = pos.x * layoutSize.width - TAP_TARGET_RADIUS;
            const top = pos.y * layoutSize.height - TAP_TARGET_RADIUS;
            return (
              <Pressable
                key={slug}
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
                onPress={() => onMuscleTap(slug)}
              />
            );
          })}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  overlay: {
    zIndex: 10,
  },
  tapTarget: {
    position: 'absolute',
    // Uncomment for debugging tap regions:
    // backgroundColor: 'rgba(255,0,0,0.2)',
  },
});
