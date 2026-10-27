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
  syncReadmeStrip,
  syncSiteGallery,
  type SitePlatform,
  type SiteSets,
  syncSiteHook,
} from '../../../scripts/site-copy';
import { CAPTURED_STEMS, shotsFor } from '../../../scripts/store-shots';
import { WEB_PLATFORMS, webSets } from '../../../scripts/store-screenshots';

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

const GALLERY_PAGE = `<div>
  <!-- store-copy:gallery -->
  <ol class="shots" data-platform="android"></ol>
  <!-- /store-copy:gallery -->
</div>`;

const shot = (platform: string, stem: string, caption: string) => ({
  file: `${platform}/${stem}.png`,
  dark: `${platform}/dark/${stem}.png`,
  caption,
  width: 720,
  height: 1584,
});

const SETS: SiteSets = {
  android: [
    shot('android', '01-launch', 'Launch from "any" beach'),
    shot('android', '02-wind', 'Gusts'),
  ],
  ios: [shot('ios', '01-launch', 'Launch')],
  ipad: [],
};

/** Each platform carousel in the gallery, with the image paths its markup names. */
function galleryLists(html: string) {
  return [
    ...html.matchAll(
      /<div class="carousel" data-platform="(\w+)"([^>]*)>([\s\S]*?<\/ol>[\s\S]*?)<\/div>\s*<\/div>/g
    ),
  ].map((m) => ({
    platform: m[1],
    hidden: /\bhidden\b/.test(m[2] ?? ''),
    light: [...(m[3] ?? '').matchAll(/<img src="screenshots\/([^"]+)"/g)].map((x) => x[1]),
    dark: [...(m[3] ?? '').matchAll(/srcset="screenshots\/([^"]+)"/g)].map((x) => x[1]),
    sources: (m[3] ?? '').match(/<source media="\(prefers-color-scheme: dark\)"/g)?.length ?? 0,
    slides: (m[3] ?? '').match(/<li class="slide/g)?.length ?? 0,
    dots: (m[3] ?? '').match(/class="carousel-dot/g)?.length ?? 0,
    prev: /class="carousel-nav prev" aria-label="[^"]+"/.test(m[3] ?? ''),
    next: /class="carousel-nav next" aria-label="[^"]+"/.test(m[3] ?? ''),
    frame: /class="phone-frame"/.test(m[3] ?? ''),
  }));
}

describe('syncSiteGallery', () => {
  it('writes one carousel per platform with shots, the first shown and the rest hidden', () => {
    const lists = galleryLists(syncSiteGallery(GALLERY_PAGE, SETS));
    expect(lists.map((l) => [l.platform, l.hidden])).toEqual([
      ['android', false],
      ['ios', true],
    ]);
    expect(lists[0]?.light).toEqual(['android/01-launch.png', 'android/02-wind.png']);
    expect(lists[0]?.dark).toEqual(['android/dark/01-launch.png', 'android/dark/02-wind.png']);
    expect(lists[0]?.sources).toBe(2);
  });

  it('gives each carousel one slide and one dot per shot, with labelled controls in a phone frame', () => {
    const [android, ios] = galleryLists(syncSiteGallery(GALLERY_PAGE, SETS));
    expect(android).toMatchObject({ slides: 2, dots: 2, prev: true, next: true, frame: true });
    expect(ios).toMatchObject({ slides: 1, dots: 1, prev: true, next: true, frame: true });
  });

  it('starts on the first slide and captions it', () => {
    const html = syncSiteGallery(GALLERY_PAGE, SETS);
    expect(html).toContain(
      '<li class="slide active" data-caption="Launch from &quot;any&quot; beach">'
    );
    expect(html).toContain(
      '<p class="carousel-caption" aria-live="polite">Launch from &quot;any&quot; beach</p>'
    );
  });

  it('gives each image its size and lazy loading, and escapes the caption', () => {
    const html = syncSiteGallery(GALLERY_PAGE, SETS);
    expect(html).toContain(
      'width="720" height="1584" loading="lazy" alt="Launch from &quot;any&quot; beach"'
    );
  });

  it('is unchanged by a second run', () => {
    const once = syncSiteGallery(GALLERY_PAGE, SETS);
    expect(syncSiteGallery(once, SETS)).toBe(once);
  });

  it('refuses a page without the markers', () => {
    expect(() => syncSiteGallery('<ol></ol>', SETS)).toThrow(/store-copy:gallery/);
  });
});

describe('webSets', () => {
  const caption = { kicker: 'K', cap: 'Line one\nline two', sub: 'S' };
  const captions = {
    shots: Array.from({ length: 9 }, () => caption),
    tagline: 't',
  };
  const sets = webSets(captions);

  it.each(Object.entries(WEB_PLATFORMS))(
    'lists the captured shots of the %s slot in store order, light and dark',
    (platform, target) => {
      const stems = shotsFor(target)
        .filter((s) => s.source === 'captured')
        .map((s) => s.stem);
      const set = sets[platform as SitePlatform];
      expect(set.map((s) => s.file)).toEqual(stems.map((stem) => `${platform}/${stem}.png`));
      expect(set.map((s) => s.dark)).toEqual(stems.map((stem) => `${platform}/dark/${stem}.png`));
      expect(set[0]?.caption).toBe('Line one line two');
    }
  );

  it('sizes each platform from its own capture to fit the web box', () => {
    expect(sets.android[0]).toMatchObject({ width: 713, height: 1584 });
    expect(sets.ios[0]).toMatchObject({ width: 720, height: 1564 });
    expect(sets.ipad[0]).toMatchObject({ width: 720, height: 960 });
  });

  it('carries only shots the capture flow takes', () => {
    for (const set of Object.values(sets)) {
      for (const s of set) {
        expect(CAPTURED_STEMS).toContain(s.file.replace(/^\w+\//, '').replace(/\.png$/, ''));
      }
    }
  });
});

describe('syncReadmeStrip', () => {
  const caption = { kicker: 'K', cap: 'Line one\nline two', sub: 'S' };
  const sets = webSets({ shots: Array.from({ length: 9 }, () => caption), tagline: 't' });
  const stems = (md: string) =>
    [...md.matchAll(/docs\/screenshots\/([^"]+)"/g)].map((m) => m[1] ?? '');
  const README = [
    'intro',
    '<!-- store-copy:readme-strip -->',
    '<p align="center">',
    '  <img src="docs/screenshots/android/01-old.png" width="16%" alt="Old" />',
    '</p>',
    '<!-- /store-copy:readme-strip -->',
    'outro',
  ].join('\n');

  it('names the first six Android shots the capture writes, in order', () => {
    const out = syncReadmeStrip(README, sets.android);
    expect(stems(out)).toEqual(sets.android.slice(0, 6).map((s) => s.file));
    expect(out.startsWith('intro\n')).toBe(true);
    expect(out.endsWith('\noutro')).toBe(true);
    expect(syncReadmeStrip(out, sets.android)).toBe(out);
  });

  it('refuses a README without the markers', () => {
    expect(() => syncReadmeStrip('no strip', sets.android)).toThrow(/store-copy:readme-strip/);
  });

  it('is present in the README as committed', () => {
    const readme = fs.readFileSync(path.resolve(__dirname, '../../../README.md'), 'utf8');
    expect(() => syncReadmeStrip(readme, sets.android)).not.toThrow();
  });
});

describe('the website gallery', () => {
  const root = path.resolve(__dirname, '../../..');
  const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const exists = (rel: string) => fs.existsSync(path.join(root, 'docs', 'screenshots', rel));

  it('names a light and a dark image for every shot, and each exists', () => {
    const lists = galleryLists(html);
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list.dark.length).toBe(list.light.length);
      for (const rel of [...list.light, ...list.dark]) {
        expect(`${rel}: ${exists(rel ?? '')}`).toBe(`${rel}: true`);
      }
    }
  });

  it('keeps each image under its own platform directory', () => {
    for (const list of galleryLists(html)) {
      for (const rel of [...list.light, ...list.dark]) {
        expect(rel?.startsWith(`${list.platform}/`)).toBe(true);
      }
    }
  });

  it('shows only images the README strip also finds on disk', () => {
    const named = [...readme.matchAll(/docs\/screenshots\/([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(named.length).toBeGreaterThan(0);
    for (const rel of named) expect(`${rel}: ${exists(rel)}`).toBe(`${rel}: true`);
  });

  it('carries no screenshot the page does not name', () => {
    const named = new Set(galleryLists(html).flatMap((l) => [...l.light, ...l.dark]));
    const onDisk = (dir: string): string[] =>
      fs
        .readdirSync(path.join(root, 'docs', 'screenshots', dir), { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? onDisk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    expect(onDisk('android').sort()).toEqual(
      [...named].filter((n) => n?.startsWith('android/')).sort()
    );
  });
});
