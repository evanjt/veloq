/**
 * Translation Completeness Test
 *
 * This test ensures:
 * 1. All resolved locales have the same keys as the reference locale (en-GB)
 * 2. All translation keys used in source code are defined in locale files
 *
 * It helps identify missing translations and track progress for new languages.
 *
 * Run with: npx jest translations.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import acceptedIdenticalValues from './acceptedIdenticalValues.json';
import { resolvedLocale } from './resolvedLocale';

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
 * Load the strings visible after the locale's fallback chain.
 */
function loadLocale(locale: string): Record<string, unknown> | null {
  const filePath = path.join(LOCALES_DIR, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return resolvedLocale(locale);
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

/** The reference bundle, or a throw naming the missing file, so no describe branches on it. */
function referenceLocale(): Record<string, unknown> {
  const data = loadLocale(REFERENCE_LOCALE);
  if (!data) {
    throw new Error(`Reference locale ${REFERENCE_LOCALE}.json not found in ${LOCALES_DIR}`);
  }
  return data;
}

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

test('reference locale exists', () => {
  expect(loadLocale(REFERENCE_LOCALE)).not.toBeNull();
});

describe('Translation Completeness', () => {
  const referenceKeys = getAllKeys(referenceLocale());
  const availableLocales = getAvailableLocales();

  test(`Reference locale (${REFERENCE_LOCALE}) should have translations`, () => {
    expect(referenceKeys.length).toBeGreaterThan(0);
  });

  // Each non-reference locale must resolve every reference key.
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

  // An empty value keeps its key, so key parity passes and the screen renders a blank label.
  test.each(availableLocales)('%s gives every key a non-empty string', (locale) => {
    const localeData = loadLocale(locale) as Record<string, unknown>;
    const blank = getAllKeys(localeData).filter((key) => {
      const value = getValueAtPath(localeData, key);
      return typeof value !== 'string' || value.trim().length === 0;
    });
    expect(blank).toEqual([]);
  });

  // i18next falls back to the English bundle when the locale lacks the form a count selects.
  test.each(availableLocales)('%s has every plural form its counts select', (locale) => {
    const keys = getAllKeys(loadLocale(locale) as Record<string, unknown>);
    const keySet = new Set(keys);
    const categories = new Set<string>();
    const rules = new Intl.PluralRules(locale);
    for (let n = 0; n <= 10000; n++) categories.add(rules.select(n));
    const missing: string[] = [];
    for (const key of keys) {
      if (!key.endsWith('_other')) continue;
      const base = key.slice(0, -'_other'.length);
      for (const category of categories) {
        if (!keySet.has(`${base}_${category}`)) missing.push(`${base}_${category}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test.each(availableLocales.filter((l) => !ENGLISH_LOCALES.includes(l)))(
    '%s translates every leaf or records why its en-US value is accepted',
    (locale) => {
      const reference = loadLocale('en-US') as Record<string, unknown>;
      const localeData = loadLocale(locale) as Record<string, unknown>;
      const copied = getAllKeys(localeData).filter(
        (key) => getValueAtPath(localeData, key) === getValueAtPath(reference, key)
      );
      const accepted: Record<string, string> =
        acceptedIdenticalValues[locale as keyof typeof acceptedIdenticalValues] ?? {};
      expect(copied.filter((key) => !accepted[key]?.trim())).toEqual([]);
    }
  );
});

// Strings that stay singular-form because something other than i18next resolves them. Each needs its reason.
const BARE_COUNT_ALLOWLIST: Record<string, string> = {
  'notifications.activityBody.sectionPrCount':
    'The engine reads the stored template and substitutes the count itself, with no plural lookup.',
  'notifications.activityBody.sectionPrMany':
    'The engine reads the stored template and substitutes the count itself, with no plural lookup.',
};

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

describe('Count strings carry plural forms', () => {
  const availableLocales = getAvailableLocales();
  test.each(availableLocales)('%s has no {{count}} string without a plural suffix', (locale) => {
    const data = loadLocale(locale) as Record<string, unknown>;
    const bare = getAllKeys(data).filter((key) => {
      const value = getValueAtPath(data, key);
      return (
        typeof value === 'string' &&
        value.includes('{{count}}') &&
        !PLURAL_SUFFIX.test(key) &&
        !BARE_COUNT_ALLOWLIST[key]
      );
    });
    expect(bare).toEqual([]);
  });
});

describe('Translation Key Usage', () => {
  const referenceKeys = new Set(getAllKeys(referenceLocale()));

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
