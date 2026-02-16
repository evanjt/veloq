#!/usr/bin/env npx tsx
/**
 * Store Metadata Management Script
 *
 * Manages localized changelogs and metadata for Google Play and App Store.
 * Uses fastlane's directory structure for automatic upload.
 *
 * Usage:
 *   npx tsx scripts/store-metadata.ts changelog <versionCode> [--translate]
 *   npx tsx scripts/store-metadata.ts sync-metadata [--translate]
 *   npx tsx scripts/store-metadata.ts list-locales
 *
 * Examples:
 *   npx tsx scripts/store-metadata.ts changelog 6
 *   npx tsx scripts/store-metadata.ts sync-metadata
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Locale Mapping: App locale -> Store locale(s)
// ============================================================================
// Google Play: https://support.google.com/googleplay/android-developer/answer/9844778
// App Store: https://developer.apple.com/help/app-store-connect/reference/app-store-localizations

interface LocaleMapping {
  app: string; // App locale (src/i18n/locales/)
  android: string; // Google Play locale
  ios: string; // App Store Connect locale
}

const LOCALE_MAPPINGS: LocaleMapping[] = [
  // English
  { app: 'en-US', android: 'en-US', ios: 'en-US' },
  { app: 'en-AU', android: 'en-AU', ios: 'en-AU' },
  { app: 'en-GB', android: 'en-GB', ios: 'en-GB' },

  // German
  { app: 'de-DE', android: 'de-DE', ios: 'de-DE' },
  // Swiss German variants: de-CH is NOT a valid store locale for either platform
  // Use de-DE for both Android and iOS
  { app: 'de-CH', android: 'de-DE', ios: 'de-DE' },
  { app: 'de-CHB', android: 'de-DE', ios: 'de-DE' },
  { app: 'de-CHZ', android: 'de-DE', ios: 'de-DE' },

  // Spanish
  { app: 'es', android: 'es-ES', ios: 'es-ES' },
  { app: 'es-ES', android: 'es-ES', ios: 'es-ES' },
  { app: 'es-419', android: 'es-419', ios: 'es-MX' }, // Latin America

  // French
  { app: 'fr', android: 'fr-FR', ios: 'fr-FR' },

  // Italian
  { app: 'it', android: 'it-IT', ios: 'it' },

  // Dutch
  { app: 'nl', android: 'nl-NL', ios: 'nl-NL' },

  // Portuguese
  { app: 'pt', android: 'pt-PT', ios: 'pt-PT' },
  { app: 'pt-BR', android: 'pt-BR', ios: 'pt-BR' },

  // Polish
  { app: 'pl', android: 'pl-PL', ios: 'pl' },

  // Danish
  { app: 'da', android: 'da-DK', ios: 'da' },

  // Japanese
  { app: 'ja', android: 'ja-JP', ios: 'ja' },

  // Chinese (Simplified)
  { app: 'zh-Hans', android: 'zh-CN', ios: 'zh-Hans' },
];

// Get unique store locales (some app locales map to same store locale)
function getUniqueStoreLocales(platform: 'android' | 'ios'): string[] {
  const locales = LOCALE_MAPPINGS.map((m) => m[platform]);
  return [...new Set(locales)];
}

// Find the primary app locale for a store locale
function getPrimaryAppLocale(
  storeLocale: string,
  platform: 'android' | 'ios'
): string {
  const mapping = LOCALE_MAPPINGS.find((m) => m[platform] === storeLocale);
  return mapping?.app || 'en-US';
}

// ============================================================================
// Directory Structure
// ============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FASTLANE_DIR = path.join(PROJECT_ROOT, 'config', 'fastlane');
const METADATA_DIR = path.join(FASTLANE_DIR, 'metadata');
const APP_LOCALES_DIR = path.join(PROJECT_ROOT, 'src', 'i18n', 'locales');

// Source changelog (English) that gets translated
const SOURCE_CHANGELOG_DIR = path.join(
  METADATA_DIR,
  'android',
  'en-US',
  'changelogs'
);

// ============================================================================
// Changelog Management
// ============================================================================

interface ChangelogOptions {
  versionCode: number;
  translate?: boolean;
}

async function generateChangelogs(options: ChangelogOptions): Promise<void> {
  const { versionCode, translate } = options;

  // Read source changelog
  const sourceFile = path.join(SOURCE_CHANGELOG_DIR, `${versionCode}.txt`);
  if (!fs.existsSync(sourceFile)) {
    console.error(`Source changelog not found: ${sourceFile}`);
    console.error(
      `Create the English changelog first at: metadata/android/en-US/changelogs/${versionCode}.txt`
    );
    process.exit(1);
  }

  const sourceContent = fs.readFileSync(sourceFile, 'utf-8');
  console.log(`Source changelog (${versionCode}):\n${sourceContent}\n`);

  // Generate for Android
  console.log('=== Android Changelogs ===');
  for (const locale of getUniqueStoreLocales('android')) {
    const dir = path.join(METADATA_DIR, 'android', locale, 'changelogs');
    fs.mkdirSync(dir, { recursive: true });

    const targetFile = path.join(dir, `${versionCode}.txt`);

    if (locale === 'en-US') {
      console.log(`  ${locale}: Using source (already exists)`);
      continue;
    }

    if (translate) {
      // Placeholder for translation API integration
      // For now, copy English and mark as needing translation
      const content = `${sourceContent}\n<!-- TODO: Translate to ${locale} -->`;
      fs.writeFileSync(targetFile, content);
      console.log(`  ${locale}: Created (needs translation)`);
    } else {
      // Copy English as placeholder
      fs.writeFileSync(targetFile, sourceContent);
      console.log(`  ${locale}: Copied from en-US`);
    }
  }

  // Generate for iOS
  console.log('\n=== iOS Release Notes ===');
  for (const locale of getUniqueStoreLocales('ios')) {
    const dir = path.join(METADATA_DIR, 'ios', locale);
    fs.mkdirSync(dir, { recursive: true });

    const targetFile = path.join(dir, 'release_notes.txt');

    if (locale === 'en-US') {
      // Update en-US release notes from source
      fs.writeFileSync(targetFile, sourceContent);
      console.log(`  ${locale}: Updated from source`);
      continue;
    }

    if (translate) {
      const content = `${sourceContent}\n<!-- TODO: Translate to ${locale} -->`;
      fs.writeFileSync(targetFile, content);
      console.log(`  ${locale}: Created (needs translation)`);
    } else {
      fs.writeFileSync(targetFile, sourceContent);
      console.log(`  ${locale}: Copied from en-US`);
    }
  }

  console.log('\nDone! Run fastlane to upload:');
  console.log('  Android: cd config/fastlane && bundle exec fastlane android deploy track:internal aab:<path>');
  console.log('  iOS: cd config/fastlane && bundle exec fastlane ios release');
}

// ============================================================================
// Metadata Sync (title, descriptions, keywords)
// ============================================================================

interface MetadataFiles {
  title: string;
  short_description: string;
  full_description: string;
  // iOS-specific
  subtitle?: string;
  keywords?: string;
  promotional_text?: string;
}

async function syncMetadata(translate: boolean = false): Promise<void> {
  // Read English source metadata
  const androidEnUS = path.join(METADATA_DIR, 'android', 'en-US');

  const sourceMetadata: MetadataFiles = {
    title: readFileOrEmpty(path.join(androidEnUS, 'title.txt')),
    short_description: readFileOrEmpty(
      path.join(androidEnUS, 'short_description.txt')
    ),
    full_description: readFileOrEmpty(
      path.join(androidEnUS, 'full_description.txt')
    ),
  };

  console.log('Source metadata (en-US):');
  console.log(`  Title: ${sourceMetadata.title.trim()}`);
  console.log(
    `  Short: ${sourceMetadata.short_description.substring(0, 50)}...`
  );
  console.log('\n');

  // Sync Android metadata
  console.log('=== Android Metadata ===');
  for (const locale of getUniqueStoreLocales('android')) {
    if (locale === 'en-US') continue;

    const dir = path.join(METADATA_DIR, 'android', locale);
    fs.mkdirSync(dir, { recursive: true });

    writeFileIfChanged(
      path.join(dir, 'title.txt'),
      sourceMetadata.title,
      locale,
      'title'
    );
    writeFileIfChanged(
      path.join(dir, 'short_description.txt'),
      sourceMetadata.short_description,
      locale,
      'short_description'
    );
    writeFileIfChanged(
      path.join(dir, 'full_description.txt'),
      sourceMetadata.full_description,
      locale,
      'full_description'
    );
  }

  // Sync iOS metadata
  console.log('\n=== iOS Metadata ===');
  const iosEnUS = path.join(METADATA_DIR, 'ios', 'en-US');

  // iOS has different file names
  const iosSourceMetadata = {
    name: readFileOrEmpty(path.join(iosEnUS, 'name.txt')) || sourceMetadata.title,
    subtitle:
      readFileOrEmpty(path.join(iosEnUS, 'subtitle.txt')) ||
      sourceMetadata.short_description.substring(0, 30),
    description:
      readFileOrEmpty(path.join(iosEnUS, 'description.txt')) ||
      sourceMetadata.full_description,
    keywords: readFileOrEmpty(path.join(iosEnUS, 'keywords.txt')),
    promotional_text: readFileOrEmpty(
      path.join(iosEnUS, 'promotional_text.txt')
    ),
  };

  // Create iOS en-US if it doesn't exist
  fs.mkdirSync(iosEnUS, { recursive: true });
  if (!fs.existsSync(path.join(iosEnUS, 'name.txt'))) {
    fs.writeFileSync(path.join(iosEnUS, 'name.txt'), sourceMetadata.title);
  }
  if (!fs.existsSync(path.join(iosEnUS, 'description.txt'))) {
    fs.writeFileSync(
      path.join(iosEnUS, 'description.txt'),
      sourceMetadata.full_description
    );
  }

  for (const locale of getUniqueStoreLocales('ios')) {
    if (locale === 'en-US') continue;

    const dir = path.join(METADATA_DIR, 'ios', locale);
    fs.mkdirSync(dir, { recursive: true });

    writeFileIfChanged(
      path.join(dir, 'name.txt'),
      iosSourceMetadata.name,
      locale,
      'name'
    );
    writeFileIfChanged(
      path.join(dir, 'subtitle.txt'),
      iosSourceMetadata.subtitle,
      locale,
      'subtitle'
    );
    writeFileIfChanged(
      path.join(dir, 'description.txt'),
      iosSourceMetadata.description,
      locale,
      'description'
    );
    if (iosSourceMetadata.keywords) {
      writeFileIfChanged(
        path.join(dir, 'keywords.txt'),
        iosSourceMetadata.keywords,
        locale,
        'keywords'
      );
    }
    if (iosSourceMetadata.promotional_text) {
      writeFileIfChanged(
        path.join(dir, 'promotional_text.txt'),
        iosSourceMetadata.promotional_text,
        locale,
        'promotional_text'
      );
    }
  }

  console.log('\nMetadata synced to all locales.');
  console.log(
    'Note: Files are copied from en-US. For proper translations, edit each locale manually or integrate a translation API.'
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

function readFileOrEmpty(filePath: string): string {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return '';
}

function writeFileIfChanged(
  filePath: string,
  content: string,
  locale: string,
  field: string
): void {
  const existing = readFileOrEmpty(filePath);
  if (existing !== content) {
    fs.writeFileSync(filePath, content);
    console.log(`  ${locale}/${field}: Updated`);
  } else {
    console.log(`  ${locale}/${field}: No changes`);
  }
}

function listLocales(): void {
  console.log('=== Locale Mappings ===\n');
  console.log('App Locale     | Android Store | iOS Store');
  console.log('---------------|---------------|----------');
  for (const m of LOCALE_MAPPINGS) {
    console.log(
      `${m.app.padEnd(14)} | ${m.android.padEnd(13)} | ${m.ios}`
    );
  }

  console.log('\n=== Unique Store Locales ===\n');
  console.log(`Android (${getUniqueStoreLocales('android').length}): ${getUniqueStoreLocales('android').join(', ')}`);
  console.log(`iOS (${getUniqueStoreLocales('ios').length}): ${getUniqueStoreLocales('ios').join(', ')}`);
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'changelog': {
    const versionCode = parseInt(args[1], 10);
    if (isNaN(versionCode)) {
      console.error('Usage: store-metadata.ts changelog <versionCode>');
      process.exit(1);
    }
    const translate = args.includes('--translate');
    generateChangelogs({ versionCode, translate });
    break;
  }

  case 'sync-metadata': {
    const translate = args.includes('--translate');
    syncMetadata(translate);
    break;
  }

  case 'list-locales':
    listLocales();
    break;

  default:
    console.log(`
Store Metadata Management

Usage:
  npx tsx scripts/store-metadata.ts <command> [options]

Commands:
  changelog <versionCode>   Generate changelog files for all locales
                            Creates files in metadata/{android,ios}/{locale}/

  sync-metadata             Sync title, descriptions to all locales
                            Uses en-US as source

  list-locales              Show locale mappings between app and stores

Options:
  --translate               Mark files as needing translation (adds TODO comment)

Examples:
  npx tsx scripts/store-metadata.ts changelog 6
  npx tsx scripts/store-metadata.ts sync-metadata
  npx tsx scripts/store-metadata.ts list-locales

Workflow:
  1. Write your changelog in: config/fastlane/metadata/android/en-US/changelogs/{versionCode}.txt
  2. Run: npx tsx scripts/store-metadata.ts changelog {versionCode}
  3. (Optional) Edit translated files or use translation service
  4. Deploy with fastlane: cd config/fastlane && bundle exec fastlane android deploy
`);
}
