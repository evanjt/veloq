/**
 * Scenario: a release tag uploads the listing texts and images under
 * config/fastlane to both stores. A field over a store's published limit, a
 * screenshot at the wrong resolution or with an alpha channel, or a missing
 * App Store deliver file is refused by the store after the upload starts.
 *
 * Expected behaviour: the validator refuses each of those before anything is
 * sent, and warns about keyword choices that waste Apple's indexed words.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

import {
  imageErrors,
  keywordWarnings,
  listingBudgetErrors,
  listingFloorErrors,
  readImageInfo,
  screenshotErrors,
  storeFloors,
  textFieldErrors,
  validateMetadata,
} from '../../../scripts/validate-store-metadata';
import { uniqueStoreLocales } from '../../../scripts/store-locales';

function png(width: number, height: number, colourType: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const body = Buffer.concat([Buffer.from('IHDR'), ihdr]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body), 0);
  return Buffer.concat([header, length, body, crc]);
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

describe('textFieldErrors', () => {
  it('refuses a missing and an empty field', () => {
    expect(textFieldErrors('ios', 'xx', 'name.txt', null).map((e) => e.type)).toEqual([
      'missing_file',
    ]);
    expect(textFieldErrors('ios', 'xx', 'name.txt', '  \n').map((e) => e.type)).toEqual([
      'empty_file',
    ]);
  });

  it('holds each field to its store limit, counted in characters', () => {
    expect(textFieldErrors('ios', 'xx', 'subtitle.txt', 'x'.repeat(30))).toEqual([]);
    expect(textFieldErrors('ios', 'xx', 'subtitle.txt', 'x'.repeat(31)).map((e) => e.type)).toEqual(
      ['over_limit']
    );
    expect(textFieldErrors('android', 'xx', 'short_description.txt', 'é'.repeat(80))).toEqual([]);
    expect(
      textFieldErrors('android', 'xx', 'short_description.txt', 'x'.repeat(81)).map((e) => e.type)
    ).toEqual(['over_limit']);
    expect(
      textFieldErrors('ios', 'xx', 'promotional_text.txt', 'x'.repeat(171)).map((e) => e.type)
    ).toEqual(['over_limit']);
  });

  it('does not count the trailing newline against a field limit', () => {
    expect(textFieldErrors('android', 'xx', 'title.txt', `${'x'.repeat(30)}\n`)).toEqual([]);
  });

  it('leaves a field with no published limit unbounded', () => {
    expect(textFieldErrors('ios', 'xx', 'support_url.txt', 'x'.repeat(5000))).toEqual([]);
  });
});

describe('keywordWarnings', () => {
  it('warns about a keyword that repeats the name, subtitle or category', () => {
    expect(
      keywordWarnings('xx', 'kayak,paddle,river', 'Paddlelog', 'River trips', 'SPORTS')
    ).toEqual([expect.stringContaining("'river'")]);
    expect(keywordWarnings('xx', 'kayak,sports', 'Paddlelog', 'Trips', 'SPORTS')).toEqual([
      expect.stringContaining("'sports'"),
    ]);
  });

  it('warns about a word placed twice and a space after a comma', () => {
    expect(keywordWarnings('xx', 'canoe trip,trip', 'Paddlelog', 'Logs', '')).toEqual([
      expect.stringContaining("'trip' appears twice"),
    ]);
    expect(keywordWarnings('xx', 'canoe, kayak', 'Paddlelog', 'Logs', '')).toEqual([
      expect.stringContaining('Space after comma'),
    ]);
  });

  it('warns when the field fits in characters but not in bytes', () => {
    const kana = 'カヌー'.repeat(33);
    expect(keywordWarnings('xx', kana, 'Paddlelog', 'Logs', '')).toEqual([
      expect.stringContaining('bytes'),
    ]);
  });

  it('passes a keyword set with no wasted word', () => {
    expect(
      keywordWarnings('xx', 'canoe,kayak,portage', 'Paddlelog', 'Lake trips', 'SPORTS')
    ).toEqual([]);
  });
});

describe('readImageInfo', () => {
  it('reads a PNG header and its alpha channel', () => {
    expect(readImageInfo(png(1320, 2868, 2))).toEqual({
      width: 1320,
      height: 2868,
      hasAlpha: false,
    });
    expect(readImageInfo(png(512, 512, 6))?.hasAlpha).toBe(true);
    expect(readImageInfo(png(512, 512, 4))?.hasAlpha).toBe(true);
  });

  it('reads a JPEG frame header past the segments before it', () => {
    expect(readImageInfo(jpeg(1080, 1920))).toEqual({ width: 1080, height: 1920, hasAlpha: false });
  });

  it('reads nothing from a file that is neither', () => {
    expect(readImageInfo(Buffer.from('not an image'))).toBeNull();
  });
});

describe('imageErrors', () => {
  const phone = { width: 1080, height: 1920 };

  it('refuses a wrong size and an alpha channel where the store forbids one', () => {
    expect(imageErrors('android', 'xx', 'a.png', png(720, 1584, 2), phone, false)).toEqual([
      expect.objectContaining({ type: 'image_size' }),
    ]);
    expect(imageErrors('android', 'xx', 'a.png', png(1080, 1920, 6), phone, false)).toEqual([
      expect.objectContaining({ type: 'image_alpha' }),
    ]);
    expect(imageErrors('android', 'xx', 'a.png', Buffer.from('x'), phone, false)).toEqual([
      expect.objectContaining({ type: 'image_unreadable' }),
    ]);
  });

  it('accepts an exact size, and alpha where it is allowed', () => {
    expect(imageErrors('android', 'xx', 'a.png', png(1080, 1920, 2), phone, false)).toEqual([]);
    expect(imageErrors('android', 'xx', 'a.png', png(1080, 1920, 6), phone, true)).toEqual([]);
  });
});

describe('screenshotErrors', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-shots-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, data: Buffer) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }

  it('is quiet about an absent tree unless screenshots are required', () => {
    const dirs = { metadataDir: path.join(root, 'metadata'), screenshotsDir: path.join(root, 's') };
    expect(screenshotErrors('ios', 'xx', dirs, false)).toEqual([]);
    expect(screenshotErrors('ios', 'xx', dirs, true).map((e) => e.type)).toEqual([
      'missing_screenshots',
    ]);
    expect(screenshotErrors('android', 'xx', dirs, true).map((e) => e.type)).toEqual([
      'missing_screenshots',
      'missing_screenshots',
    ]);
  });

  it('holds a present Play tree to its counts and sizes', () => {
    const dirs = { metadataDir: path.join(root, 'metadata'), screenshotsDir: path.join(root, 's') };
    write('metadata/android/xx/images/phoneScreenshots/1.png', png(1080, 1920, 2));
    expect(screenshotErrors('android', 'xx', dirs, false).map((e) => e.type)).toEqual([
      'screenshot_count',
    ]);
    write('metadata/android/xx/images/phoneScreenshots/2.png', png(720, 1584, 2));
    write('metadata/android/xx/images/featureGraphic.png', png(1024, 500, 2));
    write('metadata/android/xx/images/icon.png', png(512, 512, 6));
    expect(screenshotErrors('android', 'xx', dirs, true).map((e) => e.type)).toEqual([
      'image_size',
    ]);
  });

  it('requires the iPad class beside the iPhone set at release', () => {
    const dirs = { metadataDir: path.join(root, 'metadata'), screenshotsDir: path.join(root, 's') };
    write('s/xx/01-feed.png', png(1320, 2868, 2));
    expect(screenshotErrors('ios', 'xx', dirs, false)).toEqual([]);
    expect(screenshotErrors('ios', 'xx', dirs, true).map((e) => e.type)).toEqual([
      'missing_screenshots',
    ]);
    write('s/xx/ipad-01-feed.png', png(2064, 2752, 2));
    expect(screenshotErrors('ios', 'xx', dirs, true)).toEqual([]);
  });
});

describe('listingBudgetErrors', () => {
  const section = (title: string, body: string) => `${title}\n${body}`;
  const listing = (bodies: string[]) =>
    [
      'Opening line.',
      ...['Record', 'Insights', 'Maps', 'Routes', 'Charts', 'Fitness', 'Strength', 'Widgets'].map(
        (t, i) => section(t, bodies[i] ?? 'Short line.')
      ),
      section('Notifications', 'Short line.'),
      section('Backups', 'Short line.'),
      section('Privacy', 'Short line.'),
      'Closing line.',
    ].join('\n\n');

  it('passes a listing of short feature lines', () => {
    expect(listingBudgetErrors('en-AU', listing([]))).toEqual([]);
  });

  it('refuses one feature section that has grown into a paragraph', () => {
    const errors = listingBudgetErrors('en-AU', listing(['x'.repeat(121)]));
    expect(errors.map((e) => e.type)).toEqual(['over_budget']);
    expect(errors[0]?.message).toContain('Record');
  });

  it('accepts a feature line at the ceiling', () => {
    expect(listingBudgetErrors('en-AU', listing(['x'.repeat(120)]))).toEqual([]);
  });

  it('refuses a description that has grown back toward the store limit', () => {
    const long = Array.from({ length: 8 }, () => 'x'.repeat(120));
    const text = `${listing(long)}\n\n${'y'.repeat(500)}`;
    expect(listingBudgetErrors('en-AU', text).map((e) => e.message)).toEqual([
      expect.stringContaining('description'),
    ]);
  });

  it('gives a longer language a larger ceiling than English and a denser one a smaller', () => {
    const line = 'x'.repeat(150);
    expect(listingBudgetErrors('en-AU', listing([line])).length).toBe(1);
    expect(listingBudgetErrors('de-DE', listing([line]))).toEqual([]);
    expect(listingBudgetErrors('zh-Hans', listing(['x'.repeat(80)])).length).toBe(1);
  });

  it('reads a Play description whose section titles are bold', () => {
    const bold = listing(['x'.repeat(121)]).replace(/^(Record)$/m, '<b>$1</b>');
    expect(listingBudgetErrors('en-AU', bold).map((e) => e.type)).toEqual(['over_budget']);
  });
});

describe('listingFloorErrors', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-floor-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, text: string) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }

  const floors = { ios: '16.4', android: '7.0' };

  it('refuses an iOS description that leaves out the floor and passes one that names it', () => {
    write('ios/en-AU/description.txt', 'Closing line.\n\nRequires iOS 16.4 or later.');
    write('ios/de-DE/description.txt', 'Schlusszeile.\n\nNennt keine Version.');
    expect(listingFloorErrors(root, floors).map((e) => [e.platform, e.locale, e.type])).toEqual([
      ['ios', 'de-DE', 'floor_not_stated'],
    ]);
  });

  it('holds each Play full description to the Android floor the same way', () => {
    write('android/en-AU/full_description.txt', 'Requires Android 7.0 or later.');
    write('android/de-DE/full_description.txt', 'Nennt keine Version.');
    expect(listingFloorErrors(root, floors).map((e) => [e.platform, e.locale, e.type])).toEqual([
      ['android', 'de-DE', 'floor_not_stated'],
    ]);
  });

  it('is quiet about a locale with no description on disk, which the field check reports', () => {
    expect(listingFloorErrors(root, floors)).toEqual([]);
  });

  it('reads both floors from the expo-build-properties plugin in app.json', () => {
    expect(
      storeFloors({
        expo: {
          plugins: [
            'expo-notifications',
            [
              'expo-build-properties',
              { android: { minSdkVersion: 24 }, ios: { deploymentTarget: '16.4' } },
            ],
          ],
        },
      })
    ).toEqual({ ios: '16.4', android: '7.0' });
  });

  it('refuses an app.json that states no iOS deployment target or an unnamed Android level', () => {
    expect(() => storeFloors({ expo: { plugins: [] } })).toThrow('deploymentTarget');
    expect(() =>
      storeFloors({
        expo: {
          plugins: [
            [
              'expo-build-properties',
              { android: { minSdkVersion: 99 }, ios: { deploymentTarget: '16.4' } },
            ],
          ],
        },
      })
    ).toThrow('99');
  });
});

describe('the repository listings', () => {
  it('pass every field limit and deliver file check', () => {
    expect(validateMetadata().map((e) => e.message)).toEqual([]);
  });

  it('carry an App Store listing for every store locale, en-CA included', () => {
    expect(uniqueStoreLocales('ios')).toContain('en-CA');
  });
});
