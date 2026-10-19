/**
 * Scenario: on Android a Skia canvas draws into a texture its own size, and a
 * side past the GPU's 16,384 px limit aborts the render thread. A canvas 140 dp
 * wide and 5,465 dp tall at 3x, sized from a row height that kept growing, did
 * exactly that.
 *
 * Expected behaviour: whatever size a caller asks for, the canvas lays out no
 * side past the limit in physical pixels at the device's pixel ratio.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PixelRatio, StyleSheet } from 'react-native';
import { Canvas as RawCanvas } from '@shopify/react-native-skia';

import { Canvas, MAX_TEXTURE_PX, maxCanvasSide } from '@/shared/ui/SkiaCanvas';

describe('the canvas texture limit', () => {
  it.each([1, 2, 2.625, 2.8125, 3, 3.5, 4])(
    'keeps a side under the limit at pixel ratio %p',
    (ratio) => {
      const side = maxCanvasSide(ratio);
      expect(side * ratio).toBeLessThan(MAX_TEXTURE_PX);
      expect(side * ratio).toBeGreaterThan(MAX_TEXTURE_PX * 0.98);
    }
  );

  it('refuses the canvas that aborted, 5,465 dp tall at 3x', () => {
    expect(maxCanvasSide(3)).toBeLessThan(5465);
  });

  it.each([
    ['a fixed size', { width: 140, height: 5465 }],
    ['a size from the parent', { width: '100%', flex: 1 } as const],
    ['a fill', StyleSheet.absoluteFill],
    ['a style list', [{ width: 50000 }, { height: 20 }]],
  ])('caps both sides of %s', async (_name, style) => {
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
    const tree = await render(<Canvas style={style} />);
    const laidOut = StyleSheet.flatten(tree.UNSAFE_getByType(RawCanvas).props.style);
    expect(laidOut.maxWidth).toBe(maxCanvasSide(3));
    expect(laidOut.maxHeight).toBe(maxCanvasSide(3));
    jest.restoreAllMocks();
  });
});
