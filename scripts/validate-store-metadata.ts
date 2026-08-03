#!/usr/bin/env npx tsx
/**
 * Validates store metadata against each store's field rules.
 *
 * Checks:
 * 1. All app locales have corresponding store locale directories
 * 2. All required metadata files exist and are non-empty
 * 3. Changelog exists for the current version code
 * 4. Field lengths sit inside each store's published limits
 * 5. Apple keyword rules: no repeats of name, subtitle or category words
 * 6. Global deliver files (copyright, categories, review notes, URLs)
 * 7. Screenshot trees hold the exact store resolutions, no stray alpha
 *
 * Usage:
 *   npx tsx scripts/validate-store-metadata.ts [--version-code <code>] [--require-screenshots]
 *
 * Screenshot trees are validated whenever they exist. --require-screenshots
 * additionally errors when they are absent, for release-time use.
 *
 * Exit codes:
 *   0 = All validations passed (warnings allowed)
 *   1 = Validation errors found
 */

import * as fs from 'fs';
import * as path from 'path';

import { LOCALE_MAPPINGS, uniqueStoreLocales } from './store-locales';

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FASTLANE_DIR = path.join(PROJECT_ROOT, 'config', 'fastlane');
const METADATA_DIR = path.join(FASTLANE_DIR, 'metadata');
const SCREENSHOTS_DIR = path.join(FASTLANE_DIR, 'screenshots');
const APP_LOCALES_DIR = path.join(PROJECT_ROOT, 'src', 'i18n', 'locales');

const ANDROID_REQUIRED_FILES = [
  'title.txt',
  'short_description.txt',
  'full_description.txt',
];

const IOS_REQUIRED_FILES = [
  'name.txt',
  'subtitle.txt',
  'description.txt',
  'keywords.txt',
  'promotional_text.txt',
  'release_notes.txt',
];

// Non-localised deliver files under metadata/ios/.
const IOS_GLOBAL_FILES = [
  'copyright.txt',
  'primary_category.txt',
  'secondary_category.txt',
  path.join('review_information', 'notes.txt'),
];

// Localised URL files deliver reads per locale.
const IOS_URL_FILES = ['privacy_url.txt', 'support_url.txt', 'marketing_url.txt'];

// Store field limits. Apple documents the keyword field as 100 characters;
// the widely repeated byte figure is vendor-only, so bytes over 100 warn
// rather than fail (it only bites on CJK and accented locales).
const LIMITS: Record<'android' | 'ios', Record<string, number>> = {
  android: {
    'title.txt': 30,
    'short_description.txt': 80,
    'full_description.txt': 4000,
  },
  ios: {
    'name.txt': 30,
    'subtitle.txt': 30,
    'keywords.txt': 100,
    'description.txt': 4000,
    'promotional_text.txt': 170,
    'release_notes.txt': 4000,
  },
};
const CHANGELOG_LIMIT = 500;

const SINGLE_LINE_FILES = new Set([
  'title.txt',
  'short_description.txt',
  'name.txt',
  'subtitle.txt',
  'keywords.txt',
  'promotional_text.txt',
]);

// Category names count as indexed words on Apple, so keywords must not
// repeat them either.
const CATEGORY_WORDS: Record<string, string[]> = {
  HEALTH_AND_FITNESS: ['health', 'fitness'],
  SPORTS: ['sports', 'sport'],
};

// Exact store pixel sizes. Anything else in a tree is a mistake.
const APPSTORE_PHONE = { width: 1320, height: 2868 };
const APPSTORE_IPAD = { width: 2064, height: 2752 };
const PLAY_PHONE = { width: 1080, height: 1920 };
const PLAY_FEATURE = { width: 1024, height: 500 };
const PLAY_ICON = { width: 512, height: 512 };

// ============================================================================
// Image headers
// ============================================================================

interface ImageInfo {
  width: number;
  height: number;
  hasAlpha: boolean;
}

function readImageInfo(filePath: string): ImageInfo | null {
  const buf = fs.readFileSync(filePath);
  // PNG: IHDR width/height at bytes 16..23, colour type at 25.
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47) {
    const colourType = buf[25];
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      hasAlpha: colourType === 4 || colourType === 6,
    };
  }
  // JPEG: walk markers to the first SOF frame header.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        return {
          height: buf.readUInt16BE(off + 5),
          width: buf.readUInt16BE(off + 7),
          hasAlpha: false,
        };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return null;
}

// ============================================================================
// Validation
// ============================================================================

interface Issue {
  platform: 'android' | 'ios';
  locale: string;
  message: string;
}

const errors: Issue[] = [];
const warnings: Issue[] = [];

function codePoints(text: string): number {
  return [...text.trim()].length;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1)
  );
}

function getAppLocales(): string[] {
  return fs
    .readdirSync(APP_LOCALES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

function getVersionCodeFromAppJson(): number | null {
  const appJsonPath = path.join(PROJECT_ROOT, 'app.json');
  if (!fs.existsSync(appJsonPath)) return null;
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
  return appJson?.expo?.android?.versionCode || null;
}

function readIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

function checkTextFile(
  platform: 'android' | 'ios',
  locale: string,
  localeDir: string,
  file: string,
  limitOverride?: number
): string | null {
  const filePath = path.join(localeDir, file);
  const raw = readIfExists(filePath);
  const label = `${platform}/${locale}/${file}`;
  if (raw === null) {
    errors.push({ platform, locale, message: `Missing: ${label}` });
    return null;
  }
  if (raw.trim() === '') {
    errors.push({ platform, locale, message: `Empty: ${label}` });
    return null;
  }
  const limit = limitOverride ?? LIMITS[platform][file];
  if (limit) {
    const count = codePoints(raw);
    if (count > limit) {
      errors.push({
        platform,
        locale,
        message: `Over limit: ${label} is ${count} chars, limit ${limit}`,
      });
    }
  }
  if (SINGLE_LINE_FILES.has(file) && raw !== raw.trim()) {
    warnings.push({
      platform,
      locale,
      message: `Trailing whitespace: ${label}`,
    });
  }
  return raw.trim();
}

function checkKeywords(locale: string, localeDir: string, keywords: string) {
  const label = `ios/${locale}/keywords.txt`;
  const bytes = Buffer.byteLength(keywords, 'utf8');
  if (bytes > 100 && codePoints(keywords) <= 100) {
    warnings.push({
      platform: 'ios',
      locale,
      message: `Keywords are ${bytes} bytes: ${label} may overflow if the limit is enforced in bytes`,
    });
  }
  if (/,\s/.test(keywords)) {
    warnings.push({
      platform: 'ios',
      locale,
      message: `Space after comma wastes characters: ${label}`,
    });
  }

  // Apple indexes name, subtitle, keywords and category as one pool, so a
  // word placed twice is a wasted word.
  const name = readIfExists(path.join(localeDir, 'name.txt')) ?? '';
  const subtitle = readIfExists(path.join(localeDir, 'subtitle.txt')) ?? '';
  const category =
    readIfExists(path.join(METADATA_DIR, 'ios', 'primary_category.txt'))?.trim() ?? '';
  const pool = words(`${name} ${subtitle}`);
  for (const w of CATEGORY_WORDS[category] ?? []) pool.add(w);

  const seen = new Set<string>();
  for (const term of keywords.split(',')) {
    for (const w of words(term)) {
      if (pool.has(w)) {
        warnings.push({
          platform: 'ios',
          locale,
          message: `Keyword '${w}' repeats a name, subtitle or category word: ${label}`,
        });
      }
      if (seen.has(w)) {
        warnings.push({
          platform: 'ios',
          locale,
          message: `Keyword '${w}' appears twice: ${label}`,
        });
      }
      seen.add(w);
    }
  }
}

function checkImage(
  platform: 'android' | 'ios',
  locale: string,
  filePath: string,
  expected: { width: number; height: number },
  allowAlpha: boolean
) {
  const label = path.relative(FASTLANE_DIR, filePath);
  const info = readImageInfo(filePath);
  if (!info) {
    errors.push({ platform, locale, message: `Unreadable image: ${label}` });
    return;
  }
  if (info.width !== expected.width || info.height !== expected.height) {
    errors.push({
      platform,
      locale,
      message: `Wrong size: ${label} is ${info.width}x${info.height}, expected ${expected.width}x${expected.height}`,
    });
  }
  if (info.hasAlpha && !allowAlpha) {
    errors.push({
      platform,
      locale,
      message: `Alpha channel not allowed: ${label}`,
    });
  }
}

function imageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function validateIosScreenshots(locale: string, require: boolean) {
  const dir = path.join(SCREENSHOTS_DIR, locale);
  if (!fs.existsSync(dir)) {
    if (require) {
      errors.push({
        platform: 'ios',
        locale,
        message: `Missing screenshot tree: screenshots/${locale}`,
      });
    }
    return;
  }
  const files = imageFiles(dir);
  const ipad = files.filter((f) => path.basename(f).startsWith('ipad-'));
  const phone = files.filter((f) => !path.basename(f).startsWith('ipad-'));
  if (phone.length < 1 || phone.length > 10) {
    errors.push({
      platform: 'ios',
      locale,
      message: `Expected 1-10 iPhone screenshots in screenshots/${locale}, found ${phone.length}`,
    });
  }
  // supportsTablet is true, so the iPad class is required alongside the phone.
  if (require && ipad.length < 1) {
    errors.push({
      platform: 'ios',
      locale,
      message: `Missing iPad screenshots in screenshots/${locale}`,
    });
  }
  for (const f of phone) checkImage('ios', locale, f, APPSTORE_PHONE, false);
  for (const f of ipad) checkImage('ios', locale, f, APPSTORE_IPAD, false);
}

function validatePlayImages(locale: string, localeDir: string, require: boolean) {
  const imagesDir = path.join(localeDir, 'images');
  const phoneDir = path.join(imagesDir, 'phoneScreenshots');
  const phone = imageFiles(phoneDir);
  const feature = imageFiles(imagesDir).filter((f) =>
    path.basename(f).startsWith('featureGraphic')
  );
  const icon = path.join(imagesDir, 'icon.png');

  if (!fs.existsSync(phoneDir)) {
    if (require) {
      errors.push({
        platform: 'android',
        locale,
        message: `Missing phone screenshots: android/${locale}/images/phoneScreenshots`,
      });
    }
  } else if (phone.length < 2 || phone.length > 8) {
    errors.push({
      platform: 'android',
      locale,
      message: `Expected 2-8 phone screenshots for android/${locale}, found ${phone.length}`,
    });
  }
  for (const f of phone) checkImage('android', locale, f, PLAY_PHONE, false);

  if (feature.length === 0) {
    if (require) {
      errors.push({
        platform: 'android',
        locale,
        message: `Missing feature graphic: android/${locale}/images/featureGraphic`,
      });
    }
  } else {
    for (const f of feature) checkImage('android', locale, f, PLAY_FEATURE, false);
  }

  // Alpha is allowed on the hi-res icon, unlike every other Play asset.
  if (fs.existsSync(icon)) checkImage('android', locale, icon, PLAY_ICON, true);
}

function validate(versionCode: number | undefined, requireScreenshots: boolean) {
  const appLocales = getAppLocales();
  const mappedAppLocales = new Set(LOCALE_MAPPINGS.map((m) => m.app));
  for (const locale of appLocales) {
    if (!mappedAppLocales.has(locale)) {
      console.warn(`Warning: App locale '${locale}' has no store mapping defined`);
    }
  }

  // Android
  for (const locale of uniqueStoreLocales('android')) {
    const localeDir = path.join(METADATA_DIR, 'android', locale);
    if (!fs.existsSync(localeDir)) {
      errors.push({
        platform: 'android',
        locale,
        message: `Android locale directory missing: ${locale}`,
      });
      continue;
    }
    for (const file of ANDROID_REQUIRED_FILES) {
      checkTextFile('android', locale, localeDir, file);
    }
    if (versionCode) {
      checkTextFile(
        'android',
        locale,
        localeDir,
        path.join('changelogs', `${versionCode}.txt`),
        CHANGELOG_LIMIT
      );
    }
    validatePlayImages(locale, localeDir, requireScreenshots);
  }

  // iOS
  for (const locale of uniqueStoreLocales('ios')) {
    const localeDir = path.join(METADATA_DIR, 'ios', locale);
    if (!fs.existsSync(localeDir)) {
      errors.push({
        platform: 'ios',
        locale,
        message: `iOS locale directory missing: ${locale}`,
      });
      continue;
    }
    for (const file of IOS_REQUIRED_FILES) {
      checkTextFile('ios', locale, localeDir, file);
    }
    for (const file of IOS_URL_FILES) {
      checkTextFile('ios', locale, localeDir, file);
    }
    const keywords = readIfExists(path.join(localeDir, 'keywords.txt'));
    if (keywords && keywords.trim()) checkKeywords(locale, localeDir, keywords.trim());
    validateIosScreenshots(locale, requireScreenshots);
  }

  // Global deliver files
  for (const file of IOS_GLOBAL_FILES) {
    const filePath = path.join(METADATA_DIR, 'ios', file);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf-8').trim() === '') {
      errors.push({
        platform: 'ios',
        locale: '(global)',
        message: `Missing or empty: ios/${file}`,
      });
    }
  }
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
let versionCode: number | undefined;
const versionCodeIdx = args.indexOf('--version-code');
if (versionCodeIdx !== -1 && args[versionCodeIdx + 1]) {
  versionCode = parseInt(args[versionCodeIdx + 1], 10);
}
const requireScreenshots = args.includes('--require-screenshots');

console.log('Validating store metadata...\n');

const detectedVersionCode = versionCode || getVersionCodeFromAppJson() || undefined;
if (detectedVersionCode) {
  console.log(`Version code: ${detectedVersionCode}\n`);
}

validate(detectedVersionCode, requireScreenshots);

for (const platform of ['android', 'ios'] as const) {
  const platformWarnings = warnings.filter((w) => w.platform === platform);
  if (platformWarnings.length > 0) {
    console.log(`${platform} warnings:`);
    for (const w of platformWarnings) console.log(`  - ${w.message}`);
    console.log('');
  }
}

if (errors.length === 0) {
  console.log('✓ All store metadata validations passed\n');
  console.log(`Android: ${uniqueStoreLocales('android').length} locales`);
  console.log(`iOS: ${uniqueStoreLocales('ios').length} locales`);
  process.exit(0);
} else {
  console.log(`✗ Found ${errors.length} validation error(s):\n`);
  for (const platform of ['android', 'ios'] as const) {
    const platformErrors = errors.filter((e) => e.platform === platform);
    if (platformErrors.length > 0) {
      console.log(`${platform}:`);
      for (const err of platformErrors) console.log(`  - ${err.message}`);
      console.log('');
    }
  }
  console.log('Fix these issues before releasing.');
  console.log('Edit the affected files under config/fastlane/metadata/.');
  console.log('Regenerate store images: npm run store:render && npm run store:install');
  process.exit(1);
}
