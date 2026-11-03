/**
 * Scenario: the store listing places one header asset and one search result
 * asset on every store locale, from a folder per language, and the English set
 * is shared by every English locale.
 *
 * Expected behaviour: the plan has one header and one search entry per store
 * locale, English locales read the shared English folder, a locale folder wins
 * over the shared one, and an asset whose pixel size differs from the spec, a
 * missing asset or a locale with no source is refused.
 */

const {
  planAssets,
  SHARED_ENGLISH,
  ENGLISH_LOCALES,
} = require('../../../scripts/lib/app-store-asset-plan.js');

const SPECS = {
  header: { width: 3840, height: 1646 },
  search: { width: 3840, height: 2560 },
};

const STILLS = [
  { file: 'header.png', kind: 'header', medium: 'still', width: 3840, height: 1646 },
  { file: 'search.png', kind: 'search', medium: 'still', width: 3840, height: 2560 },
];

describe('planAssets', () => {
  it('plans one header and one search asset per store locale and shares English', () => {
    const plan = planAssets({
      storeLocales: ['en-AU', 'en-GB', 'en-CA', 'en-US', 'de-DE'],
      folders: { [SHARED_ENGLISH]: STILLS, 'de-DE': STILLS },
      specs: SPECS,
      medium: 'still',
    });
    expect(plan.errors).toEqual([]);
    expect(plan.entries).toHaveLength(10);
    const english = plan.entries.filter((e: { locale: string }) =>
      ENGLISH_LOCALES.includes(e.locale)
    );
    expect(english).toHaveLength(8);
    expect(english.every((e: { folder: string }) => e.folder === SHARED_ENGLISH)).toBe(true);
    expect(
      plan.entries
        .filter((e: { locale: string }) => e.locale === 'de-DE')
        .map((e: { kind: string }) => e.kind)
    ).toEqual(['header', 'search']);
  });

  it('prefers a locale folder over the shared English one', () => {
    const plan = planAssets({
      storeLocales: ['en-GB'],
      folders: { [SHARED_ENGLISH]: STILLS, 'en-GB': STILLS },
      specs: SPECS,
      medium: 'still',
    });
    expect(plan.entries.map((e: { folder: string }) => e.folder)).toEqual(['en-GB', 'en-GB']);
  });

  it('refuses an asset whose pixel size differs from the spec', () => {
    const wrong = [{ ...STILLS[0], height: 1645 }, STILLS[1]];
    const plan = planAssets({
      storeLocales: ['de-DE'],
      folders: { 'de-DE': wrong },
      specs: SPECS,
      medium: 'still',
    });
    expect(plan.errors).toEqual([
      expect.stringContaining('de-DE header.png is 3840x1645, the spec is 3840x1646'),
    ]);
    expect(plan.entries).toEqual([]);
  });

  it('refuses a locale with no folder and a folder missing one kind', () => {
    const plan = planAssets({
      storeLocales: ['fr-FR', 'it'],
      folders: { it: [STILLS[0]] },
      specs: SPECS,
      medium: 'still',
    });
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fr-FR has no asset folder'),
        expect.stringContaining('it has no search still'),
      ])
    );
  });

  it('reads videos only when planning videos', () => {
    const video = {
      file: 'header.mp4',
      kind: 'header',
      medium: 'video',
      width: 3840,
      height: 1646,
    };
    const plan = planAssets({
      storeLocales: ['de-DE'],
      folders: {
        'de-DE': [...STILLS, video, { ...video, file: 'search.mp4', kind: 'search', height: 2560 }],
      },
      specs: SPECS,
      medium: 'video',
    });
    expect(plan.errors).toEqual([]);
    expect(plan.entries.map((e: { file: string }) => e.file)).toEqual(['header.mp4', 'search.mp4']);
  });

  it('refuses a missing or empty spec', () => {
    const plan = planAssets({
      storeLocales: ['de-DE'],
      folders: { 'de-DE': STILLS },
      specs: { header: SPECS.header },
      medium: 'still',
    });
    expect(plan.errors).toEqual([expect.stringContaining('no spec for search')]);
  });
});
