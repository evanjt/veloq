/**
 * Scenario: the website's hero line and feature grid are copied from the
 * store listings, but the page's language script sets every `data-i18n`
 * element from its translations table on load, English included.
 *
 * Expected behaviour: the sync writes each language's listing hook and
 * listing sections into the translations table as well as between the
 * markers, so what a visitor reads in any language is the listing's.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  FEATURE_CARDS,
  SITE_HOOK_LOCALES,
  listingSections,
  syncSiteFeatures,
  syncSiteGallery,
  syncSiteHook,
} from '../../../scripts/site-copy';
import { CAPTIONS, SHOT_STEMS, webShots } from '../../../scripts/store-screenshots';

const PAGE = `<p data-i18n="hero.subtitle">
  <!-- store-copy:hook -->Old English line.<!-- /store-copy:hook -->
</p>
<script>
  const translations = {
    en: {
      "hero.title": "Kite logs",
      "hero.subtitle":
        "Old English line.",
      "features.subtitle": "Unrelated \\"quoted\\" text.",
    },
    de: {
      "hero.subtitle": "Alte \\"deutsche\\" Zeile.",
      "features.subtitle": "Anderes.",
    },
  };
</script>`;

/** The string a language's table gives `key`, read back as the page's script would. */
function tableEntry(html: string, lang: string, key: string): string | undefined {
  const table = html.slice(html.indexOf('const translations = '));
  const object = table.slice('const translations = '.length, table.indexOf('};') + 1);
  const translations = new Function(`return ${object}`)() as Record<string, Record<string, string>>;
  return translations[lang]?.[key];
}

describe('syncSiteHook', () => {
  const hooks = { en: 'Kite sessions, read and charted.', de: 'Drachen "Sitzungen", gelesen.' };

  it('writes the hook between the markers', () => {
    const out = syncSiteHook(PAGE, hooks);
    expect(out).toContain(
      '<!-- store-copy:hook -->Kite sessions, read and charted.<!-- /store-copy:hook -->'
    );
  });

  it('writes every language hook into the translations table the page applies on load', () => {
    const out = syncSiteHook(PAGE, hooks);
    expect(tableEntry(out, 'en', 'hero.subtitle')).toBe(hooks.en);
    expect(tableEntry(out, 'de', 'hero.subtitle')).toBe(hooks.de);
  });

  it('leaves every other entry as it was', () => {
    const out = syncSiteHook(PAGE, hooks);
    expect(tableEntry(out, 'en', 'hero.title')).toBe('Kite logs');
    expect(tableEntry(out, 'en', 'features.subtitle')).toBe('Unrelated "quoted" text.');
    expect(tableEntry(out, 'de', 'features.subtitle')).toBe('Anderes.');
  });

  it('is unchanged by a second run', () => {
    const once = syncSiteHook(PAGE, hooks);
    expect(syncSiteHook(once, hooks)).toBe(once);
  });

  it('refuses a page without the markers', () => {
    expect(() => syncSiteHook('<p>no markers</p>', hooks)).toThrow(/store-copy/);
  });

  it('refuses a hook for a language the page has no table entry for', () => {
    expect(() => syncSiteHook(PAGE, { ...hooks, fr: 'Ligne.' })).toThrow(/fr/);
  });

  it('maps every language the site offers to a listing locale that has a promotional text', () => {
    const root = path.resolve(__dirname, '../../..');
    const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
    const offered = [...html.matchAll(/data-lang="([a-z]+)"/g)].map((m) => m[1]).sort();
    expect(Object.keys(SITE_HOOK_LOCALES).sort()).toEqual(offered);
    for (const locale of Object.values(SITE_HOOK_LOCALES)) {
      const promo = path.join(root, 'config/fastlane/metadata/ios', locale, 'promotional_text.txt');
      expect(fs.existsSync(promo)).toBe(true);
    }
  });
});

const GRID_PAGE = `<div class="feature-grid">
  <!-- store-copy:features -->
  <div class="feature"><h3 data-i18n="features.hover.title">Hovering</h3></div>
  <!-- /store-copy:features -->
</div>
<script>
  const translations = {
    en: {
      "features.title": "Kite logs",
      "features.subtitle":
        "Every kite session.",
      "features.hover.title": "Hovering",
      "features.hover.desc":
        "Old CTL card.",
      "getStarted.title": "Start",
    },
    de: {
      "features.subtitle": "Jede Sitzung.",
      "features.hover.title": "Schweben",
      "features.hover.desc": "Alte Karte.",
      "getStarted.title": "Los",
    },
  };
</script>`;

/** One invented section per card, titled and worded for `lang`. */
function kiteSections(lang: string, override: Record<number, string> = {}) {
  return FEATURE_CARDS.map((_card, i) => ({
    title: `${lang} kite ${i}`,
    body: override[i] ?? `${lang} line & <string> ${i}, "tethered".`,
  }));
}

/** Every feature card entry a language's table carries, as key to text. */
function cardEntries(html: string, lang: string): Record<string, string> {
  const table = html.slice(html.indexOf('const translations = '));
  const object = table.slice('const translations = '.length, table.indexOf('};') + 1);
  const translations = new Function(`return ${object}`)() as Record<string, Record<string, string>>;
  return Object.fromEntries(
    Object.entries(translations[lang] ?? {}).filter(
      ([key]) =>
        key.startsWith('features.') && key !== 'features.title' && key !== 'features.subtitle'
    )
  );
}

/** The text a visitor reads for an entry once the page has set it as innerHTML. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

describe('listingSections', () => {
  const description = [
    'Kite Log reads your kite sessions.',
    'Launch\nLaunch from any beach.',
    'Wind\nGusts and lulls on one chart.',
    'Supports twenty kite shapes.',
    'Not affiliated with any beach.',
  ].join('\n\n');

  it('takes each titled paragraph and skips the intro and the closing lines', () => {
    expect(listingSections(description)).toEqual([
      { title: 'Launch', body: 'Launch from any beach.' },
      { title: 'Wind', body: 'Gusts and lulls on one chart.' },
    ]);
  });

  it('returns nothing for a description with no titled paragraph', () => {
    expect(listingSections('One line.\n\nAnother line.')).toEqual([]);
  });
});

describe('syncSiteFeatures', () => {
  const sections = { en: kiteSections('en'), de: kiteSections('de') };

  it('writes one card per listing section between the markers, in order', () => {
    const out = syncSiteFeatures(GRID_PAGE, sections);
    const grid = out.slice(
      out.indexOf('<!-- store-copy:features -->'),
      out.indexOf('<!-- /store-copy:features -->')
    );
    const titles = [...grid.matchAll(/<h3 data-i18n="([^"]+)">([^<]*)<\/h3>/g)];
    expect(titles.map((m) => m[1])).toEqual(FEATURE_CARDS.map((c) => `features.${c.key}.title`));
    expect(titles.map((m) => m[2])).toEqual(sections.en.map((s) => s.title));
    expect(grid).not.toContain('Hovering');
  });

  it('gives every language exactly its listing sections and no other card', () => {
    const out = syncSiteFeatures(GRID_PAGE, sections);
    for (const lang of ['en', 'de']) {
      const expected: Record<string, string> = {};
      FEATURE_CARDS.forEach((card, i) => {
        expected[`features.${card.key}.title`] = sections[lang as 'en' | 'de'][i].title;
        expected[`features.${card.key}.desc`] = sections[lang as 'en' | 'de'][i].body;
      });
      const read = Object.fromEntries(
        Object.entries(cardEntries(out, lang)).map(([k, v]) => [k, unescapeHtml(v)])
      );
      expect(read).toEqual(expected);
    }
  });

  it('carries a changed listing section into the grid of that language only', () => {
    const before = syncSiteFeatures(GRID_PAGE, sections);
    const changed = { ...sections, de: kiteSections('de', { 3: 'Neue Zeile.' }) };
    const after = syncSiteFeatures(before, changed);
    const key = `features.${FEATURE_CARDS[3].key}.desc`;
    expect(cardEntries(after, 'de')[key]).toBe('Neue Zeile.');
    expect(cardEntries(after, 'en')).toEqual(cardEntries(before, 'en'));
  });

  it('leaves the section heading and every other entry as they were', () => {
    const out = syncSiteFeatures(GRID_PAGE, sections);
    expect(tableEntry(out, 'en', 'features.title')).toBe('Kite logs');
    expect(tableEntry(out, 'en', 'features.subtitle')).toBe('Every kite session.');
    expect(tableEntry(out, 'de', 'getStarted.title')).toBe('Los');
  });

  it('is unchanged by a second run', () => {
    const once = syncSiteFeatures(GRID_PAGE, sections);
    expect(syncSiteFeatures(once, sections)).toBe(once);
  });

  it('refuses a listing whose sections do not match the cards', () => {
    expect(() =>
      syncSiteFeatures(GRID_PAGE, { ...sections, de: kiteSections('de').slice(1) })
    ).toThrow(/de/);
  });

  it('refuses a page without the grid markers', () => {
    expect(() => syncSiteFeatures('<div>no grid</div>', sections)).toThrow(/store-copy/);
  });
});

describe('docs/index.html', () => {
  const root = path.resolve(__dirname, '../../..');
  const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');

  it('shows every listing section, and only those, in every site language', () => {
    for (const [lang, locale] of Object.entries(SITE_HOOK_LOCALES)) {
      const description = fs.readFileSync(
        path.join(root, 'config/fastlane/metadata/ios', locale, 'description.txt'),
        'utf8'
      );
      const listed = listingSections(description);
      const cards = cardEntries(html, lang);
      const shown = FEATURE_CARDS.map((card) => ({
        title: unescapeHtml(cards[`features.${card.key}.title`] ?? ''),
        body: unescapeHtml(cards[`features.${card.key}.desc`] ?? ''),
      }));
      expect({ lang, cards: Object.keys(cards).length, shown }).toEqual({
        lang,
        cards: listed.length * 2,
        shown: listed,
      });
    }
  });
});

const GALLERY_PAGE = `<script>
  const mediaItems = [
    // store-copy:gallery
    { type: "image", src: "screenshots/09-kite-loop.png", caption: "Kite Loops" },
    // /store-copy:gallery
  ];
</script>`;

/** The gallery the page's script would build, read back from its mediaItems array. */
function galleryItems(html: string): { type: string; src: string; caption: string }[] {
  const start = html.indexOf('const mediaItems = ') + 'const mediaItems = '.length;
  const array = html.slice(start, html.indexOf('];', start) + 1);
  return new Function(`return ${array}`)() as { type: string; src: string; caption: string }[];
}

describe('syncSiteGallery', () => {
  const shots = [
    { file: '01-launch.png', caption: 'Launch from "any" beach' },
    { file: '02-wind.png', caption: 'Gusts and lulls' },
  ];

  it('lists exactly the given shots, in order, in place of what the page had', () => {
    expect(galleryItems(syncSiteGallery(GALLERY_PAGE, shots))).toEqual([
      { type: 'image', src: 'screenshots/01-launch.png', caption: 'Launch from "any" beach' },
      { type: 'image', src: 'screenshots/02-wind.png', caption: 'Gusts and lulls' },
    ]);
  });

  it('is unchanged by a second run', () => {
    const once = syncSiteGallery(GALLERY_PAGE, shots);
    expect(syncSiteGallery(once, shots)).toBe(once);
  });

  it('refuses a page without the markers', () => {
    expect(() => syncSiteGallery('<script>const mediaItems = [];</script>', shots)).toThrow(
      /store-copy:gallery/
    );
  });
});

describe('the website gallery', () => {
  const root = path.resolve(__dirname, '../../..');
  const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');

  it('shows one shot per store shot, each a file the web build writes from the capture', () => {
    const shots = webShots();
    expect(shots.map((s) => s.file)).toEqual(SHOT_STEMS.map((stem) => `${stem}.png`));
    expect(galleryItems(html).map((item) => item.src)).toEqual(
      shots.map((s) => `screenshots/${s.file}`)
    );
  });

  it('carries no screenshot the web build does not write', () => {
    const files = fs.readdirSync(path.join(root, 'docs', 'screenshots')).sort();
    expect(files).toEqual(
      webShots()
        .map((s) => s.file)
        .sort()
    );
  });

  it('captions each shot with the store caption of the locale the site copy reads', () => {
    expect(galleryItems(html).map((item) => item.caption)).toEqual(
      CAPTIONS[SITE_HOOK_LOCALES.en].shots.map((shot) => shot.cap.replace(/\n/g, ' '))
    );
  });
});
