/**
 * Scenario: the iOS notification service extension is a second Xcode target
 * that the prebuild writes, the way the widget one is. Nothing in `ios/` is
 * tracked, so everything the target needs has to be put there by the plugin on
 * every prebuild, and the target itself survives from the first one.
 *
 * Expected behaviour: the target is created once and never twice, every Swift
 * file in the tracked tree ends up in its Sources phase, and the settings that
 * decide whether it builds at all are on it: the bridging header that declares
 * the crate's C entries, the link flags for the Rust static library, and a
 * library search path per SDK.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import {
  TARGET,
  applyPushExtensionBuildSettings,
  configurePushExtensionProject,
  pushSwiftFiles,
  xcframeworkSlices,
} from '@/../src/plugins/with-ios-push-extension';
import { compiledSourceNames, targetUuidByName } from '@/../src/plugins/with-ios-widget';

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
  slices: { 'iphonesimulator*': 'ios-arm64_x86_64-simulator', 'iphoneos*': 'ios-arm64' },
};

/** Every build configuration the plugin wrote settings onto. */
function settingsFor(proj: ReturnType<typeof openFixture>) {
  return Object.values(proj.pbxXCBuildConfigurationSection())
    .map((entry) => (typeof entry === 'string' ? undefined : entry.buildSettings))
    .filter((settings) => settings?.PRODUCT_NAME === `"${TARGET}"`)
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

  it('gives each SDK its own slice, so the linker never meets the other architecture', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    expect(settings['"LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]"']).toContain(
      'VeloqrsFFI.xcframework/ios-arm64_x86_64-simulator'
    );
    expect(settings['"LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"']).toContain(
      'VeloqrsFFI.xcframework/ios-arm64'
    );
  });

  it('quotes the conditional key, which is the form Xcode will parse back', () => {
    const settings: Record<string, string> = {};

    applyPushExtensionBuildSettings(settings, options);

    // The writer emits a setting name verbatim. Unquoted, the brackets and the
    // `=` are not a token, and Xcode refuses the project file rather than the
    // setting. A parse of a stock project hands `CODE_SIGN_IDENTITY` back with
    // the quotes for the same reason.
    const conditional = Object.keys(settings).filter((key) => key.includes('[sdk='));
    expect(conditional).toHaveLength(2);
    for (const key of conditional) expect(key.startsWith('"') && key.endsWith('"')).toBe(true);
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
      expect(settings['"LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"']).toBeDefined();
    }
  });
});

describe('where the library lives inside the xcframework', () => {
  it('is read from the bundle, because the identifiers are the builder s', () => {
    const root = tempDir('veloq-xcf-');
    const bundle = path.join(root, 'modules/veloqrs/ios/Frameworks/VeloqrsFFI.xcframework');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(
      path.join(bundle, 'Info.plist'),
      `<plist version="1.0"><dict><key>AvailableLibraries</key><array>
         <dict><key>LibraryIdentifier</key><string>ios-arm64_x86_64-maccatalyst</string>
         <key>SupportedPlatformVariant</key><string>simulator</string></dict>
         <dict><key>LibraryIdentifier</key><string>ios-arm64e</string></dict>
       </array></dict></plist>`
    );

    expect(xcframeworkSlices(root)).toEqual({
      'iphonesimulator*': 'ios-arm64_x86_64-maccatalyst',
      'iphoneos*': 'ios-arm64e',
    });
  });

  it('still names a device path when only the simulator slice has been built here', () => {
    const root = tempDir('veloq-xcf-sim-');
    const bundle = path.join(root, 'modules/veloqrs/ios/Frameworks/VeloqrsFFI.xcframework');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(
      path.join(bundle, 'Info.plist'),
      `<plist version="1.0"><dict><key>AvailableLibraries</key><array>
         <dict><key>LibraryIdentifier</key><string>ios-arm64_x86_64-simulator</string>
         <key>SupportedPlatformVariant</key><string>simulator</string></dict>
       </array></dict></plist>`
    );

    expect(xcframeworkSlices(root)['iphoneos*']).toBe('ios-arm64');
  });

  it('falls back to the conventional names when no bundle has been built yet', () => {
    expect(xcframeworkSlices(tempDir('veloq-xcf-none-'))).toEqual({
      'iphonesimulator*': 'ios-arm64_x86_64-simulator',
      'iphoneos*': 'ios-arm64',
    });
  });
});

describe('the tracked source tree', () => {
  it('holds the principal class the Info.plist names, and the plugin finds it', () => {
    expect(pushSwiftFiles(projectRoot)).toContain('NotificationService.swift');
  });
});
