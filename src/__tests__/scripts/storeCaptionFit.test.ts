import * as path from 'node:path';

import { dims } from '../../../scripts/store-templates';
import { CAPTIONS } from '../../../scripts/store-screenshots';
import { captureLocales } from '../../../scripts/store-locales';
import { PRIVACY_CAPTION, WIDGETS_CAPTION } from '../../../scripts/store-panels';
import { CAPTURED_STEMS, shotsFor, type StoreTarget } from '../../../scripts/store-shots';
import { loadFace, wrapLines } from '../../../scripts/store-text';
import { storeLayout } from '../../../scripts/store-theme';

const FONTS = path.resolve(__dirname, '../../../assets/fonts');
const bold = loadFace(path.join(FONTS, 'Manrope-Bold.ttf'));
const regular = loadFace(path.join(FONTS, 'Manrope-Regular.ttf'));
const semiBold = loadFace(path.join(FONTS, 'Manrope-SemiBold.ttf'));

const SLOTS: Record<StoreTarget, { width: number; height: number }> = {
  play: { width: 1080, height: 1920 },
  appstore: { width: 1320, height: 2868 },
  ipad: { width: 2064, height: 2752 },
};

// Kerning is not read, so a line is held a little inside the box.
const MARGIN = 0.97;

function lineCounts(caption: { kicker?: string; cap: string; sub: string }, target: StoreTarget) {
  const { width, height } = SLOTS[target];
  const d = dims(width, height, 'android');
  const box = (width - 2 * d.pad) * MARGIN;
  return {
    kicker: caption.kicker ? wrapLines(semiBold, caption.kicker, d.kicker, box, 0.06) : [],
    cap: wrapLines(bold, caption.cap, d.cap, box, -0.015),
    sub: wrapLines(regular, caption.sub, d.sub, box),
  };
}

describe('wrapLines', () => {
  const box = 400;

  it('breaks a Latin caption at spaces and keeps a short one on one line', () => {
    expect(wrapLines(bold, 'Short', 40, box)).toEqual(['Short']);
    const lines = wrapLines(bold, 'Fitness, fatigue and form for every ride', 40, box);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Fitness, fatigue and form for every ride');
  });

  it('breaks wide characters anywhere but not before closing punctuation', () => {
    const text = '体能、疲劳与状态都在一张图上显示出来。';
    const lines = wrapLines(bold, text, 40, box);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
    for (const line of lines) expect('、。'.includes(line[0] ?? '')).toBe(false);
  });

  it('refuses a character the face and the wide-character fallback both lack', () => {
    expect(() => wrapLines(bold, 'a\u0e01', 40, box)).toThrow(/U\+e01/);
  });
});

describe('store captions at slot width', () => {
  const locales = captureLocales().map((c) => c.play);
  const targets: StoreTarget[] = ['play', 'appstore', 'ipad'];

  it('keeps the kicker ratio under the headline', () => {
    expect(storeLayout.kickerRatio).toBeLessThan(1);
  });

  it.each(locales)('%s captions exactly the captured shots, with no hand-placed breaks', (play) => {
    const { shots } = CAPTIONS[play];
    expect(shots).toHaveLength(CAPTURED_STEMS.length);
    for (const shot of shots) expect(`${shot.cap}${shot.sub}`).not.toContain('\n');
  });

  it.each(locales)('%s has a headline and subtitle within two lines for every shot', (play) => {
    for (const target of targets) {
      const stems = shotsFor(target)
        .filter((s) => s.source === 'captured')
        .map((s) => s.stem);
      for (const stem of stems) {
        const caption = CAPTIONS[play].shots[CAPTURED_STEMS.indexOf(stem)];
        expect(caption).toBeDefined();
        const lines = lineCounts(caption, target);
        const where = `${play} ${target} ${stem}: ${JSON.stringify(lines)}`;
        expect({ where, kicker: lines.kicker.length <= 1 }).toEqual({ where, kicker: true });
        expect({ where, cap: lines.cap.length <= 2 }).toEqual({ where, cap: true });
        expect({ where, sub: lines.sub.length <= 2 }).toEqual({ where, sub: true });
      }
    }
  });

  it.each([
    ['widgets', WIDGETS_CAPTION],
    ['privacy', PRIVACY_CAPTION],
  ])('fits the %s panel caption on the App Store slot', (_name, caption) => {
    const lines = lineCounts(caption, 'appstore');
    expect(lines.cap.length).toBeLessThanOrEqual(2);
    expect(lines.sub.length).toBeLessThanOrEqual(2);
  });
});
