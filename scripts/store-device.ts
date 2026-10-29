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

/**
 * The emulator every Android store capture is taken on. Store captures never
 * come from a physical handset: it carries its own status bar and display
 * size, ignores the system UI demo broadcasts and cannot be given a mocked
 * position. The width and density give a 439 dp wide screen, the layout width
 * of the iPhone Pro Max capture, so a screen shows what the iPhone set shows.
 * `scripts/store-avd-create.sh` creates it, so a retake on another machine
 * makes the same one.
 */
export const STORE_AVD = {
  name: 'veloq_store_pro_max',
  image: 'system-images;android-35;google_apis;x86_64',
  // The profile avdmanager starts from. Its screen size is replaced afterwards.
  device: 'pixel_7_pro',
  width: 1344,
  height: 2992,
  density: 490,
} as const;

/**
 * The config.ini of a freshly created AVD with the store emulator's screen
 * size set. avdmanager writes the device profile's own size, so the three keys
 * are replaced, or appended when absent. Applying it twice changes nothing.
 */
export function storeAvdConfig(config: string): string {
  const keys: Record<string, number> = {
    'hw.lcd.width': STORE_AVD.width,
    'hw.lcd.height': STORE_AVD.height,
    'hw.lcd.density': STORE_AVD.density,
  };
  const lines = config.split('\n').filter((line) => {
    const key = (line.split('=')[0] ?? '').trim();
    return !(key in keys) && line !== '';
  });
  for (const [key, value] of Object.entries(keys)) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Why a device may not be used for an Android store capture, or null when it
 * may. `avdName` is what `adb emu avd name` printed: empty for a physical
 * handset, which has no emulator console.
 */
export function storeDeviceRefusal(avdName: string): string | null {
  const name = avdName.trim();
  if (name === '') {
    return `is a physical handset. Store captures are taken on the ${STORE_AVD.name} emulator`;
  }
  if (name !== STORE_AVD.name) {
    return `is the emulator ${name}. Store captures are taken on ${STORE_AVD.name}`;
  }
  return null;
}

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

// `npx tsx scripts/store-device.ts check <avd name>` exits 1 and says why when
// the device behind that name is not the store emulator.
if (/store-device\.ts$/.test(process.argv[1] ?? '') && process.argv[2] === 'check') {
  const refusal = storeDeviceRefusal(process.argv[3] ?? '');
  if (refusal) {
    console.error(`store capture: the device ${refusal}.`);
    process.exit(1);
  }
}

// `npx tsx scripts/store-device.ts field <name>` prints one STORE_AVD field,
// and `config <path>` rewrites that config.ini in place.
if (/store-device\.ts$/.test(process.argv[1] ?? '') && process.argv[2] === 'field') {
  console.log(STORE_AVD[process.argv[3] as keyof typeof STORE_AVD]);
}
if (/store-device\.ts$/.test(process.argv[1] ?? '') && process.argv[2] === 'config') {
  const file = process.argv[3];
  if (!file) {
    console.error('usage: store-device.ts config <config.ini>');
    process.exit(2);
  }
  const fs = require('fs') as typeof import('fs');
  fs.writeFileSync(file, storeAvdConfig(fs.readFileSync(file, 'utf8')));
}
