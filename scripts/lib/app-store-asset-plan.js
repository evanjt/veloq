// Which App Store header and search result asset goes on which store locale.
//
// Each language has a folder under `config/fastlane/store-assets/` holding a
// header and a search result asset, a still (`.png`) or a video (`.mp4`). The
// English locales share one folder, `en`, unless a locale has a folder of its
// own. The plan is pure: it reads no file and calls no network, so the upload
// script and its test share one judge of what a listing may carry.

const SHARED_ENGLISH = 'en';
const ENGLISH_LOCALES = ['en-AU', 'en-CA', 'en-GB', 'en-US'];
const KINDS = ['header', 'search'];

/** The folder that supplies a store locale, or undefined when none does. */
function folderFor(locale, folders) {
  if (folders[locale]) return locale;
  if (ENGLISH_LOCALES.includes(locale) && folders[SHARED_ENGLISH]) return SHARED_ENGLISH;
  return undefined;
}

/**
 * @param {{
 *   storeLocales: string[],
 *   folders: Record<string, {file: string, kind: string, medium: string, width: number, height: number}[]>,
 *   specs: Record<string, {width: number, height: number}>,
 *   medium: 'still' | 'video',
 * }} input
 * @returns {{entries: {locale: string, folder: string, kind: string, medium: string, file: string}[], errors: string[]}}
 *   `entries` is empty whenever `errors` is not, so nothing is placed from a listing that is part wrong.
 */
function planAssets({ storeLocales, folders, specs, medium }) {
  const entries = [];
  const errors = [];
  for (const kind of KINDS) {
    if (!specs[kind]) errors.push(`no spec for ${kind}`);
  }
  for (const locale of storeLocales) {
    const folder = folderFor(locale, folders);
    if (!folder) {
      errors.push(`${locale} has no asset folder`);
      continue;
    }
    for (const kind of KINDS) {
      const asset = folders[folder].find((a) => a.kind === kind && a.medium === medium);
      if (!asset) {
        errors.push(`${locale} has no ${kind} ${medium}`);
        continue;
      }
      const spec = specs[kind];
      if (spec && (asset.width !== spec.width || asset.height !== spec.height)) {
        errors.push(
          `${locale} ${asset.file} is ${asset.width}x${asset.height}, the spec is ${spec.width}x${spec.height}`
        );
        continue;
      }
      entries.push({ locale, folder, kind, medium, file: asset.file });
    }
  }
  return { entries: errors.length === 0 ? entries : [], errors };
}

module.exports = { planAssets, SHARED_ENGLISH, ENGLISH_LOCALES, KINDS };
