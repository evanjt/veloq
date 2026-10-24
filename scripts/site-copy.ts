/**
 * The website hero line and feature grid, taken from the store listings so
 * the site never drifts from them. Each site language reads the promotional
 * text and the description sections of one App Store locale.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const MARKER = /(<!-- store-copy:hook -->)([\s\S]*?)(<!-- \/store-copy:hook -->)/;
const GALLERY_MARKER = /(\/\/ store-copy:gallery)([\s\S]*?)(\n([ \t]*)\/\/ \/store-copy:gallery)/;
const GRID_MARKER =
  /(<!-- store-copy:features -->)([\s\S]*?)(\n[ \t]*<!-- \/store-copy:features -->)/;

/** Site language to the App Store locale whose promotional text it shows. */
export const SITE_HOOK_LOCALES: Record<string, string> = {
  en: 'en-AU',
  de: 'de-DE',
  nl: 'nl-NL',
  fr: 'fr-FR',
  it: 'it',
  es: 'es-ES',
  pt: 'pt-BR',
  pl: 'pl',
  da: 'da',
  ja: 'ja',
  zh: 'zh-Hans',
};

// A language's block in the page's translations table, and the hero entry
// inside it. The page's script sets every `data-i18n` element from this table
// on load, English included, so the markers alone are overwritten.
const languageBlock = (lang: string) => new RegExp(`^([ \\t]*)${lang}: \\{$`, 'm');
const HERO_ENTRY = /("hero\.subtitle":\s*)"(?:[^"\\]|\\.)*"/;

/** A titled section of a store description: a heading line, then its text. */
export interface ListingSection {
  title: string;
  body: string;
}

/**
 * The feature rows in the order the description's sections run in every
 * locale, each with the key its translations use.
 */
export const FEATURE_CARDS: { key: string }[] = [
  { key: 'record' },
  { key: 'insights' },
  { key: 'maps' },
  { key: 'routes' },
  { key: 'charts' },
  { key: 'fitness' },
  { key: 'strength' },
  { key: 'widgets' },
  { key: 'notifications' },
  { key: 'backups' },
  { key: 'privacy' },
];

/**
 * The titled sections of a store description. A section is a paragraph of
 * exactly two lines; the opening summary and the closing one-line paragraphs
 * are not sections.
 */
export function listingSections(description: string): ListingSection[] {
  return description
    .trim()
    .split(/\n\s*\n/)
    .flatMap((paragraph) => {
      const [title, body, ...rest] = paragraph.trim().split('\n');
      if (title === undefined || body === undefined || rest.length > 0) return [];
      return [{ title: title.trim(), body: body.trim() }];
    });
}

/** Each feature card beside the listing section it shows. */
function cardSections(lang: string, list: ListingSection[] | undefined) {
  if (!list || list.length !== FEATURE_CARDS.length) {
    throw new Error(
      `the ${lang} listing has ${list?.length ?? 0} sections, the grid has ${FEATURE_CARDS.length} cards`
    );
  }
  return FEATURE_CARDS.flatMap((card, i) => {
    const section = list[i];
    return section ? [{ ...card, ...section }] : [];
  });
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The span of a language's block in the translations table. */
function languageSpan(html: string, lang: string): { start: number; end: number } {
  const block = languageBlock(lang).exec(html);
  if (!block) throw new Error(`docs/index.html has no translations for ${lang}`);
  const start = block.index + block[0].length;
  return { start, end: html.indexOf(`\n${block[1]}}`, start) };
}

// A feature card's entry in a language block, its value on the key's line or
// the next. The grid's own heading and subtitle are not cards.
const CARD_ENTRY =
  /\n[ \t]*"features\.(?!title"|subtitle")[a-z]+\.(?:title|desc)":\s*"(?:[^"\\]|\\.)*",?/g;
const SUBTITLE_ENTRY = /\n([ \t]*)"features\.subtitle":\s*"(?:[^"\\]|\\.)*",?/;

/**
 * The page with the feature grid rebuilt from each language's listing
 * sections: the English cards between the markers, and every language's card
 * entries in the translations table in place of the ones it had.
 */
export function syncSiteFeatures(html: string, sections: Record<string, ListingSection[]>): string {
  const grid = GRID_MARKER.exec(html);
  if (!grid) throw new Error('docs/index.html has no store-copy:features markers');
  const shown = Object.entries(sections).map(([lang, list]) => ({
    lang,
    cards: cardSections(lang, list),
  }));
  const close = grid[3] ?? '';
  const indent = close.slice(1, close.indexOf('<'));
  const cards = cardSections('en', sections.en).map(({ key, title, body }) =>
    [
      `${indent}<div class="feature">`,
      `${indent}  <h3 data-i18n="features.${key}.title">${escapeHtml(title)}</h3>`,
      `${indent}  <p data-i18n="features.${key}.desc">${escapeHtml(body)}</p>`,
      `${indent}</div>`,
    ].join('\n')
  );
  let out = html.replace(
    GRID_MARKER,
    (_m, open: string, _old: string, close: string) => `${open}\n${cards.join('\n')}${close}`
  );
  for (const { lang, cards: list } of shown) {
    const { start, end } = languageSpan(out, lang);
    const body = out.slice(start, end).replace(CARD_ENTRY, '');
    const subtitle = SUBTITLE_ENTRY.exec(body);
    if (!subtitle) throw new Error(`docs/index.html has no features subtitle for ${lang}`);
    const pad = subtitle[1] ?? '';
    const entries = list
      .map(({ key, title, body }) =>
        [
          `\n${pad}"features.${key}.title": ${JSON.stringify(escapeHtml(title))},`,
          `\n${pad}"features.${key}.desc": ${JSON.stringify(escapeHtml(body))},`,
        ].join('')
      )
      .join('');
    const at = subtitle.index + subtitle[0].length;
    out = out.slice(0, start) + body.slice(0, at) + entries + body.slice(at) + out.slice(end);
  }
  return out;
}

/**
 * The page with the hero line replaced by each language's listing hook: the
 * English one between the markers, and every one in the translations table.
 */
export function syncSiteHook(html: string, hooks: Record<string, string>): string {
  if (!MARKER.test(html)) throw new Error('docs/index.html has no store-copy markers');
  let out = html.replace(MARKER, (_m, open: string, _old: string, close: string) => {
    return `${open}${hooks.en}${close}`;
  });
  for (const [lang, hook] of Object.entries(hooks)) {
    const { start, end } = languageSpan(out, lang);
    const body = out.slice(start, end);
    if (!HERO_ENTRY.test(body)) throw new Error(`docs/index.html has no hero line for ${lang}`);
    const entry = body.replace(HERO_ENTRY, (_m, key: string) => `${key}${JSON.stringify(hook)}`);
    out = out.slice(0, start) + entry + out.slice(end);
  }
  return out;
}

/** A website screenshot: its file under docs/screenshots and the caption shown under it. */
export interface SiteShot {
  file: string;
  caption: string;
}

/** The page with its screenshot gallery replaced by `shots`, in order. */
export function syncSiteGallery(html: string, shots: SiteShot[]): string {
  if (!GALLERY_MARKER.test(html))
    throw new Error('docs/index.html has no store-copy:gallery markers');
  return html.replace(
    GALLERY_MARKER,
    (_m, open: string, _old: string, close: string, indent: string) => {
      const items = shots.map(({ file, caption }) =>
        [
          `\n${indent}{`,
          `\n${indent}  type: "image",`,
          `\n${indent}  src: ${JSON.stringify(`screenshots/${file}`)},`,
          `\n${indent}  caption: ${JSON.stringify(caption)},`,
          `\n${indent}},`,
        ].join('')
      );
      return `${open}${items.join('')}${close}`;
    }
  );
}

/**
 * Rewrites docs/index.html under `root` from the listings' promotional text
 * and description sections.
 */
export function syncSiteCopy(root: string): void {
  const hooks: Record<string, string> = {};
  const sections: Record<string, ListingSection[]> = {};
  for (const [lang, locale] of Object.entries(SITE_HOOK_LOCALES)) {
    const dir = path.join(root, 'config', 'fastlane', 'metadata', 'ios', locale);
    hooks[lang] = fs.readFileSync(path.join(dir, 'promotional_text.txt'), 'utf8').trim();
    sections[lang] = listingSections(fs.readFileSync(path.join(dir, 'description.txt'), 'utf8'));
  }
  const htmlPath = path.join(root, 'docs', 'index.html');
  const html = syncSiteHook(fs.readFileSync(htmlPath, 'utf8'), hooks);
  fs.writeFileSync(htmlPath, syncSiteFeatures(html, sections));
}
