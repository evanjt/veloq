/**
 * Scenario: the Play listing carries one promo video per language, linked from
 * `video.txt` in each locale folder.
 *
 * Expected behaviour: the plan has one cut per language present in the Android
 * metadata, every English locale maps to the one English cut, and a locale
 * gets a `video.txt` only when its cut has a YouTube URL.
 */

const { planPromoVideos, ENGLISH_CUT } = require('../../../scripts/lib/play-promo-video-plan.js');

const LOCALES = ['en-AU', 'en-GB', 'en-US', 'de-DE', 'es-419', 'es-ES'];
const URL_EN = 'https://www.youtube.com/watch?v=abc123DEF45';

describe('planPromoVideos', () => {
  it('plans one cut per language and shares the English cut', () => {
    const plan = planPromoVideos({ locales: LOCALES, urls: {} });
    expect(plan.errors).toEqual([]);
    expect(plan.cuts.map((c: { cut: string }) => c.cut).sort()).toEqual(
      [ENGLISH_CUT, 'de-DE', 'es-419', 'es-ES'].sort()
    );
    const english = plan.cuts.find((c: { cut: string }) => c.cut === ENGLISH_CUT);
    expect(english.locales).toEqual(['en-AU', 'en-GB', 'en-US']);
  });

  it('writes video.txt only for locales whose cut has a URL', () => {
    const plan = planPromoVideos({ locales: LOCALES, urls: { [ENGLISH_CUT]: URL_EN } });
    expect(plan.videoFiles).toEqual([
      { locale: 'en-AU', url: URL_EN },
      { locale: 'en-GB', url: URL_EN },
      { locale: 'en-US', url: URL_EN },
    ]);
  });

  it('writes nothing when no cut has a URL', () => {
    expect(planPromoVideos({ locales: LOCALES, urls: {} }).videoFiles).toEqual([]);
  });

  it('refuses a URL that is not a YouTube link and writes nothing', () => {
    const plan = planPromoVideos({
      locales: LOCALES,
      urls: { [ENGLISH_CUT]: URL_EN, 'de-DE': 'https://example.com/v.mp4' },
    });
    expect(plan.errors).toHaveLength(1);
    expect(plan.videoFiles).toEqual([]);
  });

  it('refuses a URL for a cut the metadata does not have', () => {
    const plan = planPromoVideos({ locales: ['en-US'], urls: { 'fr-FR': URL_EN } });
    expect(plan.errors).toHaveLength(1);
    expect(plan.videoFiles).toEqual([]);
  });

  it('plans nothing for an empty metadata folder', () => {
    expect(planPromoVideos({ locales: [], urls: {} })).toEqual({
      cuts: [],
      videoFiles: [],
      errors: [],
    });
  });
});
