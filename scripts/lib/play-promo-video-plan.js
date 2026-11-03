// Which promo video cut serves which Play locale, and which locales get a
// `video.txt`. Play takes the video only as a YouTube URL, so a cut is built
// once per language and the English locales share one. The plan is pure: it
// reads no file, so the build script and its test share one judge.

const ENGLISH_CUT = 'en';
const ENGLISH_LOCALES = ['en-AU', 'en-CA', 'en-GB', 'en-US'];
const YOUTUBE = /^https:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}([&?][\w=&%-]*)?$/;

/**
 * @param {{ locales: string[], urls: Record<string, string> }} input
 *   `locales` are the folders under `metadata/android`. `urls` is keyed by cut.
 * @returns {{cuts: {cut: string, locales: string[]}[], videoFiles: {locale: string, url: string}[], errors: string[]}}
 *   `videoFiles` is empty whenever `errors` is not, so nothing is written from a part-wrong set.
 */
function planPromoVideos({ locales, urls }) {
  const byCut = new Map();
  for (const locale of locales) {
    const cut = ENGLISH_LOCALES.includes(locale) ? ENGLISH_CUT : locale;
    byCut.set(cut, [...(byCut.get(cut) ?? []), locale]);
  }
  const cuts = [...byCut].map(([cut, members]) => ({ cut, locales: members.sort() }));
  const errors = [];
  for (const [cut, url] of Object.entries(urls)) {
    if (!byCut.has(cut)) errors.push(`${cut} has no locale folder in the Android metadata`);
    else if (!YOUTUBE.test(url)) errors.push(`${cut} url is not a YouTube link: ${url}`);
  }
  const videoFiles =
    errors.length > 0
      ? []
      : cuts.flatMap(({ cut, locales: members }) =>
          urls[cut] ? members.map((locale) => ({ locale, url: urls[cut] })) : []
        );
  return { cuts, videoFiles, errors };
}

module.exports = { planPromoVideos, ENGLISH_CUT, ENGLISH_LOCALES };
