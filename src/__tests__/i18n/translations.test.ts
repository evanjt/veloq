/**
 * Translation Completeness Test
 *
 * This test ensures:
 * 1. All translation files have the same keys as the reference locale (en-GB)
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
  });

  // Each non-reference locale must define every reference key.
  test.each(availableLocales.filter((l) => l !== REFERENCE_LOCALE))(
    '%s exists and has every reference key',
    (locale) => {
      const localeData = loadLocale(locale);
      expect(localeData).not.toBeNull();

      const localeKeys = getAllKeys(localeData as Record<string, unknown>);
      const missingKeys = referenceKeys.filter((key) => !localeKeys.includes(key));
      expect(missingKeys).toEqual([]);
    }
  );
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

    // Assert on the key names so a failure lists exactly which keys are undefined.
    expect(undefinedKeys.map((u) => u.key)).toEqual([]);
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
