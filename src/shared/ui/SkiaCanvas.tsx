import React from 'react';
import { PixelRatio } from 'react-native';
import { Canvas as RawCanvas } from '@shopify/react-native-skia';

/**
 * The widest or tallest texture the GPU takes, in physical pixels. On Android a
 * canvas draws into a texture its own size, and one side past this aborts the
 * render thread and with it the app.
 */
export const MAX_TEXTURE_PX = 16384;

/** Room under the limit for the pixel grid rounding a side up. */
const TEXTURE_MARGIN_PX = 64;

/** The longest side a canvas may lay out to, in dp, at a pixel ratio. */
export function maxCanvasSide(pixelRatio: number): number {
  return Math.floor((MAX_TEXTURE_PX - TEXTURE_MARGIN_PX) / pixelRatio);
}

type CanvasProps = React.ComponentProps<typeof RawCanvas>;

/**
 * Every Skia canvas in the app draws through this one. It caps both sides at
 * the texture limit whatever the caller's size, so a size grown from layout or
 * data clips its drawing rather than killing the app.
 */
export function Canvas({ style, ...props }: CanvasProps) {
  const side = maxCanvasSide(PixelRatio.get());
  return <RawCanvas {...props} style={[style, { maxWidth: side, maxHeight: side }]} />;
}
