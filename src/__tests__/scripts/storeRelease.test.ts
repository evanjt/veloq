/**
 * Scenario: a version tag sends the store listings to Google Play and the App
 * Store. Re-sending a text the store already holds lengthens review, and a
 * release with a locale's notes missing ships a blank "what's new".
 *
 * Expected behaviour: between the previous release tag and this one, only the
 * texts, images and screenshot sets that changed are staged for upload, every
 * locale's release notes always are, and a missing or oversized note refuses
 * the release by name before anything is sent, as does an App Store note left
 * as the previous release shipped it.
 */

import {
  type RepoFile,
  listingDrift,
  planStoreRelease,
  previousReleaseTag,
  storeTree,
} from '../../../scripts/store-release';

const VERSION_CODE = 41;
const NOTE = 'Faster kite tracking.\n';

/** A small listing in two locales per store, every file at content id `a`. */
function listing(): RepoFile[] {
  const files: RepoFile[] = [];
  for (const locale of ['en-US', 'fr-FR']) {
    const dir = `config/fastlane/metadata/android/${locale}`;
    files.push(
      { path: `${dir}/title.txt`, id: 'a' },
      { path: `${dir}/short_description.txt`, id: 'a' },
      { path: `${dir}/full_description.txt`, id: 'a' },
      { path: `${dir}/changelogs/${VERSION_CODE - 1}.txt`, id: 'a' },
      { path: `${dir}/changelogs/${VERSION_CODE}.txt`, id: 'a', text: NOTE },
      { path: `${dir}/images/icon.png`, id: 'a' }
    );
  }
  files.push({
    path: 'config/fastlane/metadata/android/fr-FR/images/phoneScreenshots/01-kites.png',
    id: 'a',
  });
  for (const locale of ['en-US', 'fr-FR']) {
    const dir = `config/fastlane/metadata/ios/${locale}`;
    files.push(
      { path: `${dir}/name.txt`, id: 'a' },
      { path: `${dir}/description.txt`, id: 'a' },
      { path: `${dir}/keywords.txt`, id: 'a' },
      { path: `${dir}/release_notes.txt`, id: 'a', text: NOTE }
    );
  }
  files.push(
    { path: 'docs/screenshots/01-kites.png', id: 'a' },
    { path: 'docs/screenshots/02-reels.png', id: 'a' },
    { path: 'docs/screenshots/ios/01-kites.png', id: 'a' },
    { path: 'config/fastlane/metadata/store-privacy-declarations.json', id: 'a' },
    { path: 'src/app/index.tsx', id: 'a' }
  );
  return files;
}

/**
 * The listing at the previous release tag: every file as it is now, but the
 * App Store notes are that version's own, since they carry no version.
 */
function released(): RepoFile[] {
  return listing().map((f) =>
    f.path.endsWith('/release_notes.txt') ? { ...f, id: 'p', text: 'Kite tracking.\n' } : f
  );
}

function edit(files: RepoFile[], path: string, change: Partial<RepoFile>): RepoFile[] {
  expect(files.some((f) => f.path === path)).toBe(true);
  return files.map((f) => (f.path === path ? { ...f, ...change } : f));
}

const RELEASE_NOTES = [
  `metadata/android/en-US/changelogs/${VERSION_CODE}.txt`,
  `metadata/android/fr-FR/changelogs/${VERSION_CODE}.txt`,
  'metadata/ios/en-US/release_notes.txt',
  'metadata/ios/fr-FR/release_notes.txt',
];

describe('storeTree', () => {
  it('installs docs/screenshots into the Play default listing and the App Store set', () => {
    const tree = storeTree(listing());
    expect(tree.refusals).toEqual([]);
    expect(tree.files.get('metadata/android/en-US/images/phoneScreenshots/01-kites.png')).toEqual({
      source: 'docs/screenshots/01-kites.png',
      id: 'a',
    });
    expect(tree.files.get('screenshots/en-US/01-kites.png')?.source).toBe(
      'docs/screenshots/ios/01-kites.png'
    );
  });

  it('leaves out what no store reads', () => {
    const paths = [...storeTree(listing()).files.keys()];
    expect(paths.filter((p) => !/^(metadata\/(android|ios)\/|screenshots\/)/.test(p))).toEqual([]);
    expect(paths.some((p) => p.includes('store-privacy-declarations'))).toBe(false);
  });

  it('refuses a screenshot committed where docs/screenshots installs one', () => {
    const files = [
      ...listing(),
      {
        path: 'config/fastlane/metadata/android/en-US/images/phoneScreenshots/01-kites.png',
        id: 'b',
      },
    ];
    expect(storeTree(files).refusals).toEqual([
      expect.stringContaining('metadata/android/en-US/images/phoneScreenshots/01-kites.png'),
    ]);
  });
});

describe('planStoreRelease', () => {
  it('sends only the release notes when nothing else changed', () => {
    const plan = planStoreRelease(storeTree(released()), storeTree(listing()), VERSION_CODE);
    expect(plan.refusals).toEqual([]);
    expect(plan.stage).toEqual(RELEASE_NOTES);
    expect(plan.android).toEqual({ metadata: false, images: false, screenshots: false });
    expect(plan.ios).toEqual({ screenshots: false });
  });

  it('sends one changed description for its locale only', () => {
    const current = edit(listing(), 'config/fastlane/metadata/android/fr-FR/full_description.txt', {
      id: 'b',
    });
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual(
      [...RELEASE_NOTES, 'metadata/android/fr-FR/full_description.txt'].sort()
    );
    expect(plan.android).toEqual({ metadata: true, images: false, screenshots: false });
  });

  it('sends a changed App Store keyword set and nothing else of that locale', () => {
    const current = edit(listing(), 'config/fastlane/metadata/ios/en-US/keywords.txt', { id: 'b' });
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual([...RELEASE_NOTES, 'metadata/ios/en-US/keywords.txt'].sort());
    expect(plan.android.metadata).toBe(false);
  });

  it('sends the whole set of the one locale that gained a screenshot', () => {
    const current = [
      ...listing(),
      {
        path: 'config/fastlane/metadata/android/fr-FR/images/phoneScreenshots/02-reels.png',
        id: 'a',
      },
    ];
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual(
      [
        ...RELEASE_NOTES,
        'metadata/android/fr-FR/images/phoneScreenshots/01-kites.png',
        'metadata/android/fr-FR/images/phoneScreenshots/02-reels.png',
      ].sort()
    );
    expect(plan.android).toEqual({ metadata: false, images: false, screenshots: true });
  });

  it('sends a set whose shot was removed, so the store drops it too', () => {
    const current = listing().filter((f) => f.path !== 'docs/screenshots/02-reels.png');
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual(
      [...RELEASE_NOTES, 'metadata/android/en-US/images/phoneScreenshots/01-kites.png'].sort()
    );
    expect(plan.android.screenshots).toBe(true);
  });

  it('replaces the App Store set of a locale only when that set changed', () => {
    const current = edit(listing(), 'docs/screenshots/ios/01-kites.png', { id: 'b' });
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual([...RELEASE_NOTES, 'screenshots/en-US/01-kites.png'].sort());
    expect(plan.ios).toEqual({ screenshots: true });
    expect(plan.android.screenshots).toBe(false);
  });

  it('names a set removed entirely, which no upload can clear', () => {
    const current = listing().filter((f) => !f.path.startsWith('docs/screenshots/ios/'));
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.ios.screenshots).toBe(false);
    expect(plan.notices).toEqual([expect.stringContaining('screenshots/en-US/')]);
  });

  it('sends a changed icon without the other images', () => {
    const current = edit(listing(), 'config/fastlane/metadata/android/en-US/images/icon.png', {
      id: 'b',
    });
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual([...RELEASE_NOTES, 'metadata/android/en-US/images/icon.png'].sort());
    expect(plan.android).toEqual({ metadata: false, images: true, screenshots: false });
  });

  it('ignores an older changelog edited after it shipped', () => {
    const current = edit(
      listing(),
      `config/fastlane/metadata/android/en-US/changelogs/${VERSION_CODE - 1}.txt`,
      { id: 'b' }
    );
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.stage).toEqual(RELEASE_NOTES);
  });

  it('sends everything on the first tag', () => {
    const plan = planStoreRelease(null, storeTree(listing()), VERSION_CODE);
    expect(plan.refusals).toEqual([]);
    expect(plan.stage).toEqual(
      [...storeTree(listing()).files.keys()]
        .filter((p) => !p.includes(`/changelogs/${VERSION_CODE - 1}.txt`))
        .sort()
    );
    expect(plan.android).toEqual({ metadata: true, images: true, screenshots: true });
    expect(plan.ios).toEqual({ screenshots: true });
  });

  it('refuses a locale with no release notes for this version code, by name', () => {
    const current = listing().filter(
      (f) => f.path !== `config/fastlane/metadata/android/fr-FR/changelogs/${VERSION_CODE}.txt`
    );
    const plan = planStoreRelease(storeTree(released()), storeTree(current), VERSION_CODE);
    expect(plan.refusals).toEqual([
      `metadata/android/fr-FR/changelogs/${VERSION_CODE}.txt is missing`,
    ]);
  });

  it('refuses missing App Store notes and an empty Play note, by name', () => {
    let current = listing().filter(
      (f) => f.path !== 'config/fastlane/metadata/ios/en-US/release_notes.txt'
    );
    current = edit(
      current,
      `config/fastlane/metadata/android/en-US/changelogs/${VERSION_CODE}.txt`,
      {
        text: ' \n',
      }
    );
    expect(planStoreRelease(null, storeTree(current), VERSION_CODE).refusals).toEqual([
      `metadata/android/en-US/changelogs/${VERSION_CODE}.txt is empty`,
      'metadata/ios/en-US/release_notes.txt is missing',
    ]);
  });

  it('refuses a Play note over 500 characters and passes one at 500', () => {
    const path = `config/fastlane/metadata/android/fr-FR/changelogs/${VERSION_CODE}.txt`;
    const atCap = edit(listing(), path, { text: `${'é'.repeat(499)}\n` });
    expect(planStoreRelease(null, storeTree(atCap), VERSION_CODE).refusals).toEqual([]);
    const over = edit(listing(), path, { text: `${'é'.repeat(500)}\n` });
    expect(planStoreRelease(null, storeTree(over), VERSION_CODE).refusals).toEqual([
      `metadata/android/fr-FR/changelogs/${VERSION_CODE}.txt is 501 characters, Play allows 500`,
    ]);
  });

  it('refuses App Store notes left as the previous release shipped them, naming the locale', () => {
    const previous = edit(released(), 'config/fastlane/metadata/ios/fr-FR/release_notes.txt', {
      id: 'a',
      text: NOTE,
    });
    const plan = planStoreRelease(storeTree(previous), storeTree(listing()), VERSION_CODE);
    expect(plan.refusals).toEqual([
      'metadata/ios/fr-FR/release_notes.txt is unchanged since the previous release, ' +
        'so the App Store would show its notes again',
    ]);
  });

  it('passes App Store notes rewritten in every locale', () => {
    const plan = planStoreRelease(storeTree(released()), storeTree(listing()), VERSION_CODE);
    expect(plan.refusals).toEqual([]);
  });

  it('passes App Store notes for a locale the previous release did not have', () => {
    const previous = released().filter((f) => !f.path.includes('/ios/fr-FR/'));
    const plan = planStoreRelease(storeTree(previous), storeTree(listing()), VERSION_CODE);
    expect(plan.refusals).toEqual([]);
  });

  it('carries the tree refusals into the plan', () => {
    const files = [
      ...listing(),
      {
        path: 'config/fastlane/metadata/android/en-US/images/phoneScreenshots/02-reels.png',
        id: 'b',
      },
    ];
    expect(planStoreRelease(null, storeTree(files), VERSION_CODE).refusals).toHaveLength(1);
  });
});

describe('previousReleaseTag', () => {
  const tags = [
    '0.3.8',
    '0.3.10',
    '0.3.9',
    '0.4.0',
    'pre-squash-0.4.0',
    'premerge-thing',
    '0.10.0',
  ];

  it('takes the highest release below this one by version, not by name', () => {
    expect(previousReleaseTag(tags, '0.4.1')).toBe('0.4.0');
    expect(previousReleaseTag(tags, '0.4.0')).toBe('0.3.10');
    expect(previousReleaseTag(tags, '0.11.0')).toBe('0.10.0');
  });

  it('finds none before the first release', () => {
    expect(previousReleaseTag(tags, '0.3.8')).toBeNull();
    expect(previousReleaseTag([], '1.0.0')).toBeNull();
  });
});

describe('listingDrift', () => {
  const repo = new Map([
    ['en-US/title.txt', 'Kite Log\n'],
    ['en-US/full_description.txt', 'Logs kites.\n'],
    ['fr-FR/title.txt', 'Journal de cerf-volant\n'],
  ]);

  it('reports a locale whose live text matches as matching', () => {
    const live = new Map([
      ['en-US/title.txt', 'Kite Log'],
      ['en-US/full_description.txt', 'Logs kites.\r\n'],
      ['en-US/video.txt', '\n'],
      ['fr-FR/title.txt', 'Journal de cerf-volant\n'],
    ]);
    expect(listingDrift('android', repo, live)).toEqual([
      'android en-US matches',
      'android fr-FR matches',
    ]);
  });

  it('names the field a console edit changed and a locale only one side has', () => {
    const live = new Map([
      ['en-US/title.txt', 'Kite Log'],
      ['en-US/full_description.txt', 'Logs kites, now with reels.'],
      ['de-DE/title.txt', 'Drachenbuch'],
    ]);
    expect(listingDrift('android', repo, live)).toEqual([
      'android de-DE differs: only in the store',
      'android en-US differs: full_description.txt',
      'android fr-FR differs: only in the repo',
    ]);
  });

  it('leaves release notes out, since each version carries its own', () => {
    const notes = new Map([['en-US/release_notes.txt', 'Old notes.\n']]);
    expect(listingDrift('ios', new Map([['en-US/name.txt', 'Kite Log']]), notes)).toEqual([
      'ios en-US differs: name.txt',
    ]);
  });
});
