#!/usr/bin/env npx tsx
/**
 * Validates store metadata against each store's field rules.
 *
 * Checks:
 * 1. All app locales have corresponding store locale directories
 * 2. All required metadata files exist and are non-empty
 * 3. Changelog exists for current version code
 * 4. Android changelogs fit Google Play's 500-character cap
 * 5. No description makes a claim the app or the privacy policy contradicts
 * 6. Field lengths sit inside each store's published limits
 * 7. Apple keyword rules: no repeats of name, subtitle or category words
 * 8. Global deliver files (copyright, categories, review notes, URLs)
 * 9. Screenshot trees hold the exact store resolutions, no stray alpha
 * 10. Each listing states the OS floor the build ships with
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

import { FEATURE_CARDS, listingSections } from './site-copy';
import { LOCALE_MAPPINGS, uniqueStoreLocales } from './store-locales';
import { PLAY_CHANGELOG_MAX_CHARS, changelogCharCount } from './store-release';

export { PLAY_CHANGELOG_MAX_CHARS, changelogCharCount };

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FASTLANE_DIR = path.join(PROJECT_ROOT, 'config', 'fastlane');
const METADATA_DIR = path.join(FASTLANE_DIR, 'metadata');
const SCREENSHOTS_DIR = path.join(FASTLANE_DIR, 'screenshots');
const APP_LOCALES_DIR = path.join(PROJECT_ROOT, 'src', 'i18n', 'locales');

// Required files per platform
const ANDROID_REQUIRED_FILES = ['title.txt', 'short_description.txt', 'full_description.txt'];

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

// Store field limits in characters. Apple documents the keyword field as 100
// characters; the byte figure is repeated only by third parties, so bytes
// over 100 warn rather than fail (it only bites on CJK and accented locales).
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

/** How many phone screenshots each store takes in a locale. */
export const PLAY_PHONE_SHOTS = { min: 2, max: 8 };
export const APPSTORE_PHONE_SHOTS = { min: 1, max: 10 };
const PLAY_PHONE = { width: 1080, height: 1920 };
const PLAY_FEATURE = { width: 1024, height: 500 };

// ============================================================================
// Validation
// ============================================================================

/**
 * A claim a store description or the privacy policy must not make, in the
 * wording each locale used for it. A tag push uploads these texts to both
 * stores, so a claim the app or the privacy policy contradicts is published
 * with the release.
 */
interface ListingClaim {
  claim: string;
  reason: string;
  phrases: string[];
}

export const UNSUPPORTED_LISTING_CLAIMS: ListingClaim[] = [
  {
    claim: 'form advice',
    reason: 'no insight kind gives advice: insights state the numbers and do not coach',
    phrases: [
      'form advice',
      'formrådgivning',
      'Formtipps',
      'consejos de forma',
      'conseils de forme',
      'consigli sulla forma',
      'コンディションのアドバイス',
      'vormadvies',
      'porady dotyczące formy',
      'orientações sobre forma',
      '状态建议',
    ],
  },
  {
    claim: 'activity patterns',
    reason: 'no insight kind detects activity patterns',
    phrases: [
      'activity patterns',
      'aktivitetsmønstre',
      'Aktivitätsmuster',
      'patrones de actividad',
      "tendances d'activite",
      'pattern di attivit',
      'アクティビティパターン',
      'activiteitspatronen',
      'wzorce aktywności',
      'padrões de atividade',
      '活动模式',
    ],
  },
  {
    claim: 'positive framing',
    reason: 'insights report a decline as plainly as an improvement, with no encouragement added',
    phrases: [
      'Positive, rest-day-aware',
      'Positiv, hviledagsbevidst',
      'Positiv formuliert',
      'Enfoque positivo',
      'Un ton toujours positif',
      'Sempre positivi',
      'ポジティブ',
      'Positieve, rustdag-bewuste',
      'Pozytywne komunikaty',
      'Enquadramento positivo',
      '积极正向',
    ],
  },
  {
    claim: 'no personal data kept',
    reason: 'push registration stores the athlete id, as the privacy policy says',
    phrases: [
      'no personal data',
      'nothing personal',
      'ingen personlige data',
      'keine persönlichen Daten',
      'ohne persönliche Daten',
      'no se conservan datos personales',
      'sin datos personales',
      'aucune donnee personnelle',
      'aucune donnée personnelle',
      'nessun dato personale',
      'senza dati personali',
      '個人データは保持されません',
      '個人情報は含みません',
      'geen persoonlijke gegevens',
      'zonder persoonlijke gegevens',
      'żadne dane osobowe',
      'bez danych osobowych',
      'nenhum dado pessoal',
      'sem dados pessoais',
      '不保留任何个人数据',
      '不含任何个人信息',
    ],
  },
  {
    claim: 'no data collected',
    reason:
      'push registration keeps the athlete id and the sign-in worker keeps the IP address ' +
      'for rate limiting, as the privacy policy says',
    phrases: [
      'no data is collected',
      'no data collection',
      'telemetry or data collection',
      'no se recopilan datos',
      'ni recopilación de datos',
      'ni recopilacion de datos',
      "aucune donnée n'est collectée",
      "aucune donnee n'est collectee",
      'ni collecte de données',
      'ni collecte de donnees',
    ],
  },
  {
    claim: 'no identifying data sent',
    reason: 'every map tile request carries the device IP address and the tile coordinates',
    phrases: [
      'no identifying data',
      'sin datos identificativos',
      'sin datos identificables',
      'aucune donnée identifiante',
      'aucune donnee identifiante',
      'sans données identifiantes',
      'sans donnees identifiantes',
    ],
  },
  {
    claim: 'accessibility conformance',
    reason: 'the listing describes what the app supports and claims conformance to no standard',
    phrases: [
      'WCAG',
      'EN 301 549',
      'fully accessible',
      'fuldt tilgængelig',
      'vollständig barrierefrei',
      'totalmente accesible',
      'entièrement accessible',
      'entierement accessible',
      'totalement accessible',
      'completamente accessibile',
      'pienamente accessibile',
      '完全にアクセシブル',
      'アクセシビリティに完全対応',
      'volledig toegankelijk',
      'w pełni dostępn',
      'totalmente acessível',
      'totalmente acessivel',
      '完全无障碍',
    ],
  },
];

/** The unsupported claims a description's text makes, by claim name. */
export function unsupportedClaimsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return UNSUPPORTED_LISTING_CLAIMS.filter((c) =>
    c.phrases.some((p) => lower.includes(p.toLowerCase()))
  ).map((c) => c.claim);
}

type Platform = 'android' | 'ios';

interface ValidationError {
  type:
    | 'missing_locale'
    | 'missing_file'
    | 'missing_changelog'
    | 'empty_file'
    | 'changelog_too_long'
    | 'unsupported_claim'
    | 'over_limit'
    | 'over_budget'
    | 'floor_not_stated'
    | 'missing_screenshots'
    | 'screenshot_count'
    | 'image_unreadable'
    | 'image_size'
    | 'image_alpha';
  platform: Platform;
  locale: string;
  file?: string;
  message: string;
}

// A listing is one short line per feature, so adding a feature costs one line
// and no rewrite. The ceilings sit well under the stores' 4,000 characters and
// are set for English; a language scales them by how much longer or denser
// than English it runs, keyed by the first part of the locale code.
const DESCRIPTION_BUDGET = 1600;
const FEATURE_LINE_BUDGET = 120;
const PRIVACY_LINE_BUDGET = 220;
const LENGTH_FACTOR: Record<string, number> = {
  en: 1,
  da: 1.25,
  de: 1.4,
  nl: 1.3,
  fr: 1.45,
  it: 1.35,
  es: 1.35,
  pt: 1.35,
  pl: 1.3,
  ja: 0.7,
  zh: 0.55,
};

/**
 * A description's errors against the shape budget: a ceiling on the whole
 * text and on any one feature line. Play's bold tags are not counted.
 */
export function listingBudgetErrors(locale: string, raw: string): ValidationError[] {
  const factor = LENGTH_FACTOR[locale.split('-')[0] ?? ''] ?? 1;
  const text = raw.replace(/<\/?b>/g, '');
  const errors: ValidationError[] = [];
  const at = { platform: 'ios' as Platform, locale, file: 'description' };
  const total = codePoints(text);
  const ceiling = Math.round(DESCRIPTION_BUDGET * factor);
  if (total > ceiling) {
    errors.push({
      type: 'over_budget',
      ...at,
      message: `Over budget: ${locale} description is ${total} characters, budget ${ceiling}`,
    });
  }
  listingSections(text).forEach((section, i) => {
    const isPrivacy = FEATURE_CARDS[i]?.key === 'privacy';
    const lineCeiling = Math.round(
      (isPrivacy ? PRIVACY_LINE_BUDGET : FEATURE_LINE_BUDGET) * factor
    );
    const length = codePoints(section.body);
    if (length > lineCeiling) {
      errors.push({
        type: 'over_budget',
        ...at,
        message:
          `Over budget: ${locale} feature section '${section.title}' is ${length} characters, ` +
          `budget ${lineCeiling}`,
      });
    }
  });
  return errors;
}

function claimErrors(platform: Platform, locale: string, file: string): ValidationError[] {
  const filePath = path.join(METADATA_DIR, platform, locale, file);
  if (!fs.existsSync(filePath)) return [];
  return unsupportedClaimsIn(fs.readFileSync(filePath, 'utf-8')).map((claim) => ({
    type: 'unsupported_claim',
    platform,
    locale,
    file,
    message:
      `Unsupported claim in ${platform}/${locale}/${file}: ${claim} ` +
      `(${UNSUPPORTED_LISTING_CLAIMS.find((c) => c.claim === claim)?.reason})`,
  }));
}

function budgetErrors(platform: Platform, locale: string, raw: string | null): ValidationError[] {
  if (raw === null) return [];
  return listingBudgetErrors(locale, raw).map((e) => ({
    ...e,
    platform,
    file: platform === 'ios' ? 'description.txt' : 'full_description.txt',
    message: e.message.replace('description', `${platform} description`),
  }));
}

// The build's OS floor is read from the expo-build-properties plugin in app.json,
// the one place the build takes the iOS deployment target and the Android
// minimum API level from.
interface BuildProperties {
  android?: { minSdkVersion?: number };
  ios?: { deploymentTarget?: string };
}

export interface StoreFloors {
  ios: string;
  android: string;
}

// The Android release each API level a floor can name shipped as.
const ANDROID_RELEASE: Record<number, string> = {
  21: '5.0',
  22: '5.1',
  23: '6.0',
  24: '7.0',
  25: '7.1',
  26: '8.0',
  27: '8.1',
  28: '9',
  29: '10',
  30: '11',
  31: '12',
  32: '12L',
  33: '13',
  34: '14',
  35: '15',
  36: '16',
};

/** The iOS and Android floors an app.json builds with, as the listings name them. */
export function storeFloors(appJson: {
  expo?: { plugins?: (string | [string, BuildProperties?])[] };
}): StoreFloors {
  const entry = (appJson.expo?.plugins ?? []).find(
    (p): p is [string, BuildProperties?] => Array.isArray(p) && p[0] === 'expo-build-properties'
  );
  const ios = entry?.[1]?.ios?.deploymentTarget;
  if (!ios) throw new Error('app.json states no expo-build-properties ios.deploymentTarget');
  const api = entry?.[1]?.android?.minSdkVersion;
  const android = api === undefined ? undefined : ANDROID_RELEASE[api];
  if (!android) {
    throw new Error(`app.json has no Android release for minSdkVersion ${api ?? '(unset)'}`);
  }
  return { ios, android };
}

/**
 * Each listing that does not state the build's floor. A listing that names an
 * older OS than the build installs on is published with the release that moves
 * the floor, so the text has to name the floor it ships with.
 */
export function listingFloorErrors(metadataDir: string, floors: StoreFloors): ValidationError[] {
  const checks = [
    { platform: 'ios' as const, file: 'description.txt', phrase: `iOS ${floors.ios}` },
    {
      platform: 'android' as const,
      file: 'full_description.txt',
      phrase: `Android ${floors.android}`,
    },
  ];
  return checks.flatMap(({ platform, file, phrase }) =>
    uniqueStoreLocales(platform).flatMap((locale) => {
      // An absent file is the field check's error, not this one.
      const raw = readIfExists(path.join(metadataDir, platform, locale, file));
      if (raw === null || raw.includes(phrase)) return [];
      return [
        {
          type: 'floor_not_stated' as const,
          platform,
          locale,
          file,
          message: `Floor not stated: ${platform}/${locale}/${file} does not say '${phrase}'`,
        },
      ];
    })
  );
}

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

function readIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

/** A text field's errors: missing, empty, or over the store's limit for it. */
export function textFieldErrors(
  platform: Platform,
  locale: string,
  file: string,
  raw: string | null
): ValidationError[] {
  const label = `${platform}/${locale}/${file}`;
  if (raw === null) {
    return [{ type: 'missing_file', platform, locale, file, message: `Missing: ${label}` }];
  }
  if (raw.trim() === '') {
    return [{ type: 'empty_file', platform, locale, file, message: `Empty: ${label}` }];
  }
  const limit = LIMITS[platform][file];
  const count = codePoints(raw);
  if (limit && count > limit) {
    return [
      {
        type: 'over_limit',
        platform,
        locale,
        file,
        message: `Over limit: ${label} is ${count} characters, limit ${limit}`,
      },
    ];
  }
  return [];
}

function textFieldWarnings(platform: Platform, locale: string, file: string, raw: string | null) {
  if (raw === null || !SINGLE_LINE_FILES.has(file) || raw === raw.trim()) return [];
  return [`Trailing whitespace: ${platform}/${locale}/${file}`];
}

/**
 * Keyword choices that waste the field. Apple indexes name, subtitle,
 * keywords and category as one pool, so a word placed twice is a wasted word.
 */
export function keywordWarnings(
  locale: string,
  keywords: string,
  name: string,
  subtitle: string,
  category: string
): string[] {
  const label = `ios/${locale}/keywords.txt`;
  const warnings: string[] = [];
  const bytes = Buffer.byteLength(keywords, 'utf8');
  if (bytes > 100 && codePoints(keywords) <= 100) {
    warnings.push(
      `Keywords are ${bytes} bytes: ${label} may overflow if the limit is enforced in bytes`
    );
  }
  if (/,\s/.test(keywords)) {
    warnings.push(`Space after comma wastes characters: ${label}`);
  }

  const pool = words(`${name} ${subtitle}`);
  for (const w of CATEGORY_WORDS[category] ?? []) pool.add(w);

  const seen = new Set<string>();
  for (const term of keywords.split(',')) {
    for (const w of words(term)) {
      if (pool.has(w)) {
        warnings.push(`Keyword '${w}' repeats a name, subtitle or category word: ${label}`);
      }
      if (seen.has(w)) {
        warnings.push(`Keyword '${w}' appears twice: ${label}`);
      }
      seen.add(w);
    }
  }
  return warnings;
}

interface ImageInfo {
  width: number;
  height: number;
  hasAlpha: boolean;
}

/** Width, height and alpha from a PNG or JPEG header, or null for neither. */
export function readImageInfo(buf: Buffer): ImageInfo | null {
  // PNG: IHDR width and height at bytes 16 to 23, colour type at 25.
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47) {
    const colourType = buf[25];
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      hasAlpha: colourType === 4 || colourType === 6,
    };
  }
  // JPEG: walk the segments to the first frame header.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1] ?? 0;
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
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

/** An image's errors against the exact size its store slot takes. */
export function imageErrors(
  platform: Platform,
  locale: string,
  label: string,
  buf: Buffer,
  expected: { width: number; height: number },
  allowAlpha: boolean
): ValidationError[] {
  const info = readImageInfo(buf);
  const at = { platform, locale, file: label };
  if (!info) {
    return [{ type: 'image_unreadable', ...at, message: `Unreadable image: ${label}` }];
  }
  const errors: ValidationError[] = [];
  if (info.width !== expected.width || info.height !== expected.height) {
    errors.push({
      type: 'image_size',
      ...at,
      message:
        `Wrong size: ${label} is ${info.width}x${info.height}, ` +
        `expected ${expected.width}x${expected.height}`,
    });
  }
  if (info.hasAlpha && !allowAlpha) {
    errors.push({ type: 'image_alpha', ...at, message: `Alpha channel not allowed: ${label}` });
  }
  return errors;
}

function imageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

interface StoreDirs {
  metadataDir: string;
  screenshotsDir: string;
}

function checkImages(
  platform: Platform,
  locale: string,
  root: string,
  files: string[],
  expected: { width: number; height: number }
): ValidationError[] {
  return files.flatMap((f) =>
    imageErrors(platform, locale, path.relative(root, f), fs.readFileSync(f), expected, false)
  );
}

/**
 * A locale's screenshot and graphic errors. A tree that exists is always held
 * to its store's counts and sizes; an absent one is an error only when
 * screenshots are required.
 */
export function screenshotErrors(
  platform: Platform,
  locale: string,
  dirs: StoreDirs,
  requireScreenshots: boolean
): ValidationError[] {
  const errors: ValidationError[] = [];
  const missing = (file: string, message: string) =>
    errors.push({ type: 'missing_screenshots', platform, locale, file, message });

  if (platform === 'ios') {
    const dir = path.join(dirs.screenshotsDir, locale);
    if (!fs.existsSync(dir)) {
      if (requireScreenshots) missing(locale, `Missing screenshot tree: screenshots/${locale}`);
      return errors;
    }
    const files = imageFiles(dir);
    const ipad = files.filter((f) => path.basename(f).startsWith('ipad-'));
    const phone = files.filter((f) => !path.basename(f).startsWith('ipad-'));
    if (phone.length < APPSTORE_PHONE_SHOTS.min || phone.length > APPSTORE_PHONE_SHOTS.max) {
      errors.push({
        type: 'screenshot_count',
        platform,
        locale,
        message: `Expected ${APPSTORE_PHONE_SHOTS.min}-${APPSTORE_PHONE_SHOTS.max} iPhone screenshots in screenshots/${locale}, found ${phone.length}`,
      });
    }
    // supportsTablet is true, so the iPad class is required alongside the phone.
    if (requireScreenshots && ipad.length < 1) {
      missing(locale, `Missing iPad screenshots in screenshots/${locale}`);
    }
    errors.push(...checkImages(platform, locale, dirs.screenshotsDir, phone, APPSTORE_PHONE));
    errors.push(...checkImages(platform, locale, dirs.screenshotsDir, ipad, APPSTORE_IPAD));
    return errors;
  }

  const imagesDir = path.join(dirs.metadataDir, 'android', locale, 'images');
  const phoneDir = path.join(imagesDir, 'phoneScreenshots');
  const phone = imageFiles(phoneDir);
  const feature = imageFiles(imagesDir).filter((f) =>
    path.basename(f).startsWith('featureGraphic')
  );

  if (!fs.existsSync(phoneDir)) {
    if (requireScreenshots) {
      missing(
        'images/phoneScreenshots',
        `Missing phone screenshots: android/${locale}/images/phoneScreenshots`
      );
    }
  } else if (phone.length < PLAY_PHONE_SHOTS.min || phone.length > PLAY_PHONE_SHOTS.max) {
    errors.push({
      type: 'screenshot_count',
      platform,
      locale,
      message: `Expected ${PLAY_PHONE_SHOTS.min}-${PLAY_PHONE_SHOTS.max} phone screenshots for android/${locale}, found ${phone.length}`,
    });
  }
  errors.push(...checkImages(platform, locale, dirs.metadataDir, phone, PLAY_PHONE));

  if (feature.length === 0) {
    if (requireScreenshots) {
      missing(
        'images/featureGraphic',
        `Missing feature graphic: android/${locale}/images/featureGraphic`
      );
    }
  } else {
    errors.push(...checkImages(platform, locale, dirs.metadataDir, feature, PLAY_FEATURE));
  }
  return errors;
}

function getAppLocales(): string[] {
  const files = fs.readdirSync(APP_LOCALES_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
}

function readAppJson() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf-8'));
}

function getVersionCodeFromAppJson(): number | null {
  const appJsonPath = path.join(PROJECT_ROOT, 'app.json');
  if (!fs.existsSync(appJsonPath)) return null;

  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
  return appJson?.expo?.android?.versionCode || null;
}

/**
 * Every changelog on disk that is over the cap, not only the current build's.
 *
 * `validateMetadata` reads one version code, so a file goes over the cap only
 * on the release that ships it and is never looked at again. Sixteen of them
 * had drifted over before anyone counted, and the same edit that
 * lengthens a translation for an old build lengthens it silently.
 */
export function oversizedChangelogs(): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const locale of uniqueStoreLocales('android')) {
    const changelogDir = path.join(METADATA_DIR, 'android', locale, 'changelogs');
    if (!fs.existsSync(changelogDir)) continue;

    for (const name of fs.readdirSync(changelogDir).sort()) {
      if (!name.endsWith('.txt')) continue;
      const chars = changelogCharCount(fs.readFileSync(path.join(changelogDir, name), 'utf-8'));
      if (chars > PLAY_CHANGELOG_MAX_CHARS) {
        errors.push({
          type: 'changelog_too_long',
          platform: 'android',
          locale,
          file: `changelogs/${name}`,
          message:
            `Too long: android/${locale}/changelogs/${name} is ` +
            `${chars} characters, Play allows ${PLAY_CHANGELOG_MAX_CHARS} ` +
            `(the trailing newline counts)`,
        });
      }
    }
  }

  return errors;
}

/** Warnings that do not fail the run: trailing whitespace and wasted keywords. */
export function metadataWarnings(): string[] {
  const warnings: string[] = [];
  for (const platform of ['android', 'ios'] as const) {
    const required = platform === 'android' ? ANDROID_REQUIRED_FILES : IOS_REQUIRED_FILES;
    for (const locale of uniqueStoreLocales(platform)) {
      const localeDir = path.join(METADATA_DIR, platform, locale);
      for (const file of required) {
        warnings.push(
          ...textFieldWarnings(platform, locale, file, readIfExists(path.join(localeDir, file)))
        );
      }
      if (platform !== 'ios') continue;
      const keywords = readIfExists(path.join(localeDir, 'keywords.txt'))?.trim();
      if (!keywords) continue;
      warnings.push(
        ...keywordWarnings(
          locale,
          keywords,
          readIfExists(path.join(localeDir, 'name.txt')) ?? '',
          readIfExists(path.join(localeDir, 'subtitle.txt')) ?? '',
          readIfExists(path.join(METADATA_DIR, 'ios', 'primary_category.txt'))?.trim() ?? ''
        )
      );
    }
  }
  return warnings;
}

export function validateMetadata(
  versionCode?: number,
  options: { requireScreenshots?: boolean } = {}
): ValidationError[] {
  const errors: ValidationError[] = [];
  const dirs = { metadataDir: METADATA_DIR, screenshotsDir: SCREENSHOTS_DIR };
  const requireScreenshots = options.requireScreenshots ?? false;

  // Get current version code if not specified
  if (!versionCode) {
    versionCode = getVersionCodeFromAppJson() ?? undefined;
  }

  // Check app locales have mappings
  const appLocales = getAppLocales();
  const mappedAppLocales = LOCALE_MAPPINGS.map((m) => m.app);

  for (const locale of appLocales) {
    if (!mappedAppLocales.includes(locale)) {
      console.warn(
        `Warning: App locale '${locale}' has no store mapping defined in LOCALE_MAPPINGS`
      );
    }
  }

  // Validate Android metadata
  for (const locale of uniqueStoreLocales('android')) {
    const localeDir = path.join(METADATA_DIR, 'android', locale);

    if (!fs.existsSync(localeDir)) {
      errors.push({
        type: 'missing_locale',
        platform: 'android',
        locale,
        message: `Android locale directory missing: ${locale}`,
      });
      continue;
    }

    for (const file of ANDROID_REQUIRED_FILES) {
      errors.push(
        ...textFieldErrors('android', locale, file, readIfExists(path.join(localeDir, file)))
      );
    }

    errors.push(...claimErrors('android', locale, 'full_description.txt'));
    errors.push(
      ...budgetErrors('android', locale, readIfExists(path.join(localeDir, 'full_description.txt')))
    );

    // Check changelog for current version
    if (versionCode) {
      const changelogPath = path.join(localeDir, 'changelogs', `${versionCode}.txt`);
      if (!fs.existsSync(changelogPath)) {
        errors.push({
          type: 'missing_changelog',
          platform: 'android',
          locale,
          file: `changelogs/${versionCode}.txt`,
          message: `Missing changelog: android/${locale}/changelogs/${versionCode}.txt`,
        });
      } else {
        const changelog = fs.readFileSync(changelogPath, 'utf-8');
        const chars = changelogCharCount(changelog);
        if (changelog.trim() === '') {
          errors.push({
            type: 'empty_file',
            platform: 'android',
            locale,
            file: `changelogs/${versionCode}.txt`,
            message: `Empty changelog: android/${locale}/changelogs/${versionCode}.txt`,
          });
        } else if (chars > PLAY_CHANGELOG_MAX_CHARS) {
          errors.push({
            type: 'changelog_too_long',
            platform: 'android',
            locale,
            file: `changelogs/${versionCode}.txt`,
            message:
              `Too long: android/${locale}/changelogs/${versionCode}.txt is ` +
              `${chars} characters, Play allows ${PLAY_CHANGELOG_MAX_CHARS} ` +
              `(the trailing newline counts)`,
          });
        }
      }
    }

    errors.push(...screenshotErrors('android', locale, dirs, requireScreenshots));
  }

  // Validate iOS metadata
  for (const locale of uniqueStoreLocales('ios')) {
    const localeDir = path.join(METADATA_DIR, 'ios', locale);

    if (!fs.existsSync(localeDir)) {
      errors.push({
        type: 'missing_locale',
        platform: 'ios',
        locale,
        message: `iOS locale directory missing: ${locale}`,
      });
      continue;
    }

    for (const file of [...IOS_REQUIRED_FILES, ...IOS_URL_FILES]) {
      errors.push(
        ...textFieldErrors('ios', locale, file, readIfExists(path.join(localeDir, file)))
      );
    }

    errors.push(...claimErrors('ios', locale, 'description.txt'));
    errors.push(
      ...budgetErrors('ios', locale, readIfExists(path.join(localeDir, 'description.txt')))
    );
    errors.push(...screenshotErrors('ios', locale, dirs, requireScreenshots));
  }

  // Global deliver files
  for (const file of IOS_GLOBAL_FILES) {
    errors.push(
      ...textFieldErrors(
        'ios',
        '(global)',
        file,
        readIfExists(path.join(METADATA_DIR, 'ios', file))
      )
    );
  }

  errors.push(...listingFloorErrors(METADATA_DIR, storeFloors(readAppJson())));

  return errors;
}

// ============================================================================
// CLI
// ============================================================================

// Importable for tests: only a direct run validates and exits.
if (require.main === module) {
  const args = process.argv.slice(2);
  let versionCode: number | undefined;

  const versionCodeIdx = args.indexOf('--version-code');
  if (versionCodeIdx !== -1 && args[versionCodeIdx + 1]) {
    versionCode = parseInt(args[versionCodeIdx + 1], 10);
  }
  const requireScreenshots = args.includes('--require-screenshots');

  console.log('Validating store metadata...\n');

  const detectedVersionCode = versionCode || getVersionCodeFromAppJson();
  if (detectedVersionCode) {
    console.log(`Version code: ${detectedVersionCode}\n`);
  }

  // The sweep covers the current version code too, so dedupe by message
  // rather than reporting that one file twice.
  const seen = new Set<string>();
  const errors = [
    ...validateMetadata(versionCode, { requireScreenshots }),
    ...oversizedChangelogs(),
  ].filter((e) => !seen.has(e.message) && seen.add(e.message));

  const warnings = metadataWarnings();
  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const w of warnings) console.log(`  - ${w}`);
    console.log('');
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
        console.log(`${platform === 'android' ? 'Android' : 'iOS'}:`);
        for (const err of platformErrors) console.log(`  - ${err.message}`);
        console.log('');
      }
    }

    console.log('Fix these issues before releasing.');
    console.log('Edit the affected files under config/fastlane/metadata/.');
    console.log('Regenerate store screenshots: npm run store:screenshots');
    process.exit(1);
  }
}
