import { loadLocale, localesToLoad } from '@/i18n/localeBundles';
import type { TranslationResource } from '@/i18n/types';

type Entries = Record<string, unknown>;

function merge(base: Entries, override: Entries): Entries {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key];
    result[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      previous &&
      typeof previous === 'object' &&
      !Array.isArray(previous)
        ? merge(previous as Entries, value as Entries)
        : value;
  }
  return result;
}

/** The complete strings an athlete reads after the app's locale fallback chain. */
export function resolvedLocale(locale: string): TranslationResource {
  const chain = localesToLoad(locale);
  return chain.reduceRight<Entries>(
    (result, entry) => merge(result, loadLocale(entry)),
    {}
  ) as TranslationResource;
}
