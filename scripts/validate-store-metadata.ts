#!/usr/bin/env npx tsx
/**
 * Validates that all store metadata locales match app i18n locales.
 *
 * Checks:
 * 1. All app locales have corresponding store locale directories
 * 2. All required metadata files exist for each locale
 * 3. Changelog exists for current version code
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

// ============================================================================
// Configuration
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FASTLANE_DIR = path.join(PROJECT_ROOT, 'config', 'fastlane');
const METADATA_DIR = path.join(FASTLANE_DIR, 'metadata');
const APP_LOCALES_DIR = path.join(PROJECT_ROOT, 'src', 'i18n', 'locales');

// Required files per platform
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
  'release_notes.txt',
];

// Locale mapping (same as store-metadata.ts)
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
  // Swiss German variants: de-CH is NOT a valid Play Store locale (causes API errors)
  // Use de-DE for Android, de-CH for iOS only
  { app: 'de-CH', android: 'de-DE', ios: 'de-CH' },
  { app: 'de-CHB', android: 'de-DE', ios: 'de-CH' },
  { app: 'de-CHZ', android: 'de-DE', ios: 'de-CH' },
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

interface ValidationError {
  type: 'missing_locale' | 'missing_file' | 'missing_changelog' | 'empty_file';
  platform: 'android' | 'ios';
  locale: string;
  file?: string;
  message: string;
}

function getAppLocales(): string[] {
  const files = fs.readdirSync(APP_LOCALES_DIR);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
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

function validateMetadata(versionCode?: number): ValidationError[] {
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

    // Check changelog for current version
    if (versionCode) {
      const changelogPath = path.join(
        localeDir,
        'changelogs',
        `${versionCode}.txt`
      );
      if (!fs.existsSync(changelogPath)) {
        errors.push({
          type: 'missing_changelog',
          platform: 'android',
          locale,
          file: `changelogs/${versionCode}.txt`,
          message: `Missing changelog: android/${locale}/changelogs/${versionCode}.txt`,
        });
      } else if (fs.readFileSync(changelogPath, 'utf-8').trim() === '') {
        errors.push({
          type: 'empty_file',
          platform: 'android',
          locale,
          file: `changelogs/${versionCode}.txt`,
          message: `Empty changelog: android/${locale}/changelogs/${versionCode}.txt`,
        });
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
  }

  return errors;
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

console.log('Validating store metadata...\n');

const detectedVersionCode = versionCode || getVersionCodeFromAppJson();
if (detectedVersionCode) {
  console.log(`Version code: ${detectedVersionCode}\n`);
}

const errors = validateMetadata(versionCode);

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
