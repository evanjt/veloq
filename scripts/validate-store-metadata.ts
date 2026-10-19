#!/usr/bin/env npx tsx
/**
 * Validates that all store metadata locales match app i18n locales.
 *
 * Checks:
 * 1. All app locales have corresponding store locale directories
 * 2. All required metadata files exist for each locale
 * 3. Changelog exists for current version code
 * 4. Android changelogs fit Google Play's 500-character cap
 * 5. No description makes a claim the app or the privacy policy contradicts
 *
 * Usage:
 *   npx tsx scripts/validate-store-metadata.ts [--version-code <code>]
 *
 * Exit codes:
 *   0 = All validations passed
 *   1 = Validation errors found
 */

import * as fs from 'fs';
import * as path from 'path';

import { PLAY_CHANGELOG_MAX_CHARS, changelogCharCount } from './store-release';

export { PLAY_CHANGELOG_MAX_CHARS, changelogCharCount };

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FASTLANE_DIR = path.join(PROJECT_ROOT, 'config', 'fastlane');
const METADATA_DIR = path.join(FASTLANE_DIR, 'metadata');
const APP_LOCALES_DIR = path.join(PROJECT_ROOT, 'src', 'i18n', 'locales');

// Required files per platform
const ANDROID_REQUIRED_FILES = ['title.txt', 'short_description.txt', 'full_description.txt'];

const IOS_REQUIRED_FILES = [
  'name.txt',
  'subtitle.txt',
  'description.txt',
  'keywords.txt',
  'release_notes.txt',
];

// Locale mapping from app locale files to store locale codes
interface LocaleMapping {
  app: string;
  android: string;
  ios: string;
}

const LOCALE_MAPPINGS: LocaleMapping[] = [
  { app: 'en-US', android: 'en-US', ios: 'en-US' },
  { app: 'en-AU', android: 'en-AU', ios: 'en-AU' },
  { app: 'en-GB', android: 'en-GB', ios: 'en-GB' },
  { app: 'de-DE', android: 'de-DE', ios: 'de-DE' },
  // Swiss German variants: de-CH is NOT a valid store locale for either platform
  // Use de-DE for both Android and iOS
  { app: 'de-CH', android: 'de-DE', ios: 'de-DE' },
  { app: 'es', android: 'es-ES', ios: 'es-ES' },
  { app: 'es-ES', android: 'es-ES', ios: 'es-ES' },
  { app: 'es-419', android: 'es-419', ios: 'es-MX' },
  { app: 'fr', android: 'fr-FR', ios: 'fr-FR' },
  { app: 'it', android: 'it-IT', ios: 'it' },
  { app: 'nl', android: 'nl-NL', ios: 'nl-NL' },
  { app: 'pt', android: 'pt-PT', ios: 'pt-PT' },
  { app: 'pt-BR', android: 'pt-BR', ios: 'pt-BR' },
  { app: 'pl', android: 'pl-PL', ios: 'pl' },
  { app: 'da', android: 'da-DK', ios: 'da' },
  { app: 'ja', android: 'ja-JP', ios: 'ja' },
  { app: 'zh-Hans', android: 'zh-CN', ios: 'zh-Hans' },
];

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

interface ValidationError {
  type:
    | 'missing_locale'
    | 'missing_file'
    | 'missing_changelog'
    | 'empty_file'
    | 'changelog_too_long'
    | 'unsupported_claim';
  platform: 'android' | 'ios';
  locale: string;
  file?: string;
  message: string;
}

function claimErrors(platform: 'android' | 'ios', locale: string, file: string): ValidationError[] {
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

function getAppLocales(): string[] {
  const files = fs.readdirSync(APP_LOCALES_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
}

function getUniqueStoreLocales(platform: 'android' | 'ios'): string[] {
  const locales = LOCALE_MAPPINGS.map((m) => m[platform]);
  return [...new Set(locales)];
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

  for (const locale of getUniqueStoreLocales('android')) {
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

export function validateMetadata(versionCode?: number): ValidationError[] {
  const errors: ValidationError[] = [];

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
  const androidLocales = getUniqueStoreLocales('android');
  for (const locale of androidLocales) {
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

    // Check required files
    for (const file of ANDROID_REQUIRED_FILES) {
      const filePath = path.join(localeDir, file);
      if (!fs.existsSync(filePath)) {
        errors.push({
          type: 'missing_file',
          platform: 'android',
          locale,
          file,
          message: `Missing: android/${locale}/${file}`,
        });
      } else if (fs.readFileSync(filePath, 'utf-8').trim() === '') {
        errors.push({
          type: 'empty_file',
          platform: 'android',
          locale,
          file,
          message: `Empty: android/${locale}/${file}`,
        });
      }
    }

    errors.push(...claimErrors('android', locale, 'full_description.txt'));

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
  }

  // Validate iOS metadata
  const iosLocales = getUniqueStoreLocales('ios');
  for (const locale of iosLocales) {
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

    // Check required files
    for (const file of IOS_REQUIRED_FILES) {
      const filePath = path.join(localeDir, file);
      if (!fs.existsSync(filePath)) {
        errors.push({
          type: 'missing_file',
          platform: 'ios',
          locale,
          file,
          message: `Missing: ios/${locale}/${file}`,
        });
      } else if (fs.readFileSync(filePath, 'utf-8').trim() === '') {
        errors.push({
          type: 'empty_file',
          platform: 'ios',
          locale,
          file,
          message: `Empty: ios/${locale}/${file}`,
        });
      }
    }

    errors.push(...claimErrors('ios', locale, 'description.txt'));
  }

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

  console.log('Validating store metadata...\n');

  const detectedVersionCode = versionCode || getVersionCodeFromAppJson();
  if (detectedVersionCode) {
    console.log(`Version code: ${detectedVersionCode}\n`);
  }

  // The sweep covers the current version code too, so dedupe by message
  // rather than reporting that one file twice.
  const seen = new Set<string>();
  const errors = [...validateMetadata(versionCode), ...oversizedChangelogs()].filter(
    (e) => !seen.has(e.message) && seen.add(e.message)
  );

  if (errors.length === 0) {
    console.log('✓ All store metadata validations passed\n');

    // Summary
    const androidLocales = getUniqueStoreLocales('android');
    const iosLocales = getUniqueStoreLocales('ios');
    console.log(`Android: ${androidLocales.length} locales`);
    console.log(`iOS: ${iosLocales.length} locales`);

    process.exit(0);
  } else {
    console.log(`✗ Found ${errors.length} validation error(s):\n`);

    // Group by platform
    const androidErrors = errors.filter((e) => e.platform === 'android');
    const iosErrors = errors.filter((e) => e.platform === 'ios');

    if (androidErrors.length > 0) {
      console.log('Android:');
      for (const err of androidErrors) {
        console.log(`  - ${err.message}`);
      }
      console.log('');
    }

    if (iosErrors.length > 0) {
      console.log('iOS:');
      for (const err of iosErrors) {
        console.log(`  - ${err.message}`);
      }
      console.log('');
    }

    console.log('Fix these issues before releasing.');
    console.log('Run: npx tsx scripts/store-metadata.ts sync-metadata');
    console.log(
      `Run: npx tsx scripts/store-metadata.ts changelog ${detectedVersionCode || '<version>'}`
    );

    process.exit(1);
  }
}
