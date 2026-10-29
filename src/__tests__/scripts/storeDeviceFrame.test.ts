/**
 * Scenario: each store slot frames its capture in a device of its own class.
 *
 * Expected behaviour: a 'whole' device lies inside the canvas below the
 * headline, the outermost status bar glyphs lie inside the screen's rounded
 * corners, a tablet keeps its capture's aspect, and the rendered page draws
 * the camera cut-out of its class.
 */

import { dims, phoneHtml, type Caption } from '../../../scripts/store-templates';
import {
  CAPTURE_SIZE,
  deviceFrame,
  insideRoundedRect,
  STORE_AVD,
  storeAvdConfig,
  storeDeviceRefusal,
  type DeviceKind,
  type ShotLayout,
} from '../../../scripts/store-device';
import { storePalette } from '../../../scripts/store-theme';

const SLOTS: { kind: DeviceKind; width: number; height: number }[] = [
  { kind: 'android', width: 1080, height: 1920 },
  { kind: 'iphone', width: 1320, height: 2868 },
  { kind: 'ipad', width: 2064, height: 2752 },
  { kind: 'android', width: 720, height: 1584 },
];

const frameFor = (kind: DeviceKind, width: number, height: number, layout: ShotLayout) => {
  const d = dims(width, height, kind);
  return { d, frame: deviceFrame(kind, d, layout) };
};

describe('store device frame', () => {
  it.each(SLOTS)('fits the whole $kind device inside the $width x $height canvas', (slot) => {
    const { d, frame } = frameFor(slot.kind, slot.width, slot.height, 'whole');
    const left = (slot.width - frame.outerWidth) / 2;
    const top = d.pad + d.headH;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + frame.outerWidth).toBeLessThanOrEqual(slot.width);
    expect(top + frame.outerHeight).toBeLessThanOrEqual(slot.height - d.pad);
  });

  it('draws a Play phone at about 60% of the canvas width', () => {
    const { frame } = frameFor('android', 1080, 1920, 'whole');
    expect(frame.outerWidth / 1080).toBeGreaterThan(0.55);
    expect(frame.outerWidth / 1080).toBeLessThan(0.65);
  });

  it.each(SLOTS.filter((s) => s.kind !== 'ipad'))(
    'lets a detail $kind device run off the bottom with its top intact',
    (slot) => {
      const { d, frame } = frameFor(slot.kind, slot.width, slot.height, 'detail');
      expect(frame.outerWidth).toBeGreaterThan(deviceFrame(slot.kind, d, 'whole').outerWidth);
      expect(d.pad + d.headH + frame.outerHeight).toBeGreaterThan(slot.height);
      expect(frame.outerWidth).toBeLessThanOrEqual(slot.width);
    }
  );

  it.each(SLOTS)('keeps the $kind status bar glyphs inside the rounded screen', (slot) => {
    for (const layout of ['whole', 'detail'] as const) {
      const { frame } = frameFor(slot.kind, slot.width, slot.height, layout);
      for (const box of [frame.statusLeft, frame.statusRight]) {
        for (const [x, y] of [
          [box.left, box.top],
          [box.right, box.top],
          [box.left, box.bottom],
          [box.right, box.bottom],
        ] as const) {
          expect(
            insideRoundedRect(x, y, frame.screenWidth, frame.screenHeight, frame.screenRadius)
          ).toBe(true);
        }
      }
    }
  });

  it('starts the Android clock 25 px in on a 712 px wide capture', () => {
    const { frame } = frameFor('android', 1080, 1920, 'whole');
    expect(frame.statusLeft.left / frame.screenWidth).toBeCloseTo(25 / 712, 4);
  });

  it('gives the tablet its capture aspect with no cut-out', () => {
    const { frame } = frameFor('ipad', 2064, 2752, 'whole');
    const capture = CAPTURE_SIZE.ipad;
    expect(frame.screenWidth / frame.screenHeight).toBeCloseTo(capture.width / capture.height, 2);
    expect(frame.cutout).toBeNull();
  });

  it('gives a phone a cut-out of its class', () => {
    expect(frameFor('android', 1080, 1920, 'whole').frame.cutout?.shape).toBe('circle');
    expect(frameFor('iphone', 1320, 2868, 'whole').frame.cutout?.shape).toBe('pill');
  });

  describe('rendered page', () => {
    const caption: Caption = { kicker: 'Feed', cap: 'Your activity\nhistory', sub: 'Synced.' };
    const html = (kind: DeviceKind, w: number, h: number, layout: ShotLayout) =>
      phoneHtml(storePalette, dims(w, h, kind), caption, '/x.png', layout);

    it('draws the camera cut-out and the frame size of the class', () => {
      const page = html('android', 1080, 1920, 'whole');
      const { frame } = frameFor('android', 1080, 1920, 'whole');
      expect(page).toContain('class="cutout circle"');
      expect(page).toContain(`--devh: ${frame.outerHeight}px`);
      expect(html('iphone', 1320, 2868, 'whole')).toContain('class="cutout pill"');
      expect(html('ipad', 2064, 2752, 'whole')).not.toContain('class="cutout');
    });
  });
});

describe('the Android store capture device', () => {
  it('accepts the named emulator and refuses a physical handset or another emulator', () => {
    expect(storeDeviceRefusal(`${STORE_AVD.name}\r\n`)).toBeNull();
    expect(storeDeviceRefusal('')).toContain('physical handset');
    expect(storeDeviceRefusal('Pixel_6_API_34')).toContain(STORE_AVD.name);
  });

  it('gives a screen 439 dp wide, the iPhone Pro Max layout width', () => {
    expect(Math.round((STORE_AVD.width * 160) / STORE_AVD.density)).toBe(439);
  });

  it('rewrites the size keys of a created config and leaves the others', () => {
    const created = 'hw.lcd.density=420\nhw.lcd.height=2400\nhw.ramSize=2048\nhw.lcd.width=1080\n';
    const out = storeAvdConfig(created);
    expect(out).toContain(`hw.lcd.width=${STORE_AVD.width}`);
    expect(out).toContain(`hw.lcd.height=${STORE_AVD.height}`);
    expect(out).toContain(`hw.lcd.density=${STORE_AVD.density}`);
    expect(out).toContain('hw.ramSize=2048');
    expect(out.match(/hw\.lcd\.width/g)).toHaveLength(1);
    expect(storeAvdConfig(out)).toBe(out);
  });

  it('adds a size key the created config lacks', () => {
    expect(storeAvdConfig('hw.ramSize=2048\n')).toContain(`hw.lcd.width=${STORE_AVD.width}`);
  });
});
