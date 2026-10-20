/**
 * Store locale tables shared by validate-store-metadata.ts and
 * store-screenshots.ts. Play locale codes are the canonical keys because
 * supply uses the full form; Apple uses short codes for several of them.
 */

export interface LocaleMapping {
  app: string;
  android: string;
  ios: string;
}

// App i18n locale to store locale. de-CH collapses to de-DE because
// Swiss German is not a valid store locale on either platform.
export const LOCALE_MAPPINGS: LocaleMapping[] = [
  { app: 'en-US', android: 'en-US', ios: 'en-US' },
  { app: 'en-AU', android: 'en-AU', ios: 'en-AU' },
  { app: 'en-GB', android: 'en-GB', ios: 'en-GB' },
  { app: 'de-DE', android: 'de-DE', ios: 'de-DE' },
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

// Play locale to Apple locale where the codes diverge. Unlisted locales use
// the same code on both stores.
export const APPLE_LOCALE: Record<string, string> = {
  'da-DK': 'da',
  'es-419': 'es-MX',
  'it-IT': 'it',
  'ja-JP': 'ja',
  'pl-PL': 'pl',
  'zh-CN': 'zh-Hans',
};

// Byte-identical screenshot and description mirrors. Keyword fields are never
// mirrored: en-AU and en-GB are both indexed in the AU storefront, so
// identical keyword sets waste one of them.
export const MIRRORS: Record<string, string[]> = {
  'en-AU': ['en-GB'],
};

// Store locales with no app locale behind them. en-CA exists because Apple
// defaults the Canadian storefront to English (Canada), which otherwise falls
// back to the primary language.
export const EXTRA_IOS_LOCALES = ['en-CA'];

// The Play locale whose screenshots each App Store-only locale shows.
const IOS_MIRRORS: Record<string, string[]> = {
  'en-US': ['en-CA'],
};

export function uniqueStoreLocales(platform: 'android' | 'ios'): string[] {
  const locales = new Set(LOCALE_MAPPINGS.map((m) => m[platform]));
  if (platform === 'ios') for (const l of EXTRA_IOS_LOCALES) locales.add(l);
  return [...locales];
}

export function appleLocaleFor(playLocale: string): string {
  return APPLE_LOCALE[playLocale] ?? playLocale;
}

/**
 * One screenshot capture: the Play locale its raw captures and composites are
 * keyed by, the language the capture flow picks in the app, and every Play and
 * App Store locale its composites install into.
 */
export interface CaptureLocale {
  play: string;
  app: string;
  android: string[];
  ios: string[];
}

/**
 * Every capture a full screenshot run takes. A mirror is installed from the
 * locale it mirrors rather than captured. The app language is the mapping row
 * spelt as the store locale, else the one row behind it: es-ES is captured in
 * es-ES rather than neutral es, de-DE in de-DE rather than de-CH.
 */
export function captureLocales(): CaptureLocale[] {
  const mirrored = new Set(Object.values(MIRRORS).flat());
  return uniqueStoreLocales('android')
    .filter((play) => !mirrored.has(play))
    .map((play) => {
      const rows = LOCALE_MAPPINGS.filter((m) => m.android === play);
      const row = rows.find((m) => m.app === play) ?? (rows.length === 1 ? rows[0] : undefined);
      if (!row) throw new Error(`No single app language behind the store locale ${play}`);
      const android = [play, ...(MIRRORS[play] ?? [])];
      return {
        play,
        app: row.app,
        android,
        ios: [...android.map(appleLocaleFor), ...(IOS_MIRRORS[play] ?? [])],
      };
    });
}

// `npx tsx scripts/store-locales.ts capture` prints one `<play>=<app>` line per
// capture, which the capture scripts read.
if (/store-locales\.ts$/.test(process.argv[1] ?? '') && process.argv[2] === 'capture') {
  for (const c of captureLocales()) console.log(`${c.play}=${c.app}`);
}
