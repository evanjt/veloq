import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Circle, Group, Line, Path, Rect, Shadow, Skia, vec } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { brand, shaderWarmup } from '@/theme';

/**
 * Mount this once near the root of the app (above the primary tab stack).
 *
 * It renders a 1x1 invisible Skia Canvas containing one primitive of each
 * shape that Victory Native / our charts use: Line, a flat-filled Path,
 * Shadow, Circle, Rect, Group. The Metal (iOS) and
 * Skia GPU (Android) shader programs needed for these primitives are
 * compiled the first time they are drawn, so by drawing them during app
 * launch (when the user is not looking at a chart yet) we move the
 * shader-compile cost off the first-visit-to-fitness-tab path. It is what
 * lets FitnessScreen draw its secondary charts in the same frame rather than
 * deferring them by one `requestAnimationFrame` to hide the stutter.
 */
const warmupPath = Skia.Path.MakeFromSVGString('M0 0L1 1Z');

export const ShaderWarmup = React.memo(function ShaderWarmup() {
  return (
    <View style={styles.container} pointerEvents="none" accessibilityElementsHidden>
      <Canvas style={styles.canvas}>
        <Group>
          {/* Line - used by every line chart */}
          <Line p1={vec(0, 0)} p2={vec(1, 1)} color={shaderWarmup.line} strokeWidth={1} />

          {/* Flat-filled path - the wash under a zero-based line */}
          {warmupPath ? <Path path={warmupPath} style="fill" color={shaderWarmup.area} /> : null}

          {/* Shadow-backed rect - form-zone chart */}
          <Rect x={0} y={0} width={1} height={1} color={shaderWarmup.rect}>
            <Shadow dx={0} dy={0} blur={1} color={shaderWarmup.shadow} />
          </Rect>

          {/* Circle - scatter chart dots */}
          <Circle cx={0.5} cy={0.5} r={0.25} color={brand.blue600} />
        </Group>
      </Canvas>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
  },
  canvas: {
    width: 1,
    height: 1,
  },
});
