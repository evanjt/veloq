/**
 * Scenario: one screenshot run composites every captured language and writes
 * the sets into the fastlane trees a release tag uploads from. A set written
 * to the wrong locale, merged into a stale one, or framed from a simulator of
 * the wrong size ships a listing the store either rejects or shows wrongly.
 *
 * Expected behaviour: each capture's sets replace the Play and App Store sets
 * of every locale it installs into, mirrors and App Store-only locales
 * included; every captured language has its captions; an App Store raw capture
 * at a size other than its store slot is refused before anything is framed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { captureLocales } from '../../../scripts/store-locales';
import { CAPTURED_STEMS } from '../../../scripts/store-shots';
import { CAPTIONS, installSets, rawCaptures } from '../../../scripts/store-screenshots';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'store-install-'));
}

function write(file: string, body: string | Buffer = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** A PNG header carrying only the size, which is all the size check reads. */
function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 2;
  return buf;
}

function list(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

describe('installSets', () => {
  const capture = (play: string) => captureLocales().find((c) => c.play === play)!;

  function rendered(store: string, play: string): void {
    for (const n of ['01', '02']) {
      write(path.join(store, 'play', play, `${n}.jpg`), `play-${play}-${n}`);
      write(path.join(store, 'appstore', play, `${n}.jpg`), `phone-${play}-${n}`);
    }
    write(path.join(store, 'ipad', play, '01.jpg'), `ipad-${play}`);
    write(path.join(store, 'feature', play, 'featureGraphic.jpg'), `feature-${play}`);
  }

  it('writes a capture into its mirror on both stores', () => {
    const store = tmp();
    const fastlane = tmp();
    rendered(store, 'en-AU');
    installSets(store, fastlane, [capture('en-AU')]);
    for (const locale of ['en-AU', 'en-GB']) {
      const images = path.join(fastlane, 'metadata/android', locale, 'images');
      expect(list(path.join(images, 'phoneScreenshots'))).toEqual(['01.jpg', '02.jpg']);
      expect(fs.readFileSync(path.join(images, 'featureGraphic.jpg'), 'utf8')).toBe(
        'feature-en-AU'
      );
      expect(list(path.join(fastlane, 'screenshots', locale))).toEqual([
        '01.jpg',
        '02.jpg',
        'ipad-01.jpg',
      ]);
    }
  });

  it('fills English (Canada) on the App Store from the en-US capture, and no Play locale', () => {
    const store = tmp();
    const fastlane = tmp();
    rendered(store, 'en-US');
    installSets(store, fastlane, [capture('en-US')]);
    expect(fs.readFileSync(path.join(fastlane, 'screenshots/en-CA/01.jpg'), 'utf8')).toBe(
      'phone-en-US-01'
    );
    expect(fs.existsSync(path.join(fastlane, 'metadata/android/en-CA'))).toBe(false);
    expect(list(path.join(fastlane, 'metadata/android/en-US/images/phoneScreenshots'))).toEqual([
      '01.jpg',
      '02.jpg',
    ]);
  });

  it('names an App Store set by the Apple locale code', () => {
    const store = tmp();
    const fastlane = tmp();
    rendered(store, 'it-IT');
    installSets(store, fastlane, [capture('it-IT')]);
    expect(list(path.join(fastlane, 'screenshots/it'))).toHaveLength(3);
    expect(fs.existsSync(path.join(fastlane, 'screenshots/it-IT'))).toBe(false);
  });

  it('replaces a locale set whole, so a shot dropped from the run leaves the store too', () => {
    const store = tmp();
    const fastlane = tmp();
    write(path.join(fastlane, 'metadata/android/fr-FR/images/phoneScreenshots/07.jpg'));
    write(path.join(fastlane, 'screenshots/fr-FR/07.jpg'));
    write(path.join(fastlane, 'metadata/android/fr-FR/images/icon.png'), 'icon');
    rendered(store, 'fr-FR');
    installSets(store, fastlane, [capture('fr-FR')]);
    expect(list(path.join(fastlane, 'metadata/android/fr-FR/images/phoneScreenshots'))).toEqual([
      '01.jpg',
      '02.jpg',
    ]);
    expect(list(path.join(fastlane, 'screenshots/fr-FR'))).not.toContain('07.jpg');
    expect(
      fs.readFileSync(path.join(fastlane, 'metadata/android/fr-FR/images/icon.png'), 'utf8')
    ).toBe('icon');
  });

  it('refuses a capture with nothing rendered rather than leaving its locales empty', () => {
    const fastlane = tmp();
    write(path.join(fastlane, 'screenshots/de-DE/01.jpg'), 'live');
    expect(() => installSets(tmp(), fastlane, [capture('de-DE')])).toThrow(/de-DE/);
    expect(fs.readFileSync(path.join(fastlane, 'screenshots/de-DE/01.jpg'), 'utf8')).toBe('live');
  });
});

describe('CAPTIONS', () => {
  it.each(captureLocales().map((c) => c.play))('captions every shot in %s', (play) => {
    const strings = CAPTIONS[play];
    expect(strings).toBeDefined();
    expect(strings.shots).toHaveLength(CAPTURED_STEMS.length);
    for (const shot of strings.shots) {
      expect(shot.cap.trim()).not.toBe('');
      expect(shot.sub.trim()).not.toBe('');
    }
    expect(strings.tagline.trim()).not.toBe('');
  });
});

describe('rawCaptures', () => {
  const STEMS = ['01-feed', '02-map', '03-activity'];

  function raws(root: string, platform: string, play: string, size: [number, number]): void {
    for (const stem of STEMS) {
      write(path.join(root, platform, play, `${stem}.png`), png(size[0], size[1]));
    }
  }

  it('reads a locale captures from its own directory', () => {
    const root = tmp();
    raws(root, 'android', 'ja-JP', [1080, 2340]);
    expect(rawCaptures('play', root, 'ja-JP', 3)).toEqual(
      STEMS.map((s) => path.join(root, 'android', 'ja-JP', `${s}.png`))
    );
  });

  it('refuses a locale that was not captured, naming it', () => {
    const root = tmp();
    raws(root, 'android', 'en-US', [1080, 2340]);
    expect(() => rawCaptures('play', root, 'pl-PL', 3)).toThrow(/pl-PL/);
  });

  it('passes iPhone and iPad captures at their store slot size', () => {
    const root = tmp();
    raws(root, 'ios', 'en-US', [1320, 2868]);
    raws(root, 'ipad', 'en-US', [2064, 2752]);
    expect(rawCaptures('appstore', root, 'en-US', 3)).toHaveLength(3);
    expect(rawCaptures('ipad', root, 'en-US', 3)).toHaveLength(3);
  });

  it('refuses an iPhone capture from a smaller simulator, naming the size it needs', () => {
    const root = tmp();
    raws(root, 'ios', 'en-US', [1206, 2622]);
    expect(() => rawCaptures('appstore', root, 'en-US', 3)).toThrow(/1206x2622.*1320x2868/s);
  });

  it('refuses an iPad capture from a smaller simulator', () => {
    const root = tmp();
    raws(root, 'ipad', 'en-US', [1640, 2360]);
    expect(() => rawCaptures('ipad', root, 'en-US', 3)).toThrow(/2064x2752/);
  });
});
