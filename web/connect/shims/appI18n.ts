// The app's i18n singleton, for the page. The app's formatting and locale
// modules read one instance by import; the page holds its own, started over
// one locale chunk, so the build resolves `@/i18n` to this file for those
// modules and the page hands its instance to `bindI18n` once it has one.

import type { i18n as I18n } from 'i18next';

let bound: I18n | null = null;

/** Hand over the page's instance. */
export function bindI18n(instance: I18n): void {
  bound = instance;
}

/** The page's instance, as the two members the app's modules call. */
export const i18n = {
  t: (key: string, params?: Record<string, unknown>): string =>
    bound ? String(bound.t(key as never, params as never)) : key,
  get language(): string {
    return bound?.language ?? '';
  },
};

export function getCurrentLanguage(): string {
  return i18n.language;
}
