// The device each store slot frames its capture in. One function owns the
// geometry, so the templates draw it and the test measures it from the same
// numbers. Every length derives from the screen width of the device class, so
// the frame keeps its real proportions at any slot size.

export type DeviceKind = 'android' | 'iphone' | 'ipad';

/**
 * 'whole' fits the entire device below the headline. 'detail' draws it larger,
 * running off the bottom of the canvas with its status bar and camera intact.
 */
export type ShotLayout = 'whole' | 'detail';

/** The pixel size of the raw capture a device class frames. */
export const CAPTURE_SIZE: Record<DeviceKind, { width: number; height: number }> = {
  android: { width: 1080, height: 2400 },
  iphone: { width: 1320, height: 2868 },
  ipad: { width: 2064, height: 2752 },
};

interface DeviceClass {
  /** Bezel width, of screen width. */
  bezel: number;
  /** Screen corner radius, of screen width. */
  radius: number;
  /** The cut-out in the screen, positioned from the screen's top edge. */
  cutout: null | { shape: 'circle' | 'pill'; w: number; h: number; top: number };
  /**
   * The row of status bar glyphs: the clock's left edge and the battery's
   * right edge sit `insetX` from their screen edge, between `top` and
   * `top + height`. All of screen width.
   */
  status: { insetX: number; top: number; height: number };
}

const DEVICES: Record<DeviceKind, DeviceClass> = {
  // The clock starts 25 px in on a 712 px wide capture.
  android: {
    bezel: 0.015,
    radius: 0.09,
    cutout: { shape: 'circle', w: 0.035, h: 0.035, top: 0.0215 },
    status: { insetX: 25 / 712, top: 0.025, height: 0.028 },
  },
  iphone: {
    bezel: 0.012,
    radius: 0.14,
    cutout: { shape: 'pill', w: 0.284, h: 0.084, top: 0.025 },
    status: { insetX: 0.07, top: 0.05, height: 0.034 },
  },
  ipad: {
    bezel: 0.035,
    radius: 0.025,
    cutout: null,
    status: { insetX: 0.04, top: 0.012, height: 0.014 },
  },
};

/** Width of a 'detail' phone, of canvas width. */
export const DETAIL_WIDTH_RATIO = 0.86;
/** Widest a tablet is drawn, of canvas width. */
export const TABLET_WIDTH_RATIO = 0.6;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DeviceFrame {
  kind: DeviceKind;
  outerWidth: number;
  outerHeight: number;
  bezel: number;
  outerRadius: number;
  screenWidth: number;
  screenHeight: number;
  screenRadius: number;
  /** In screen pixels, from the screen's top-left corner. */
  cutout: null | {
    shape: 'circle' | 'pill';
    left: number;
    top: number;
    width: number;
    height: number;
  };
  /** The leftmost and rightmost status bar glyph boxes, in screen pixels. */
  statusLeft: Box;
  statusRight: Box;
}

export interface FrameSlot {
  width: number;
  height: number;
  /** Space kept clear on every side. */
  pad: number;
  /** Height of the headline block above the device. */
  headH: number;
}

export function deviceFrame(kind: DeviceKind, slot: FrameSlot, layout: ShotLayout): DeviceFrame {
  const cls = DEVICES[kind];
  const capture = CAPTURE_SIZE[kind];
  const aspect = capture.height / capture.width;
  const chrome = 1 + 2 * cls.bezel; // outer width over screen width
  const stageHeight = slot.height - 2 * slot.pad - slot.headH;

  let outerWidth: number;
  if (kind === 'ipad' || layout === 'whole') {
    const widthCap = kind === 'ipad' ? slot.width * TABLET_WIDTH_RATIO : slot.width - 2 * slot.pad;
    // Outer height is the screen's height plus both bezels.
    const heightFit = (stageHeight * chrome) / (aspect + 2 * cls.bezel);
    outerWidth = Math.min(widthCap, heightFit);
  } else {
    outerWidth = slot.width * DETAIL_WIDTH_RATIO;
  }

  const screenWidth = Math.floor(outerWidth / chrome);
  const bezel = Math.round(screenWidth * cls.bezel);
  const screenHeight = Math.round(screenWidth * aspect);
  const px = (v: number) => v * screenWidth;
  const top = px(cls.status.top);
  const bottom = px(cls.status.top + cls.status.height);
  // The clock and the battery are the outermost glyphs, so only their outer
  // edge is placed; a glyph box is taken as twice as wide as the row is tall.
  const glyphWidth = px(cls.status.height) * 2;
  const leftEdge = px(cls.status.insetX);
  const rightEdge = screenWidth - px(cls.status.insetX);
  return {
    kind,
    outerWidth: screenWidth + 2 * bezel,
    outerHeight: screenHeight + 2 * bezel,
    bezel,
    outerRadius: Math.round(px(cls.radius)) + bezel,
    screenWidth,
    screenHeight,
    screenRadius: Math.round(px(cls.radius)),
    cutout: cls.cutout && {
      shape: cls.cutout.shape,
      width: px(cls.cutout.w),
      height: px(cls.cutout.h),
      left: (screenWidth - px(cls.cutout.w)) / 2,
      top: px(cls.cutout.top),
    },
    statusLeft: { left: leftEdge, top, right: leftEdge + glyphWidth, bottom },
    statusRight: { left: rightEdge - glyphWidth, top, right: rightEdge, bottom },
  };
}

/** Whether a point lies inside a rectangle of rounded corners at the origin. */
export function insideRoundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): boolean {
  if (x < 0 || y < 0 || x > width || y > height) return false;
  const cx = x < radius ? radius : x > width - radius ? width - radius : x;
  const cy = y < radius ? radius : y > height - radius ? height - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
