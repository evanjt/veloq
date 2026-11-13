/**
 * Scenario: the iOS string catalogues and the widget sample are written into the
 * generated project at prebuild. A local build over an existing project skips
 * prebuild while its configuration hash matches, and the translations are left
 * out of that hash on purpose, so an edited translation reaches the binary only
 * if the build rewrites these files itself.
 *
 * Expected behaviour: a sync rewrites the catalogues and the widget sample from
 * the current locale bundles and the tracked fixture, a second sync over the same
 * input changes nothing, a project that was never generated is refused, and an
 * iOS build runs the sync after it has prepared the project.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');
const strings = require(path.join(root, 'src/plugins/nativeStrings.js'));
const { syncIosStrings } = require(path.join(root, 'scripts/lib/iosStringSync.js'));

const DEV = { APP_VARIANT: 'dev' };
const OPEN_APP_EDITED = 'Veloq öffnen, überarbeitet';

let project: string;

function catalogue(target: string) {
  return JSON.parse(
    fs.readFileSync(path.join(project, 'ios', target, 'Localizable.xcstrings'), 'utf8')
  );
}

type Bundles = Record<string, Record<string, Record<string, unknown>>>;

function openAppIn(bundles: Bundles, locale: string, value: string): Bundles {
  return {
    ...bundles,
    [locale]: {
      ...bundles[locale],
      systemSurfaces: { ...bundles[locale].systemSurfaces, openApp: value },
    },
  };
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-strings-'));
  fs.mkdirSync(path.join(project, 'widget/fixtures'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'widget/fixtures/demo.json'),
    path.join(project, 'widget/fixtures/demo.json')
  );
  fs.mkdirSync(path.join(project, 'ios/VeloqDev.xcodeproj'), { recursive: true });
  fs.writeFileSync(path.join(project, 'ios/VeloqDev.xcodeproj/project.pbxproj'), '');
  // The catalogues an earlier prebuild wrote, from the translations as they were then.
  strings.writeIosCatalogues({
    widgetDir: path.join(project, 'ios/VeloqWidget'),
    appDir: path.join(project, 'ios/VeloqDev'),
  });
  fs.writeFileSync(path.join(project, 'ios/VeloqWidget/WidgetSampleData.swift'), 'stale');
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe('iOS string catalogues reach the build without a regeneration', () => {
  it('rewrites the widget and app catalogues from the current translations', () => {
    const edited = openAppIn(strings.loadLocaleBundles(), 'de-DE', OPEN_APP_EDITED);

    syncIosStrings(project, DEV, edited);

    for (const target of ['VeloqWidget', 'VeloqDev']) {
      const value = catalogue(target).strings['Open Veloq'].localizations.de.stringUnit.value;
      expect(value).toBe(OPEN_APP_EDITED);
    }
  });

  it('rewrites the widget sample from the tracked fixture', () => {
    syncIosStrings(project, DEV, strings.loadLocaleBundles());

    const sample = fs.readFileSync(
      path.join(project, 'ios/VeloqWidget/WidgetSampleData.swift'),
      'utf8'
    );
    const fixture = fs.readFileSync(path.join(project, 'widget/fixtures/demo.json'), 'utf8');
    expect(sample).toContain('static let json');
    expect(sample).toContain(JSON.stringify(JSON.parse(fixture)));
    expect(sample).not.toContain('stale');
  });

  it('changes nothing when the same input is synced twice', () => {
    const edited = openAppIn(strings.loadLocaleBundles(), 'de-DE', OPEN_APP_EDITED);
    syncIosStrings(project, DEV, edited);
    const first = fs.readFileSync(path.join(project, 'ios/VeloqWidget/Localizable.xcstrings'));

    syncIosStrings(project, DEV, edited);

    expect(fs.readFileSync(path.join(project, 'ios/VeloqWidget/Localizable.xcstrings'))).toEqual(
      first
    );
  });

  it('refuses a project that was never generated, naming the command that generates it', () => {
    fs.rmSync(path.join(project, 'ios/VeloqDev.xcodeproj'), { recursive: true });

    expect(() => syncIosStrings(project, DEV)).toThrow(
      'node scripts/prepare-native.mjs --platform ios'
    );
  });
});
