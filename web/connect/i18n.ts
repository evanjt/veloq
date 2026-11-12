// The page's language: the browser's language list resolved through the app's
// own fallback chains, one chunk fetched for the one locale chosen, and
// i18next started over it.

import { createInstance, type i18n, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resolveLocaleChain } from '../../src/i18n/resolveLocale';
import type { SupportedLocale } from '../../src/i18n/types';
import namespaces from './namespaces.json';

/** The namespaces a chunk holds; the build writes the same list into each. */
export const NAMESPACES: readonly string[] = namespaces;

/** What the page needs from the browser, so it runs without one. */
export type LocaleEnv = {
  languages: readonly string[];
  /** The chunk path for each supported tag, as the build wrote it into the page. */
  chunks: Readonly<Record<string, string>>;
  fetchJson: (path: string) => Promise<Record<string, never>>;
  setLanguage: (tag: string) => void;
  /** The tag the athlete chose on an earlier visit, if any. */
  stored: () => string | null;
  /** Keeps the athlete's choice for the next visit. */
  store: (tag: string) => void;
};

/** The storage key the athlete's choice is kept under. */
export const LANGUAGE_KEY = 'connect.language';

/** Every locale the app ships, each by its own name. */
export const LANGUAGE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  da: 'Dansk',
  'de-CH': 'Deutsch (CH)',
  'de-DE': 'Deutsch (DE)',
  'en-AU': 'English (AU)',
  'en-GB': 'English (GB)',
  'en-US': 'English (US)',
  'es-419': 'Español (Latinoamérica)',
  'es-ES': 'Español (España)',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  nl: 'Nederlands',
  pl: 'Polski',
  'pt-BR': 'Português (Brasil)',
  pt: 'Português',
  'zh-Hans': '简体中文',
};

const ROOT = 'en-GB' as const;

function chunkFor(env: LocaleEnv, tag: string): string {
  const path = env.chunks[tag];
  if (!path) throw new Error(`the page carries no chunk for ${tag}`);
  return path;
}

/** The locale the page speaks, and the instance holding its strings. */
export async function startI18n(env: LocaleEnv): Promise<{ locale: string; i18n: i18n }> {
  const kept = env.stored();
  // A kept tag the page has no chunk for is ignored, so the browser's list decides.
  const [wanted = ROOT] =
    kept && Object.hasOwn(env.chunks, kept) ? [kept] : resolveLocaleChain(env.languages);
  let locale: string = wanted;
  let resources: Record<string, never>;
  try {
    resources = await env.fetchJson(chunkFor(env, wanted));
  } catch (error) {
    // A chunk that will not load leaves the root locale, which every chain ends at.
    if (wanted === ROOT) throw error;
    locale = ROOT;
    resources = await env.fetchJson(chunkFor(env, ROOT));
  }
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: locale,
    // The app keeps every namespace as a top-level key of one `translation` resource.
    resources: { [locale]: { translation: resources } } as Resource,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  env.setLanguage(locale);
  return { locale, i18n: instance };
}

/** Switches the running page to a locale it carries a chunk for, and keeps the choice. */
export async function changeLanguage(env: LocaleEnv, instance: i18n, tag: string): Promise<void> {
  if (!instance.hasResourceBundle(tag, 'translation')) {
    const resources = await env.fetchJson(chunkFor(env, tag));
    instance.addResourceBundle(tag, 'translation', resources, true, true);
  }
  await instance.changeLanguage(tag);
  env.setLanguage(tag);
  env.store(tag);
}

export function browserLocaleEnv(): LocaleEnv {
  const block = document.getElementById('locale-chunks');
  return {
    languages: navigator.languages?.length ? navigator.languages : [navigator.language],
    chunks: JSON.parse(block?.textContent || '{}'),
    fetchJson: async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json();
    },
    setLanguage: (tag) => {
      document.documentElement.lang = tag;
    },
    stored: () => {
      try {
        return localStorage.getItem(LANGUAGE_KEY);
      } catch {
        return null;
      }
    },
    store: (tag) => {
      try {
        localStorage.setItem(LANGUAGE_KEY, tag);
      } catch {
        // Storage that is blocked leaves the choice for this visit only.
      }
    },
  };
}
