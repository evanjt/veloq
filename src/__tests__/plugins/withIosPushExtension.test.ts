/**
 * Scenario: the iOS notification service extension is a second Xcode target
 * that the prebuild writes, the way the widget one is. Nothing in `ios/` is
 * tracked, so everything the target needs has to be put there by the plugin on
 * every prebuild, and the target itself survives from the first one.
 *
 * Expected behaviour: the target is created once and never twice, every Swift
 * file in the tracked tree ends up in its Sources phase, and the settings that
 * decide whether it builds at all are on it: the bridging header that declares
 * the crate's C entries, the link flags for the Rust static library, and the
 * phase that builds that library for the SDK being built, ahead of the link.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import {
  SOURCE_DIR,
  TARGET,
  applyPushExtensionBuildSettings,
  copyDir,
  configurePushExtensionProject,
  pushSwiftFiles,
  writePushExtensionFiles,
} from '@/../src/plugins/with-ios-push-extension';
import { compiledSourceNames, targetUuidByName } from '@/../src/plugins/with-ios-widget';
import { resolvedLocale } from '../i18n/resolvedLocale';

const strings = require('@/../src/plugins/nativeStrings.js');

const projectRoot = path.join(__dirname, '../../..');

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function openFixture() {
  const dir = tempDir('veloq-push-pbx-');
  const file = path.join(dir, 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', 'project.pbxproj'), file);
  return xcode.project(file).parseSync();
}

const options = {
  swiftFiles: ['NotificationService.swift', 'VeloqPushEngine.swift'],
  bundleId: 'com.veloq.app.dev',
  version: '0.4.0',
  buildNumber: '7',
};

/** Every build configuration the plugin wrote settings onto. */
function settingsFor(proj: ReturnType<typeof openFixture>) {
  return Object.values(proj.pbxXCBuildConfigurationSection())
    .map((entry) => (typeof entry === 'string' ? undefined : entry.buildSettings))
    .filter((settings) => settings?.PRODUCT_NAME?.replace(/"/g, '') === TARGET)
    .map((settings) => settings as Record<string, string>);
}

describe('the extension target the prebuild writes', () => {
  it('compiles every Swift file the tracked tree holds', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);

    const uuid = targetUuidByName(proj, TARGET);
    expect(uuid).not.toBeNull();
    expect([...compiledSourceNames(proj, uuid as string)].sort()).toEqual(options.swiftFiles);
  });

  it('is created once, however many prebuilds run', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);
    configurePushExtensionProject(proj, options);

    const section = proj.pbxNativeTargetSection();
    const named = Object.keys(section).filter(
      (key) => key.endsWith('_comment') && String(section[key]).replace(/"/g, '') === TARGET
    );
    expect(named).toHaveLength(1);
  });

  it('adds a Swift file a later prebuild finds, to the target that already exists', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);
    configurePushExtensionProject(proj, {
      ...options,
      swiftFiles: [...options.swiftFiles, 'VeloqCredentials.swift'],
    });

    const uuid = targetUuidByName(proj, TARGET) as string;
    expect([...compiledSourceNames(proj, uuid)]).toContain('VeloqCredentials.swift');
  });

  it('is embedded in the app, which is what puts it in the bundle at all', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);

    const phases = proj.hash.project.objects.PBXCopyFilesBuildPhase ?? {};
    const embedded = Object.values(phases).flatMap((phase) => {
      const files = (phase as { files?: { comment: string }[] }).files;
      return files ? files.map((file) => file.comment) : [];
    });
    expect(embedded.join(' ')).toContain(`${TARGET}.appex`);
  });
});

describe('the settings that decide whether it builds', () => {
  it('declares the bridging header, without which the C entries are unresolved identifiers', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    expect(settings.SWIFT_OBJC_BRIDGING_HEADER).toBe(`"${TARGET}/${TARGET}-Bridging-Header.h"`);
  });

  it('links the Rust library directly, since the pod that vendors it depends on React', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    expect(settings.OTHER_LDFLAGS).toContain('-lveloqrs_ffi');
  });

  it('links the archive its own phase writes for the SDK being built', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    expect(settings.LIBRARY_SEARCH_PATHS).toEqual([
      '"$(inherited)"',
      '"$(TARGET_TEMP_DIR)/VeloqrsFFI"',
    ]);
    expect(settings.ENABLE_USER_SCRIPT_SANDBOXING).toBe('NO');
  });

  it('drops the per-SDK bundle paths a target from an earlier prebuild carries', () => {
    const settings: Record<string, string> = {
      '"LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"':
        '"$(SRCROOT)/../modules/veloqrs/ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64"',
      '"LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]"':
        '"$(SRCROOT)/../modules/veloqrs/ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64-simulator"',
    };

    applyPushExtensionBuildSettings(settings, options);

    expect(Object.keys(settings).filter((key) => key.includes('[sdk='))).toEqual([]);
  });

  it('carries its own REACT_NATIVE_PATH, which the ccache wrapper resolves through', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    expect(settings.REACT_NATIVE_PATH).toBe('"$(SRCROOT)/../node_modules/react-native"');
  });

  it('names its own Info.plist and entitlements rather than generating either', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    expect(settings.INFOPLIST_FILE).toBe(`"${TARGET}/Info.plist"`);
    expect(settings.CODE_SIGN_ENTITLEMENTS).toBe(`"${TARGET}/${TARGET}.entitlements"`);
    expect(settings.GENERATE_INFOPLIST_FILE).toBe('NO');
  });

  it('is written onto the target the plugin creates', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);

    const written = settingsFor(proj);
    expect(written.length).toBeGreaterThan(0);
    for (const settings of written) {
      expect(settings.SWIFT_OBJC_BRIDGING_HEADER).toBeDefined();
      expect(settings.LIBRARY_SEARCH_PATHS).toEqual([
        '"$(inherited)"',
        '"$(TARGET_TEMP_DIR)/VeloqrsFFI"',
      ]);
    }
  });
});

type Phase = { value: string };
type ShellPhase = {
  name: string;
  shellScript: string;
  outputPaths: string[];
  alwaysOutOfDate?: number;
};

/** The target's phases in order, as `isa:name`, and its shell phases by id. */
function phasesOf(proj: ReturnType<typeof openFixture>) {
  const uuid = targetUuidByName(proj, TARGET) as string;
  const target = proj.pbxNativeTargetSection()[uuid] as unknown as { buildPhases: Phase[] };
  const objects = proj.hash.project.objects as Record<string, Record<string, unknown>>;
  const scripts = (objects.PBXShellScriptBuildPhase ?? {}) as Record<string, ShellPhase>;
  const order = target.buildPhases.map((phase) => {
    const isa = Object.keys(objects).find((key) => objects[key][phase.value] !== undefined);
    const named = scripts[phase.value]?.name?.replace(/"/g, '');
    return named ? `${isa}:${named}` : String(isa);
  });
  return { target, scripts, order };
}

describe('the phase that builds the Rust library', () => {
  it('runs before the link, for the SDK and architectures of the build', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);

    const { target, scripts, order } = phasesOf(proj);
    expect(order[0]).toBe('PBXShellScriptBuildPhase:Build Rust library');
    expect(order.indexOf('PBXFrameworksBuildPhase')).toBeGreaterThan(0);
    const phase = scripts[target.buildPhases[0].value];
    expect(phase.shellScript).toContain('modules/veloqrs/scripts/xcode-build-rust.sh');
    expect(phase.shellScript).toContain('$TARGET_TEMP_DIR/VeloqrsFFI');
    expect(phase.outputPaths).toEqual(['"$(TARGET_TEMP_DIR)/VeloqrsFFI/libveloqrs_ffi.a"']);
    expect(phase.alwaysOutOfDate).toBe(1);
  });

  it('is added once, however many prebuilds run', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);
    configurePushExtensionProject(proj, options);

    const { order } = phasesOf(proj);
    expect(order.filter((name) => name.endsWith(':Build Rust library'))).toHaveLength(1);
  });

  it('reaches a target an earlier prebuild wrote without it, along with the settings', () => {
    const proj = openFixture();
    configurePushExtensionProject(proj, options);
    const { target } = phasesOf(proj);
    target.buildPhases.shift();
    // The pod install saves the project again, without the quotes around the
    // name, and glues the Swift path onto a single search path.
    for (const settings of settingsFor(proj)) {
      settings.PRODUCT_NAME = TARGET;
      settings.LIBRARY_SEARCH_PATHS = '"$(SDKROOT)/usr/lib/swift$(TARGET_TEMP_DIR)/VeloqrsFFI"';
      settings['"LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"'] = '"$(SRCROOT)/../old/ios-arm64"';
    }

    configurePushExtensionProject(proj, options);

    expect(phasesOf(proj).order[0]).toBe('PBXShellScriptBuildPhase:Build Rust library');
    for (const settings of settingsFor(proj)) {
      expect(settings.LIBRARY_SEARCH_PATHS).toEqual([
        '"$(inherited)"',
        '"$(TARGET_TEMP_DIR)/VeloqrsFFI"',
      ]);
      expect(settings['"LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"']).toBeUndefined();
    }
  });
});

describe('the tracked source tree', () => {
  it('holds the principal class the Info.plist names, and the plugin finds it', () => {
    expect(pushSwiftFiles(projectRoot)).toContain('NotificationService.swift');
  });

  /**
   * Scenario: a ride push lands while the app is closed. The extension stores
   * the ride and has to rewrite the widget snapshot in the App Group, or the
   * home screen keeps the previous ride until the app next opens.
   *
   * Expected behaviour: the extension compiles the one snapshot writer the
   * background refresh and the app bridge write through, not a copy of it, so
   * the file name, the location and the backup exclusion cannot drift apart.
   */
  it('compiles the snapshot writer the widget refresh writes through, as the same file', () => {
    expect(pushSwiftFiles(projectRoot)).toContain('WidgetSnapshotFile.swift');
    expect(fs.realpathSync(path.join(projectRoot, SOURCE_DIR, 'WidgetSnapshotFile.swift'))).toBe(
      fs.realpathSync(path.join(projectRoot, 'modules/veloq-widget/ios/WidgetSnapshotFile.swift'))
    );
  });
});

describe('the files the prebuild copies into the native tree', () => {
  it('copies a linked source as the file it points at, which the native tree can resolve', () => {
    const source = tempDir('veloq-push-src-');
    const dest = tempDir('veloq-push-dest-');
    fs.writeFileSync(path.join(source, 'Shared.swift'), 'enum Shared {}\n');
    fs.mkdirSync(path.join(source, 'Extension'));
    fs.symlinkSync('../Shared.swift', path.join(source, 'Extension', 'Shared.swift'));

    copyDir(path.join(source, 'Extension'), path.join(dest, 'Extension'));

    const copied = path.join(dest, 'Extension', 'Shared.swift');
    expect(fs.lstatSync(copied).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(copied, 'utf8')).toBe('enum Shared {}\n');
  });
});

/**
 * Scenario: a ride push reaches a phone set to German while the keychain is
 * still locked from a restart, or the engine will not open, or the fetch runs
 * past the thirty seconds. The extension has no sentence to post, and without
 * text of its own it delivers the server's English line.
 *
 * Expected behaviour: the prebuild compiles a string catalogue into the
 * extension carrying the recorded title in every language the app is
 * translated into, so the extension can rewrite the line from its own bundle.
 */
describe('the fallback the extension posts when the engine cannot answer', () => {
  const FALLBACK_TITLE = 'Activity Recorded';

  type Catalogue = {
    strings: Record<string, { localizations: Record<string, { stringUnit: { value: string } }> }>;
  };

  it('carries the recorded title in every language the app is translated into', () => {
    const iosRoot = tempDir('veloq-push-ios-');

    writePushExtensionFiles(projectRoot, iosRoot);

    const catalogue: Catalogue = JSON.parse(
      fs.readFileSync(path.join(iosRoot, TARGET, 'Localizable.xcstrings'), 'utf8')
    );
    const wrong: string[] = [];
    const locales = Object.entries(strings.PLATFORM_LOCALES) as [string, { apple: string[] }][];
    for (const [locale, { apple }] of locales) {
      const expected = (
        resolvedLocale(locale) as { notifications: { activityRecorded: { title: string } } }
      ).notifications.activityRecorded.title;
      for (const language of apple) {
        const unit = catalogue.strings[FALLBACK_TITLE]?.localizations[language]?.stringUnit;
        if (!expected || unit?.value !== expected) wrong.push(`${language}: ${unit?.value}`);
      }
    }
    expect(locales.length).toBeGreaterThan(1);
    expect(wrong).toEqual([]);
  });

  it('still copies the tracked sources beside the catalogue', () => {
    const iosRoot = tempDir('veloq-push-ios-');

    writePushExtensionFiles(projectRoot, iosRoot);

    expect(fs.existsSync(path.join(iosRoot, TARGET, 'NotificationService.swift'))).toBe(true);
  });

  /** The resources the extension target copies, with the file type each reference carries. */
  function resources(proj: ReturnType<typeof openFixture>) {
    const uuid = targetUuidByName(proj, TARGET) as string;
    const refs = proj.pbxFileReferenceSection();
    const builds = proj.pbxBuildFileSection();
    return (proj.pbxResourcesBuildPhaseObj(uuid)?.files ?? []).map((entry: { value: string }) => {
      const ref = refs[(builds[entry.value] as { fileRef: string }).fileRef] as {
        path: string;
        lastKnownFileType: string;
      };
      return `${path.basename(String(ref.path).replace(/"/g, ''))} ${ref.lastKnownFileType}`;
    });
  }

  it('is compiled into the extension once, however many prebuilds run', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);
    configurePushExtensionProject(proj, options);

    expect(resources(proj)).toEqual(['Localizable.xcstrings text.json.xcstrings']);
  });

  it('lists every catalogue language as a region the project knows', () => {
    const proj = openFixture();

    configurePushExtensionProject(proj, options);

    const unknown = strings
      .appleLanguages()
      .filter((language: string) => !proj.hasKnownRegion(language));
    expect(unknown).toEqual([]);
  });
});
