import { Skia, PaintStyle, ClipOp, type SkPath, type SkPicture } from '@shopify/react-native-skia';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';

import { bodyFills, type BodyFill, type BodyGender, type BodySide } from './bodyFills';
import { BODY_DRAWINGS } from './bodyPaths.generated';

export { bodyFills };

export type { BodyFill, BodyGender, BodySide };

/** The region of the drawing's coordinates one diagram shows. */
export interface BodyViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The diagram's layout box at scale 1, as the library sizes it. */
export const BODY_BOX = { width: 200, height: 400 };

/** The outline's stroke in layout points, whatever the drawing's scale. */
const OUTLINE_WIDTH = 2;

/** The view box the library draws one diagram in. */
export function bodyViewBox(gender: BodyGender, side: BodySide): BodyViewBox {
  const [x = 0, y = 0, width = 0, height = 0] = BODY_DRAWINGS[gender][side].viewBox
    .split(' ')
    .map(Number);
  return { x, y, width, height };
}

/** The body's outline path. */
export function bodyOutline(gender: BodyGender, side: BodySide): string | null {
  return BODY_DRAWINGS[gender][side].outline;
}

/**
 * The scale and offset that fit a view box into a layout box, centred, the
 * way an SVG view box fits by default.
 */
export function fitViewBox(
  box: BodyViewBox,
  width: number,
  height: number
): { scale: number; dx: number; dy: number } {
  const scale = Math.min(width / box.width, height / box.height);
  return {
    scale,
    dx: (width - box.width * scale) / 2 - box.x * scale,
    dy: (height - box.height * scale) / 2 - box.y * scale,
  };
}

const parsed = new Map<string, SkPath | null>();

function skPath(d: string): SkPath | null {
  let path = parsed.get(d);
  if (path === undefined) {
    path = Skia.Path.MakeFromSVGString(d);
    parsed.set(d, path);
  }
  return path;
}

/** Recorded pictures held for reuse; a feed holds a few dozen strength cards at most. */
const PICTURE_CAP = 64;
const pictures = new Map<string, SkPicture>();

/**
 * The front and back diagrams side by side at `scale`, recorded once as one
 * picture and reused for every card with the same muscles, so a card that
 * mounts or recycles in a scroll creates no view per shape and parses nothing.
 */
export function bodyPairPicture(
  muscles: readonly ExtendedBodyPart[],
  gender: BodyGender,
  scale: number,
  colors: readonly string[],
  outline: string
): SkPicture {
  const key = JSON.stringify([gender, scale, colors, outline, muscles]);
  const held = pictures.get(key);
  if (held) {
    pictures.delete(key);
    pictures.set(key, held);
    return held;
  }

  const width = BODY_BOX.width * scale;
  const height = BODY_BOX.height * scale;
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width * 2, height));
  const paint = Skia.Paint();
  paint.setAntiAlias(true);

  (['front', 'back'] as const).forEach((side, index) => {
    const box = bodyViewBox(gender, side);
    const fit = fitViewBox(box, width, height);
    canvas.save();
    canvas.translate(index * width, 0);
    canvas.clipRect(Skia.XYWHRect(0, 0, width, height), ClipOp.Intersect, true);
    canvas.translate(fit.dx, fit.dy);
    canvas.scale(fit.scale, fit.scale);

    const outlinePath = bodyOutline(gender, side);
    const outlineShape = outlinePath ? skPath(outlinePath) : null;
    if (outlineShape) {
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(OUTLINE_WIDTH / fit.scale);
      paint.setColor(Skia.Color(outline));
      canvas.drawPath(outlineShape, paint);
    }

    paint.setStyle(PaintStyle.Fill);
    for (const { d, fill } of bodyFills(muscles, gender, side, colors)) {
      const shape = skPath(d);
      if (!shape) continue;
      paint.setColor(Skia.Color(fill));
      canvas.drawPath(shape, paint);
    }
    canvas.restore();
  });

  const picture = recorder.finishRecordingAsPicture();
  pictures.set(key, picture);
  if (pictures.size > PICTURE_CAP) {
    const oldest = pictures.keys().next().value;
    if (oldest !== undefined) pictures.delete(oldest);
  }
  return picture;
}
