/**
 * Scenario: the watch app is a third Xcode target the prebuild writes, a
 * single-target SwiftUI app for watchOS embedded in the iPhone app. Nothing in
 * `ios/` is tracked, so the plugin copies the tracked tree there and rebuilds
 * the target on every prebuild, and the target itself survives from the first.
 *
 * Expected behaviour: one `VeloqWatch` application target built against the
 * watchOS SDK, with the bundle id the companion check expects, that the app
 * target depends on and embeds under `Watch/`, however many prebuilds run. The
 * Info.plist it is built from names the app as its companion and says the watch
 * app does not run without it, and the tracked tree holds the icon an archive
 * refuses a watch app without.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import {
  EMBED_PHASE,
  SOURCE_DIR,
  TARGET,
  configureWatchProject,
  watchSwiftFiles,
  writeWatchFiles,
} from '@/../src/plugins/with-ios-watch';
import { compiledSourceNames, targetUuidByName } from '@/../src/plugins/with-ios-widget';

const plist = require('@expo/plist').default;

const projectRoot = path.join(__dirname, '../../..');
const APP_TARGET = 'VeloqDev';

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
  const dir = tempDir('veloq-watch-pbx-');
  const file = path.join(dir, 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', 'project.pbxproj'), file);
  return xcode.project(file).parseSync();
}

type Project = ReturnType<typeof openFixture>;

const options = {
  swiftFiles: ['VeloqWatchApp.swift', 'WatchStatusView.swift'],
  bundleId: 'com.veloq.app.dev',
  version: '0.4.0',
  buildNumber: '7',
};

const unquote = (value: unknown) => String(value ?? '').replace(/^"|"$/g, '');

/** The build settings of every configuration the watch target owns. */
function watchSettings(proj: Project) {
  return Object.values(proj.pbxXCBuildConfigurationSection())
    .map((entry) => (typeof entry === 'string' ? undefined : entry.buildSettings))
    .filter((settings) => unquote(settings?.PRODUCT_NAME) === TARGET)
    .map((settings) => settings as Record<string, string>);
}

function namedTargets(proj: Project, name: string) {
  const section = proj.pbxNativeTargetSection();
  return Object.keys(section).filter(
    (key) => key.endsWith('_comment') && unquote(section[key]) === name
  );
}

type Listed = { value: string; comment: string };
type CopyPhase = { dstPath: string; dstSubfolderSpec: number; files: Listed[] };
type NativeTarget = { productType: string; buildPhases: Listed[]; dependencies: Listed[] };
type Objects = {
  PBXCopyFilesBuildPhase: Record<string, CopyPhase>;
  PBXTargetDependency: Record<string, { target: string }>;
  PBXNativeTarget: Record<string, NativeTarget>;
};

/** The sections of the project the pbxproj writer keeps, typed for what these tests read. */
function objects(proj: Project) {
  return proj.hash.project.objects as unknown as Objects;
}

/** The copy phases of the app target that carry the given name. */
function appPhases(proj: Project, name: string) {
  const appUuid = targetUuidByName(proj, APP_TARGET) as string;
  const app = objects(proj).PBXNativeTarget[appUuid];
  return app.buildPhases
    .filter((phase) => unquote(phase.comment) === name)
    .map((phase) => objects(proj).PBXCopyFilesBuildPhase[phase.value]);
}

/** The dependencies the app target holds on the watch target. */
function dependenciesOnWatch(proj: Project) {
  const uuid = targetUuidByName(proj, TARGET) as string;
  const appUuid = targetUuidByName(proj, APP_TARGET) as string;
  const { PBXTargetDependency, PBXNativeTarget } = objects(proj);
  return PBXNativeTarget[appUuid].dependencies.filter(
    (dependency) => PBXTargetDependency[dependency.value]?.target === uuid
  );
}

describe('the watch target the prebuild writes', () => {
  it('is an application target built against the watchOS SDK', () => {
    const proj = openFixture();

    configureWatchProject(proj, options);

    const uuid = targetUuidByName(proj, TARGET);
    expect(uuid).not.toBeNull();
    const target = objects(proj).PBXNativeTarget[uuid as string];
    expect(unquote(target.productType)).toBe('com.apple.product-type.application');
    const settings = watchSettings(proj);
    expect(settings).toHaveLength(2);
    for (const each of settings) {
      expect(unquote(each.SDKROOT)).toBe('watchos');
      expect(unquote(each.SUPPORTED_PLATFORMS)).toBe('watchsimulator watchos');
      expect(unquote(each.PRODUCT_BUNDLE_IDENTIFIER)).toBe('com.veloq.app.dev.watchkitapp');
      expect(unquote(each.WATCHOS_DEPLOYMENT_TARGET)).toBe('10.0');
      expect(unquote(each.TARGETED_DEVICE_FAMILY)).toBe('4');
      expect(each.GENERATE_INFOPLIST_FILE).toBe('NO');
      expect(each.CODE_SIGN_STYLE).toBe('Automatic');
      expect(unquote(each.MARKETING_VERSION)).toBe('0.4.0');
      expect(unquote(each.CURRENT_PROJECT_VERSION)).toBe('7');
      expect(unquote(each.REACT_NATIVE_PATH)).toBe('$(SRCROOT)/../node_modules/react-native');
      expect(unquote(each.ASSETCATALOG_COMPILER_APPICON_NAME)).toBe('AppIcon');
      expect(unquote(each.ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME)).toBe('AccentColor');
      expect(each).not.toHaveProperty('IPHONEOS_DEPLOYMENT_TARGET');
    }
  });

  it('is depended on and embedded by the app target, under Watch/', () => {
    const proj = openFixture();

    configureWatchProject(proj, options);

    expect(dependenciesOnWatch(proj)).toHaveLength(1);

    const phases = appPhases(proj, EMBED_PHASE);
    expect(phases).toHaveLength(1);
    expect(unquote(phases[0].dstPath)).toBe('$(CONTENTS_FOLDER_PATH)/Watch');
    expect(phases[0].dstSubfolderSpec).toBe(16);
    expect(phases[0].files.map((file) => file.comment)).toEqual([
      `${TARGET}.app in ${EMBED_PHASE}`,
    ]);
    const build = proj.pbxBuildFileSection()[phases[0].files[0].value] as { settings: unknown };
    expect(build.settings).toEqual({ ATTRIBUTES: ['RemoveHeadersOnCopy'] });
  });

  it('is created once, with one embed phase, however many prebuilds run', () => {
    const proj = openFixture();

    configureWatchProject(proj, options);
    configureWatchProject(proj, options);

    expect(namedTargets(proj, TARGET)).toHaveLength(1);
    expect(appPhases(proj, EMBED_PHASE)).toHaveLength(1);
    expect(dependenciesOnWatch(proj)).toHaveLength(1);
  });

  it('puts the embed phase back on an app target an earlier prebuild left without one', () => {
    const proj = openFixture();
    configureWatchProject(proj, options);
    const appUuid = targetUuidByName(proj, APP_TARGET) as string;
    const app = objects(proj).PBXNativeTarget[appUuid];
    app.buildPhases = app.buildPhases.filter((phase) => unquote(phase.comment) !== EMBED_PHASE);

    configureWatchProject(proj, options);

    expect(appPhases(proj, EMBED_PHASE)).toHaveLength(1);
    expect(namedTargets(proj, TARGET)).toHaveLength(1);
  });

  it('compiles every Swift file, and one a later prebuild finds', () => {
    const proj = openFixture();

    configureWatchProject(proj, options);
    configureWatchProject(proj, {
      ...options,
      swiftFiles: [...options.swiftFiles, 'WatchSession.swift'],
    });

    const uuid = targetUuidByName(proj, TARGET) as string;
    expect([...compiledSourceNames(proj, uuid)].sort()).toEqual(
      ['VeloqWatchApp.swift', 'WatchSession.swift', 'WatchStatusView.swift'].sort()
    );
  });

  it('copies the asset catalogue once, with the type Xcode compiles', () => {
    const proj = openFixture();

    configureWatchProject(proj, options);
    configureWatchProject(proj, options);

    const uuid = targetUuidByName(proj, TARGET) as string;
    const refs = proj.pbxFileReferenceSection();
    const builds = proj.pbxBuildFileSection();
    const copied = (proj.pbxResourcesBuildPhaseObj(uuid)?.files ?? []).map(
      (entry: { value: string }) => refs[(builds[entry.value] as { fileRef: string }).fileRef]
    );
    expect(copied).toHaveLength(1);
    expect(path.basename(unquote(copied[0].path))).toBe('Assets.xcassets');
    expect(copied[0].lastKnownFileType).toBe('folder.assetcatalog');
  });

  it('keeps the settings of a target an earlier prebuild created, current', () => {
    const proj = openFixture();
    configureWatchProject(proj, options);

    configureWatchProject(proj, { ...options, version: '0.5.0', buildNumber: '8' });

    for (const each of watchSettings(proj)) {
      expect(unquote(each.MARKETING_VERSION)).toBe('0.5.0');
      expect(unquote(each.CURRENT_PROJECT_VERSION)).toBe('8');
    }
  });
});

describe('the tracked watch tree', () => {
  it('lists the Swift files the target compiles, none of them a test or a stub', () => {
    const files = watchSwiftFiles(projectRoot);

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('VeloqWatchApp.swift');
    expect(files.every((name) => name.endsWith('.swift'))).toBe(true);
  });

  it('is copied into ios/ with the app named as the companion', () => {
    const iosRoot = tempDir('veloq-watch-ios-');

    writeWatchFiles(projectRoot, iosRoot, 'com.veloq.app.dev');

    const info = plist.parse(fs.readFileSync(path.join(iosRoot, TARGET, 'Info.plist'), 'utf8'));
    expect(info.WKApplication).toBe(true);
    expect(info.WKCompanionAppBundleIdentifier).toBe('com.veloq.app.dev');
    expect(info.WKRunsIndependentlyOfCompanionApp).toBe(false);
    expect(info.NSLocationWhenInUseUsageDescription).toEqual(expect.any(String));
    expect(fs.existsSync(path.join(iosRoot, TARGET, 'VeloqWatchApp.swift'))).toBe(true);
  });

  it('writes the same companion id again, when the app id changes between prebuilds', () => {
    const iosRoot = tempDir('veloq-watch-ios-');

    writeWatchFiles(projectRoot, iosRoot, 'com.veloq.app.dev');
    writeWatchFiles(projectRoot, iosRoot, 'com.veloq.app');

    const info = plist.parse(fs.readFileSync(path.join(iosRoot, TARGET, 'Info.plist'), 'utf8'));
    expect(info.WKCompanionAppBundleIdentifier).toBe('com.veloq.app');
  });

  it('carries the watch app icon an archive refuses a watch app without', () => {
    const catalogue = path.join(projectRoot, SOURCE_DIR, 'Assets.xcassets');
    const icon = JSON.parse(
      fs.readFileSync(path.join(catalogue, 'AppIcon.appiconset', 'Contents.json'), 'utf8')
    );

    const files = icon.images.map((image: { filename?: string }) => image.filename);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(fs.existsSync(path.join(catalogue, 'AppIcon.appiconset', file))).toBe(true);
    }
    expect(icon.images.every((image: { platform?: string }) => image.platform === 'watchos')).toBe(
      true
    );
    expect(fs.existsSync(path.join(catalogue, 'AccentColor.colorset', 'Contents.json'))).toBe(true);
  });

  it('ships each watch app icon at the size its catalogue entry declares', () => {
    const iconSet = path.join(projectRoot, SOURCE_DIR, 'Assets.xcassets', 'AppIcon.appiconset');
    const icon = JSON.parse(fs.readFileSync(path.join(iconSet, 'Contents.json'), 'utf8'));

    for (const image of icon.images) {
      const [width, height] = image.size.split('x').map(Number);
      const png = fs.readFileSync(path.join(iconSet, image.filename));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height]);
    }
  });

  it('holds no entitlement, the watch opens neither the App Group nor the keychain', () => {
    const names = fs.readdirSync(path.join(projectRoot, SOURCE_DIR));

    expect(names.filter((name) => name.endsWith('.entitlements'))).toEqual([]);
  });

  it('declares the location background mode under both keys watchOS reads, and no workout session', () => {
    const info = plist.parse(
      fs.readFileSync(path.join(projectRoot, SOURCE_DIR, 'Info.plist'), 'utf8')
    );
    expect(info.WKBackgroundModes).toEqual(['location']);
    expect(info.UIBackgroundModes).toEqual(['location']);

    const sources = watchSwiftFiles(projectRoot)
      .map((name) => fs.readFileSync(path.join(projectRoot, SOURCE_DIR, name), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(/HKWorkoutSession|import HealthKit/);
  });

  it('keeps the App Review note for the background location beside the target', () => {
    const note = fs.readFileSync(
      path.join(projectRoot, 'watch', 'ios', 'APP_REVIEW_NOTE.txt'),
      'utf8'
    );
    expect(note).toMatch(/2\.5\.4/);
  });
});
