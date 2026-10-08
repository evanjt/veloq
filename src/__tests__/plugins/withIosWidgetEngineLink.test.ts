/**
 * Scenario: the widget extension links the Rust engine the way the push
 * extension does, so an intent running in the widget's process can open the
 * database in the App Group container and compose a snapshot. Nothing in
 * `ios/` is tracked, so the link has to be written by the prebuild, and the
 * widget target survives from the first prebuild onwards.
 *
 * Expected behaviour: a freshly created target and one written by an earlier
 * prebuild both end with the phase that builds the library ahead of the link,
 * the bridging header that declares the C entries, the link flags and the
 * search path. The memory probe's sources are compiled only while its flag is
 * on.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import {
  BRIDGING_HEADER,
  PROBE_SWIFT_FILES,
  configureWidgetProject,
  targetUuidByName,
  widgetSwiftFiles,
  writeWidgetBundles,
  writeWidgetFiles,
} from '@/../src/plugins/with-ios-widget';

const projectRoot = path.join(__dirname, '../../..');
const TARGET = 'VeloqWidget';
const PHASE = 'PBXShellScriptBuildPhase:Build Rust library';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-link-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', 'project.pbxproj'), file);
  return xcode.project(file).parseSync();
}

const options = {
  projectName: 'VeloqDev',
  swiftFiles: ['VeloqWidget.swift'],
  bundleId: 'com.veloq.app.dev',
  version: '0.4.0',
  buildNumber: '7',
};

type Proj = ReturnType<typeof openFixture>;

function widgetSettings(proj: Proj) {
  return Object.values(proj.pbxXCBuildConfigurationSection())
    .map((entry) => (typeof entry === 'string' ? undefined : entry.buildSettings))
    .filter((settings) => settings?.PRODUCT_NAME?.replace(/"/g, '') === TARGET)
    .map((settings) => settings as Record<string, unknown>);
}

/** The target's phases in order, as `isa:name`. */
function phaseOrder(proj: Proj) {
  const uuid = targetUuidByName(proj, TARGET) as string;
  const target = proj.pbxNativeTargetSection()[uuid] as unknown as {
    buildPhases: { value: string }[];
  };
  const objects = proj.hash.project.objects as Record<string, Record<string, unknown>>;
  const scripts = (objects.PBXShellScriptBuildPhase ?? {}) as Record<string, { name: string }>;
  return {
    target,
    order: target.buildPhases.map((phase) => {
      const isa = Object.keys(objects).find((key) => objects[key][phase.value] !== undefined);
      const named = scripts[phase.value]?.name?.replace(/"/g, '');
      return named ? `${isa}:${named}` : String(isa);
    }),
  };
}

describe('the engine link on the widget target', () => {
  it('builds the library ahead of the link and declares the entries it calls', () => {
    const proj = openFixture();

    configureWidgetProject(proj, options);

    expect(phaseOrder(proj).order[0]).toBe(PHASE);
    const written = widgetSettings(proj);
    expect(written.length).toBeGreaterThan(0);
    for (const settings of written) {
      expect(settings.SWIFT_OBJC_BRIDGING_HEADER).toBe(`"${TARGET}/${BRIDGING_HEADER}"`);
      expect(settings.OTHER_LDFLAGS).toContain('-lveloqrs_ffi');
      expect(settings.LIBRARY_SEARCH_PATHS).toEqual([
        '"$(inherited)"',
        '"$(TARGET_TEMP_DIR)/VeloqrsFFI"',
      ]);
      expect(settings.ENABLE_USER_SCRIPT_SANDBOXING).toBe('NO');
    }
  });

  it('is added once, however many prebuilds run', () => {
    const proj = openFixture();

    configureWidgetProject(proj, options);
    configureWidgetProject(proj, options);

    expect(phaseOrder(proj).order.filter((name) => name === PHASE)).toHaveLength(1);
  });

  it('reaches a target an earlier prebuild wrote without it', () => {
    const proj = openFixture();
    configureWidgetProject(proj, options);
    phaseOrder(proj).target.buildPhases.shift();
    for (const settings of widgetSettings(proj)) {
      // The pod install saves the project again without the quotes around the
      // name, and glues the Swift path onto a single search path.
      settings.PRODUCT_NAME = TARGET;
      settings.LIBRARY_SEARCH_PATHS = '"$(SDKROOT)/usr/lib/swift$(TARGET_TEMP_DIR)/VeloqrsFFI"';
      delete settings.SWIFT_OBJC_BRIDGING_HEADER;
    }

    configureWidgetProject(proj, options);

    expect(phaseOrder(proj).order[0]).toBe(PHASE);
    for (const settings of widgetSettings(proj)) {
      expect(settings.SWIFT_OBJC_BRIDGING_HEADER).toBe(`"${TARGET}/${BRIDGING_HEADER}"`);
      expect(settings.LIBRARY_SEARCH_PATHS).toEqual([
        '"$(inherited)"',
        '"$(TARGET_TEMP_DIR)/VeloqrsFFI"',
      ]);
    }
  });

  it('leaves the app target without the phase, which links the library through the pod', () => {
    const proj = openFixture();

    configureWidgetProject(proj, options);

    const app = proj.pbxNativeTargetSection()[
      targetUuidByName(proj, 'VeloqDev') as string
    ] as unknown as { buildPhases: { comment?: string }[] };
    expect(app.buildPhases.map((phase) => phase.comment)).not.toContain('Build Rust library');
  });
});

describe('the bridging header the widget compiles against', () => {
  it('is the push extension header, so the C entries are declared in one place', () => {
    const platformRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-ios-'));
    tempDirs.push(platformRoot);

    writeWidgetFiles(projectRoot, platformRoot, 'VeloqDev', false);

    const written = fs.readFileSync(path.join(platformRoot, TARGET, BRIDGING_HEADER), 'utf8');
    const source = fs.readFileSync(
      path.join(projectRoot, 'push/ios/VeloqPushExtension/VeloqPushExtension-Bridging-Header.h'),
      'utf8'
    );
    expect(written).toBe(source);
    expect(written).toContain('veloq_push_widget_snapshot(');
  });
});

describe('the memory probe', () => {
  it('is not compiled into the extension while its flag is off', () => {
    const files = widgetSwiftFiles(projectRoot, false);

    for (const name of PROBE_SWIFT_FILES) expect(files).not.toContain(name);
  });

  it('is compiled, with the engine wrappers it calls, while its flag is on', () => {
    const files = widgetSwiftFiles(projectRoot, true);

    expect(PROBE_SWIFT_FILES).toContain('MemoryProbe.swift');
    for (const name of PROBE_SWIFT_FILES) expect(files).toContain(name);
  });

  it('writes its sources beside the widget sources when the flag is on, and not otherwise', () => {
    const off = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-off-'));
    const on = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-on-'));
    tempDirs.push(off, on);

    writeWidgetFiles(projectRoot, off, 'VeloqDev', false);
    writeWidgetFiles(projectRoot, on, 'VeloqDev', true);

    for (const name of PROBE_SWIFT_FILES) {
      expect(fs.existsSync(path.join(off, TARGET, name))).toBe(false);
      expect(fs.existsSync(path.join(on, TARGET, name))).toBe(true);
    }
  });
});

describe('the probe widget in the bundles', () => {
  function bundles(includeProbe: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-bundles-'));
    tempDirs.push(dir);
    writeWidgetBundles(dir, true, includeProbe);
    return fs.readFileSync(path.join(dir, 'WidgetBundles.swift'), 'utf8');
  }

  it('is named once, in the iOS 17 bundle, while the flag is on', () => {
    const swift = bundles(true);

    expect(swift.match(/VeloqMemoryProbeWidget\(\)/g)).toHaveLength(1);
    expect(swift.indexOf('VeloqMemoryProbeWidget()')).toBeGreaterThan(
      swift.indexOf('struct VeloqWidgetsConfigurable')
    );
  });

  it('is absent from both bundles while the flag is off', () => {
    expect(bundles(false)).not.toContain('VeloqMemoryProbeWidget');
  });
});
