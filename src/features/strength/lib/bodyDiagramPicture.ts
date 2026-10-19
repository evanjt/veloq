import type { ReactElement } from 'react';
import { Skia, PaintStyle, ClipOp, type SkPath, type SkPicture } from '@shopify/react-native-skia';
import type { BodyPart, ExtendedBodyPart } from 'react-native-body-highlighter';
import { bodyFront } from 'react-native-body-highlighter/dist/assets/bodyFront';
import { bodyBack } from 'react-native-body-highlighter/dist/assets/bodyBack';
import { bodyFemaleFront } from 'react-native-body-highlighter/dist/assets/bodyFemaleFront';
import { bodyFemaleBack } from 'react-native-body-highlighter/dist/assets/bodyFemaleBack';
import { SvgMaleWrapper } from 'react-native-body-highlighter/dist/components/SvgMaleWrapper';
import { SvgFemaleWrapper } from 'react-native-body-highlighter/dist/components/SvgFemaleWrapper';

export type BodyGender = 'male' | 'female';
export type BodySide = 'front' | 'back';

/** One filled shape of a diagram, in the drawing's own coordinates. */
export interface BodyFill {
  d: string;
  fill: string;
}

/** The region of the drawing's coordinates one diagram shows. */
export interface BodyViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ASSETS: Record<BodyGender, Record<BodySide, BodyPart[]>> = {
  male: { front: bodyFront, back: bodyBack },
  female: { front: bodyFemaleFront, back: bodyFemaleBack },
};

/** The diagram's layout box at scale 1, as the library sizes it. */
export const BODY_BOX = { width: 200, height: 400 };

/** The outline's stroke in layout points, whatever the drawing's scale. */
const OUTLINE_WIDTH = 2;

/**
 * The library's wrapper for a body, which holds the view box and the outline.
 * It is a plain function of its props, so calling it reads them without
 * mounting anything.
 */
function wrapperElement(gender: BodyGender, side: BodySide): ReactElement<WrapperNodeProps> {
  const Wrapper = gender === 'male' ? SvgMaleWrapper : SvgFemaleWrapper;
  return Wrapper({
    side,
    scale: 1,
    border: 'outline',
    children: null,
  }) as ReactElement<WrapperNodeProps>;
}

interface WrapperNodeProps {
  viewBox?: string;
  d?: string;
  stroke?: string;
  children?: unknown;
}

function findOutline(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findOutline(child);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const props = (node as ReactElement<WrapperNodeProps>).props;
  if (props.stroke === 'outline' && typeof props.d === 'string') return props.d;
  return findOutline(props.children);
}

/** The view box the library draws one diagram in. */
export function bodyViewBox(gender: BodyGender, side: BodySide): BodyViewBox {
  const [x = 0, y = 0, width = 0, height = 0] = String(wrapperElement(gender, side).props.viewBox)
    .split(' ')
    .map(Number);
  return { x, y, width, height };
}

/** The body's outline path, or null when the library draws none for that side. */
export function bodyOutline(gender: BodyGender, side: BodySide): string | null {
  return findOutline(wrapperElement(gender, side).props.children);
}

/**
 * Every shape of one diagram with the colour it is filled with, in the order
 * the library paints them. A trained part takes its own fill, then its own
 * colour, then the colour its intensity picks from `colors`; an untrained one,
 * or the half of a part trained only on the other side, keeps the drawing's
 * own colour.
 */
export function bodyFills(
  muscles: readonly ExtendedBodyPart[],
  gender: BodyGender,
  side: BodySide,
  colors: readonly string[]
): BodyFill[] {
  const trained = new Map<string, ExtendedBodyPart>();
  for (const muscle of muscles) if (muscle.slug) trained.set(muscle.slug, muscle);

  const fills: BodyFill[] = [];
  for (const part of ASSETS[gender][side]) {
    const own = part.color ?? '';
    const muscle = part.slug ? trained.get(part.slug) : undefined;
    const fill =
      muscle?.styles?.fill ??
      muscle?.color ??
      (muscle?.intensity && muscle.intensity > 0 ? colors[muscle.intensity - 1] : undefined) ??
      own;
    for (const d of part.path?.common ?? []) fills.push({ d, fill });
    for (const d of part.path?.left ?? [])
      fills.push({ d, fill: muscle?.side === 'right' ? own : fill });
    for (const d of part.path?.right ?? [])
      fills.push({ d, fill: muscle?.side === 'left' ? own : fill });
  }
  return fills;
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
