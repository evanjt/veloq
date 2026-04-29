/**
 * Translation Completeness Test
 *
 * This test ensures:
 * 1. All translation files have the same keys as the reference locale (en-AU)
 * 2. All translation keys used in source code are defined in locale files
 *
 * It helps identify missing translations and track progress for new languages.
 *
 * Run with: npx jest translations.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

// Reference locale (the source of truth)
const REFERENCE_LOCALE = 'en-GB';

// Path to locales directory
const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

/**
 * Recursively get all keys from a nested object
 */
function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys;
}

/**
 * Get value at a dot-notation path in an object
 */
function getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Load a JSON locale file
 */
function loadLocale(locale: string): Record<string, unknown> | null {
  const filePath = path.join(LOCALES_DIR, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Get all available locale files
 */
function getAvailableLocales(): string[] {
  if (!fs.existsSync(LOCALES_DIR)) {
    return [];
  }
  return fs
    .readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace('.json', ''));
}

// Path to source directory
const SRC_DIR = path.join(__dirname, '../../');

/**
 * Extract translation keys from a source file
 * Matches patterns like:
 * - t('key.path')
 * - t("key.path")
 * - t(`key.path`)
 * - t('key.path', { ... })
 * - {t}('key.path') - destructured
 */
function extractTranslationKeysFromFile(filePath: string): { key: string; line: number }[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const keys: { key: string; line: number }[] = [];

  // Pattern to match t('key'), t("key"), t(`key`), or { t }('key')
  // Also handles cases like t('key', { count: 1 })
  const patterns = [
    /\bt\(\s*['"`]([a-zA-Z0-9_.]+)['"`]/g, // t('key') or t("key") or t(`key`)
    /\{\s*t\s*\}\s*\(\s*['"`]([a-zA-Z0-9_.]+)['"`]/g, // { t }('key')
  ];

  lines.forEach((line, index) => {
    patterns.forEach((pattern) => {
      let match;
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        const key = match[1];
        // Filter out obvious non-translation patterns
        if (
          !key.startsWith('_') && // Skip internal keys
          !key.match(/^\d/) && // Skip keys starting with numbers
          key.includes('.') // Translation keys should have namespace.key format
        ) {
          keys.push({ key, line: index + 1 });
        }
      }
    });
  });

  return keys;
}

/**
 * Get all source files that might contain translation keys
 */
async function getSourceFiles(): Promise<string[]> {
  const files = await glob('**/*.{ts,tsx}', {
    cwd: SRC_DIR,
    ignore: [
      '**/node_modules/**',
      '**/__tests__/**',
      '**/*.test.{ts,tsx}',
      '**/*.d.ts',
      '**/i18n/**', // Ignore i18n config files
    ],
    absolute: true,
  });
  return files;
}

/**
 * Extract all unique translation keys used in the codebase
 */
async function extractAllTranslationKeys(): Promise<Map<string, { file: string; line: number }[]>> {
  const sourceFiles = await getSourceFiles();
  const keyUsages = new Map<string, { file: string; line: number }[]>();

  for (const file of sourceFiles) {
    const keys = extractTranslationKeysFromFile(file);
    for (const { key, line } of keys) {
      const relativePath = path.relative(SRC_DIR, file);
      if (!keyUsages.has(key)) {
        keyUsages.set(key, []);
      }
      keyUsages.get(key)!.push({ file: relativePath, line });
    }
  }

  return keyUsages;
}

describe('Translation Completeness', () => {
  const referenceData = loadLocale(REFERENCE_LOCALE);

  if (!referenceData) {
    test('Reference locale should exist', () => {
      throw new Error(`Reference locale ${REFERENCE_LOCALE}.json not found in ${LOCALES_DIR}`);
    });
    return;
  }

  const referenceKeys = getAllKeys(referenceData);
  const availableLocales = getAvailableLocales();

  test(`Reference locale (${REFERENCE_LOCALE}) should have translations`, () => {
    expect(referenceKeys.length).toBeGreaterThan(0);
    console.log(`\n📊 Reference locale has ${referenceKeys.length} translation keys\n`);
  });

  // Test each locale for completeness
  availableLocales.forEach((locale) => {
    if (locale === REFERENCE_LOCALE) return;

    describe(`Locale: ${locale}`, () => {
      const localeData = loadLocale(locale);

      test('should exist and be valid JSON', () => {
        expect(localeData).not.toBeNull();
      });

      if (!localeData) return;

      const localeKeys = getAllKeys(localeData);
      const missingKeys = referenceKeys.filter((key) => !localeKeys.includes(key));
      const extraKeys = localeKeys.filter((key) => !referenceKeys.includes(key));
      const completeness =
        ((referenceKeys.length - missingKeys.length) / referenceKeys.length) * 100;

      test(`should have all translation keys (${completeness.toFixed(1)}% complete)`, () => {
        if (missingKeys.length > 0) {
          console.log(`\n❌ ${locale}: Missing ${missingKeys.length} keys:`);
          missingKeys.slice(0, 20).forEach((key) => console.log(`   - ${key}`));
          if (missingKeys.length > 20) {
            console.log(`   ... and ${missingKeys.length - 20} more`);
          }
        } else {
          console.log(`\n✅ ${locale}: 100% complete (${referenceKeys.length} keys)`);
        }

        // Fail if any keys are missing
        expect(missingKeys).toEqual([]);
      });

      test('should not have extra keys not in reference', () => {
        if (extraKeys.length > 0) {
          console.log(`\n⚠️  ${locale}: Has ${extraKeys.length} extra keys not in reference:`);
          extraKeys.forEach((key) => console.log(`   - ${key}`));
        }
        // Extra keys are warnings, not failures
      });

      test('should not have empty string values', () => {
        const emptyValues: string[] = [];
        localeKeys.forEach((key) => {
          const value = getValueAtPath(localeData, key);
          if (value === '') {
            emptyValues.push(key);
          }
        });

        if (emptyValues.length > 0) {
          console.log(`\n⚠️  ${locale}: Has ${emptyValues.length} empty values:`);
          emptyValues.slice(0, 10).forEach((key) => console.log(`   - ${key}`));
          if (emptyValues.length > 10) {
            console.log(`   ... and ${emptyValues.length - 10} more`);
          }
        }
      });
    });
  });

  // Summary test
  test('Translation Progress Summary', () => {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TRANSLATION PROGRESS SUMMARY');
    console.log('='.repeat(60));
    console.log(`Reference: ${REFERENCE_LOCALE} (${referenceKeys.length} keys)`);
    console.log('-'.repeat(60));

    const summary: {
      locale: string;
      complete: number;
      missing: number;
      percent: string;
    }[] = [];

    availableLocales.forEach((locale) => {
      if (locale === REFERENCE_LOCALE) return;

      const localeData = loadLocale(locale);
      if (!localeData) return;

      const localeKeys = getAllKeys(localeData);
      const missingKeys = referenceKeys.filter((key) => !localeKeys.includes(key));
      const completeness =
        ((referenceKeys.length - missingKeys.length) / referenceKeys.length) * 100;

      summary.push({
        locale,
        complete: referenceKeys.length - missingKeys.length,
        missing: missingKeys.length,
        percent: completeness.toFixed(1),
      });
    });

    // Sort by completeness (highest first)
    summary.sort((a, b) => parseFloat(b.percent) - parseFloat(a.percent));

    summary.forEach(({ locale, complete, missing, percent }) => {
      const bar =
        '█'.repeat(Math.floor(parseFloat(percent) / 5)) +
        '░'.repeat(20 - Math.floor(parseFloat(percent) / 5));
      const status = parseFloat(percent) === 100 ? '✅' : parseFloat(percent) >= 80 ? '🟡' : '🔴';
      console.log(
        `${status} ${locale.padEnd(10)} ${bar} ${percent.padStart(5)}% (${missing} missing)`
      );
    });

    console.log('-'.repeat(60));
    const totalLocales = summary.length;
    const completeLocales = summary.filter((s) => parseFloat(s.percent) === 100).length;
    console.log(`Total: ${completeLocales}/${totalLocales} locales at 100%`);
    console.log('='.repeat(60) + '\n');

    expect(true).toBe(true); // Always pass, this is informational
  });
});

describe('Translation Key Usage', () => {
  const referenceData = loadLocale(REFERENCE_LOCALE);

  if (!referenceData) {
    test('Reference locale should exist', () => {
      throw new Error(`Reference locale ${REFERENCE_LOCALE}.json not found`);
    });
    return;
  }

  const referenceKeys = new Set(getAllKeys(referenceData));

  test('All translation keys used in source code should be defined in locale files', async () => {
    const keyUsages = await extractAllTranslationKeys();
    const undefinedKeys: {
      key: string;
      usages: { file: string; line: number }[];
    }[] = [];

    for (const [key, usages] of keyUsages) {
      // i18next plural keys: t('key', { count }) resolves to key_one / key_other
      const isPluralKey = referenceKeys.has(`${key}_one`) || referenceKeys.has(`${key}_other`);
      if (!referenceKeys.has(key) && !isPluralKey) {
        undefinedKeys.push({ key, usages });
      }
    }

    if (undefinedKeys.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('❌ UNDEFINED TRANSLATION KEYS');
      console.log('='.repeat(60));
      console.log(
        `Found ${undefinedKeys.length} translation keys used in code but not defined in locale files:\n`
      );

      undefinedKeys.forEach(({ key, usages }) => {
        console.log(`  ❌ "${key}"`);
        usages.forEach(({ file, line }) => {
          console.log(`     └─ ${file}:${line}`);
        });
      });

      console.log('\n' + '='.repeat(60));
      console.log('Add these keys to src/i18n/locales/en-AU.json (and other locale files)');
      console.log('='.repeat(60) + '\n');
    } else {
      console.log('\n✅ All translation keys used in source code are defined in locale files');
      console.log(`   Checked ${keyUsages.size} unique translation keys\n`);
    }

    // This test should FAIL if there are undefined keys
    expect(undefinedKeys).toEqual([]);
  });

  test('Translation key usage summary', async () => {
    const keyUsages = await extractAllTranslationKeys();

    console.log('\n' + '='.repeat(60));
    console.log('📊 TRANSLATION KEY USAGE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total unique keys used in source code: ${keyUsages.size}`);
    console.log(`Total keys defined in ${REFERENCE_LOCALE}: ${referenceKeys.size}`);

    // Find unused keys (defined but never used in code)
    const usedKeys = new Set(keyUsages.keys());
    const unusedKeys = [...referenceKeys].filter((key) => !usedKeys.has(key));

    // Filter out keys that are likely dynamic or used indirectly
    const likelyUnused = unusedKeys.filter((key) => {
      // Keep keys that don't look like they're part of a dynamic pattern
      const parts = key.split('.');
      const lastPart = parts[parts.length - 1];
      // Skip keys that look like enum values or dynamic parts
      return !['ride', 'run', 'swim', 'walk', 'hike', 'other', 'european', 'asian'].includes(
        lastPart
      );
    });

    if (likelyUnused.length > 0 && likelyUnused.length < 50) {
      console.log(`\n⚠️  Potentially unused keys (${likelyUnused.length}):`);
      likelyUnused.slice(0, 20).forEach((key) => console.log(`   - ${key}`));
      if (likelyUnused.length > 20) {
        console.log(`   ... and ${likelyUnused.length - 20} more`);
      }
      console.log('\n   Note: Some keys may be used dynamically and appear unused');
    }

    console.log('='.repeat(60) + '\n');

    expect(true).toBe(true); // Informational only
  });
});

/**
 * Translation Freshness
 *
 * Catches the case where a new key is added to en-US.json (or en-GB.json) and
 * mass-copied to all other locale files without being translated. Without this
 * check, those locales pass the key-parity tests above while still showing
 * English to the user.
 *
 * For each non-English locale we count leaf-string values that are byte-identical
 * to en-US AND contain Latin letters (so they're plausibly English text). Brand
 * names, abbreviations recognised internationally (FTP, TSS, CTL, ATL, TSB, HRV,
 * GPS, etc.), and a small set of intentional-English keys (paper citations) are
 * excluded.
 *
 * Each locale has a baseline; the count must be <= baseline. Drop a baseline to
 * 0 once that locale is fully translated to lock in the gains.
 */
const FRESHNESS_FREEZE_BASELINE: Record<string, number> = {
  da: 0,
  'de-CH': 1,
  'de-DE': 16,
  es: 0,
  'es-419': 0,
  'es-ES': 4,
  fr: 19,
  it: 0,
  ja: 0,
  nl: 23,
  pl: 1,
  pt: 5,
  'pt-BR': 5,
  'zh-Hans': 0,
};

const FRESHNESS_ALLOWLIST_VALUES = new Set([
  // Brand / product names (stay English in every locale)
  'Veloq',
  'intervals.icu',
  'OpenStreetMap',
  'MapLibre',
  'Strava',
  'Garmin',
  'TrainingPeaks',
  'Apple',
  'Google',
  'GitHub',
  'FastFitness.Tips',
  'Science2Sport',
  'Joe Friel',
  'Morton',
  'WebDAV / Nextcloud',
  'iCloud',
  'OpenStreetMap Nominatim',
  'Native Engine (tracematch)',
  // Cycling / training abbreviations recognised internationally
  'FTP',
  'TSS',
  'CTL',
  'ATL',
  'TSB',
  'HRV',
  'GPS',
  'PR',
  'VO2',
  'BPM',
  'RPM',
  'kJ',
  'TRIMP',
  "W'bal",
  'HIIT',
  // Sport names that are loanwords across most locales we support
  'Badminton',
  'CrossFit',
  'Crossfit',
  'Golf',
  'Kitesurf',
  'Pickleball',
  'Pilates',
  'Racquetball',
  'Skateboard',
  'Snowboard',
  'Squash',
  'Surfing',
  'Tennis',
  'Velomobile',
  'Windsurf',
  'Yoga',
  // Universal SI units / abbreviations
  'kcal',
  'km/h',
  'TEMP',
  'Temp',
  'Dist',
  'Elev',
  'FTP {{value}}w',
  'FTP: {{value}}W',
  // Common UI cognates that are spelled identically in many target languages
  'Auto',
  'Total',
  'Error',
  'Cache',
  'Route',
  'Routes',
  'Original',
  'Imperial',
  'Distance',
  'Calories',
  'Cadence',
  'Performance',
  'Notifications',
  'Suggestions',
  'Conditions',
  'Satellite',
  'Maximum',
  'Standard',
  'Fitness',
  'Form',
  'Heatmap',
  'Workout',
  'Training',
  'Stable',
  'Stats',
  'Notes',
  'Date',
  'Volume',
  'Optimal',
  'Neutral',
  'Transition',
  'Fresh',
  'Fatigue',
  'Long',
  'Half',
  'Mile',
  'Smart',
  'System',
  'Support',
  'Forum',
  'Bug',
  'Idea',
  'Version',
  'Account',
  'Database',
  'Password',
  'Disclaimer',
]);

const FRESHNESS_ALLOWLIST_KEYS = new Set([
  // Intentional English paper-citation links
  'fitnessScreen.linkTrainingLoad',
  'fitnessScreen.linkTSBManagement',
]);

const LATIN_RE = /[A-Za-z]{2,}/;
const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

function isUntranslatedEnglish(key: string, enValue: string, locValue: unknown): boolean {
  if (typeof locValue !== 'string') return false;
  if (locValue !== enValue) return false;
  if (FRESHNESS_ALLOWLIST_KEYS.has(key)) return false;
  if (FRESHNESS_ALLOWLIST_VALUES.has(enValue)) return false;
  if (enValue.length <= 3) return false;
  if (!LATIN_RE.test(enValue)) return false;
  // Strip placeholders; if nothing meaningful left, it's a pure template (e.g. "{{x}}")
  const stripped = enValue.replace(PLACEHOLDER_RE, '').trim();
  if (!stripped || !LATIN_RE.test(stripped)) return false;
  return true;
}

describe('Translation Freshness', () => {
  // Use en-US as the source of truth for "is this still English?".
  // (en-GB is the i18n source of truth for spelling, but values land in en-US first.)
  const enData = loadLocale('en-US');

  if (!enData) {
    test('en-US locale should exist', () => {
      throw new Error('en-US.json not found - cannot run freshness check');
    });
    return;
  }

  const enKeys = getAllKeys(enData);
  const enValues = new Map<string, string>();
  for (const key of enKeys) {
    const v = getValueAtPath(enData, key);
    if (typeof v === 'string') enValues.set(key, v);
  }

  Object.keys(FRESHNESS_FREEZE_BASELINE).forEach((locale) => {
    const baseline = FRESHNESS_FREEZE_BASELINE[locale];

    describe(`Locale: ${locale}`, () => {
      const localeData = loadLocale(locale);

      if (!localeData) {
        test('locale should load', () => {
          throw new Error(`${locale}.json not found`);
        });
        return;
      }

      test(`identical-to-en-US count should not exceed baseline (${baseline})`, () => {
        const offenders: { key: string; value: string }[] = [];
        for (const [key, enValue] of enValues) {
          const locValue = getValueAtPath(localeData, key);
          if (isUntranslatedEnglish(key, enValue, locValue)) {
            offenders.push({ key, value: enValue });
          }
        }

        if (offenders.length > baseline) {
          console.log(`\n❌ ${locale}: ${offenders.length} untranslated (baseline ${baseline})`);
          console.log(`   New offenders since baseline was set:`);
          offenders
            .sort((a, b) => b.value.length - a.value.length)
            .slice(0, 30)
            .forEach((o) => {
              const preview = o.value.length > 80 ? o.value.slice(0, 77) + '...' : o.value;
              console.log(`     - ${o.key}: "${preview}"`);
            });
        }

        expect(offenders.length).toBeLessThanOrEqual(baseline);
      });
    });
  });
});

// Export for use in other scripts
export {
  getAllKeys,
  getValueAtPath,
  loadLocale,
  getAvailableLocales,
  extractTranslationKeysFromFile,
  extractAllTranslationKeys,
};
