import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Path,
  Rect,
  Shadow,
  Skia,
  vec,
} from '@shopify/react-native-skia';

/**
 * Mount this once near the root of the app (above the primary tab stack).
 *
 * It renders a 1x1 invisible Skia Canvas containing one primitive of each
 * shape that Victory Native / our charts use: Line, Area (via Path +
 * LinearGradient), Shadow, Circle, Rect, Group. The Metal (iOS) and
 * Skia GPU (Android) shader programs needed for these primitives are
 * compiled the first time they are drawn, so by drawing them during app
 * launch (when the user is not looking at a chart yet) we move the
 * shader-compile cost off the first-visit-to-fitness-tab path.
 *
 * Without this warmup, FitnessScreen defers its secondary charts by one
 * `requestAnimationFrame` to avoid a first-visit stutter; with it, that
 * defer is no longer needed.
 */
const warmupPath = Skia.Path.Make();
warmupPath.moveTo(0, 0);
warmupPath.lineTo(1, 1);
warmupPath.close();

export const ShaderWarmup = React.memo(function ShaderWarmup() {
  return (
    <View style={styles.container} pointerEvents="none" accessibilityElementsHidden>
      <Canvas style={styles.canvas}>
        <Group>
          {/* Line — used by every line chart */}
          <Line p1={vec(0, 0)} p2={vec(1, 1)} color="#888" strokeWidth={1} />

          {/* Area (Path + LinearGradient) — fitness chart, HRV sparkline */}
          <Path path={warmupPath}>
            <LinearGradient start={vec(0, 0)} end={vec(0, 1)} colors={['#FF0000', '#00FF00']} />
          </Path>

          {/* Shadow-backed rect — form-zone chart */}
          <Rect x={0} y={0} width={1} height={1} color="#333">
            <Shadow dx={0} dy={0} blur={1} color="#000" />
          </Rect>

          {/* Circle — scatter chart dots */}
          <Circle cx={0.5} cy={0.5} r={0.25} color="#FC4C02" />
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
