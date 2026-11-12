/**
 * Hand the engine the exercise labels for the language the app is running in, so the
 * exercise search and the names it shows read the same text.
 *
 * i18next stays the only thing that resolves a label, so a locale that lacks one reads it
 * through its fallback chain. The engine holds the resolved table until the next call.
 */

import { i18n } from './index';
import { loadLocale, ROOT_LOCALE } from './localeBundles';
import { strength } from 'veloqrs';

/** Every catalogue label key, read from the root bundle that holds all of them. */
export function exerciseLabelKeys(): string[] {
  const labels = loadLocale(ROOT_LOCALE).exerciseLabels as Record<string, string> | undefined;
  return Object.keys(labels ?? {});
}

/** Each catalogue label key resolved to its text in the current language. */
export function exerciseLabelTable(): Map<string, string> {
  const resolve = i18n.t as unknown as (key: string) => string;
  const table = new Map<string, string>();
  for (const key of exerciseLabelKeys()) {
    const path = `exerciseLabels.${key}`;
    const text = resolve(path);
    if (text !== path) table.set(key, text);
  }
  return table;
}

export function handExerciseLabels(): void {
  if (!i18n.language) return;
  strength.setExerciseLabels(exerciseLabelTable());
}
