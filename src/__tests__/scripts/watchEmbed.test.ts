/**
 * Scenario: the iOS archive is meant to carry the watch app, and an archive
 * that dropped it is still signed and still installs.
 *
 * Expected behaviour: the listing of the unpacked app and the watch's
 * Info.plist are judged, and each missing piece is named.
 */
const { watchEmbedProblems, ICON_ENTRY } = require('../../../scripts/lib/watch-embed.js');

const WATCH = 'Watch/VeloqWatch.app';
const APP_ID = 'com.example.phone';
const FILES = ['Info.plist', `${WATCH}/Info.plist`, `${WATCH}/Assets.car`, `${WATCH}/VeloqWatch`];
const INFO = {
  WKCompanionAppBundleIdentifier: APP_ID,
  WKRunsIndependentlyOfCompanionApp: false,
};
const check = (files: string[], info: unknown = INFO) =>
  watchEmbedProblems({ files, info, appBundleId: APP_ID });

describe('the watch app embedded in the iOS archive', () => {
  it('passes with the watch app, its plist and its catalogue', () => {
    expect(check(FILES)).toEqual([]);
  });

  it('refuses an app with no watch app, naming the path', () => {
    const problems = check(['Info.plist', 'Veloq']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${WATCH}/Info.plist`);
  });

  it('refuses a companion id that belongs to another app', () => {
    const problems = check(FILES, { ...INFO, WKCompanionAppBundleIdentifier: 'com.example.other' });
    expect(problems).toEqual([expect.stringContaining('com.example.other')]);
  });

  it('refuses a watch app that runs independently of the phone', () => {
    const problems = check(FILES, { ...INFO, WKRunsIndependentlyOfCompanionApp: true });
    expect(problems).toEqual([expect.stringContaining('WKRunsIndependentlyOfCompanionApp')]);
  });

  it('refuses a watch app with no compiled catalogue, where the icon lives', () => {
    const problems = check(FILES.filter((f) => !f.endsWith('Assets.car')));
    expect(problems).toEqual([expect.stringContaining(`${WATCH}/Assets.car`)]);
  });

  it('does not take a file that only sits beside the watch app for it', () => {
    const problems = check(['Info.plist', 'Watch/VeloqWatch.appex/Info.plist']);
    expect(problems[0]).toContain(`${WATCH}/Info.plist`);
  });

  it('names the catalogue entry the macOS check requires', () => {
    expect(ICON_ENTRY).toBe('AppIcon');
  });
});
