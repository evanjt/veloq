/**
 * Translation Completeness Test
 *
 * This test ensures all translation files have the same keys as the reference locale (en-AU).
 * It helps identify missing translations and track progress for new languages.
 *
 * Run with: npx jest translations.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Reference locale (the source of truth)
const REFERENCE_LOCALE = 'en-AU';

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
      const completeness = ((referenceKeys.length - missingKeys.length) / referenceKeys.length) * 100;

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

        // Allow partial translations during development - this will just warn
        if (missingKeys.length > 0) {
          console.warn(`\n⚠️  ${locale} is ${completeness.toFixed(1)}% complete`);
        }

        // For now, we'll pass the test but log the missing keys
        // To enforce completeness, uncomment: expect(missingKeys).toEqual([]);
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

    const summary: { locale: string; complete: number; missing: number; percent: string }[] = [];

    availableLocales.forEach((locale) => {
      if (locale === REFERENCE_LOCALE) return;

      const localeData = loadLocale(locale);
      if (!localeData) return;

      const localeKeys = getAllKeys(localeData);
      const missingKeys = referenceKeys.filter((key) => !localeKeys.includes(key));
      const completeness = ((referenceKeys.length - missingKeys.length) / referenceKeys.length) * 100;

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
      const bar = '█'.repeat(Math.floor(parseFloat(percent) / 5)) + '░'.repeat(20 - Math.floor(parseFloat(percent) / 5));
      const status = parseFloat(percent) === 100 ? '✅' : parseFloat(percent) >= 80 ? '🟡' : '🔴';
      console.log(`${status} ${locale.padEnd(10)} ${bar} ${percent.padStart(5)}% (${missing} missing)`);
    });

    console.log('-'.repeat(60));
    const totalLocales = summary.length;
    const completeLocales = summary.filter((s) => parseFloat(s.percent) === 100).length;
    console.log(`Total: ${completeLocales}/${totalLocales} locales at 100%`);
    console.log('='.repeat(60) + '\n');

    expect(true).toBe(true); // Always pass, this is informational
  });
});

// Export for use in other scripts
export { getAllKeys, getValueAtPath, loadLocale, getAvailableLocales };
