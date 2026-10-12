/**
 * Scenario: the widget extension does not open the engine. Its refresh control
 * opens the app, because the engine does not fit in the memory the platform
 * gives a widget extension. Nothing in `ios/` is tracked and the widget target
 * survives from the first prebuild onwards, so a target an earlier prebuild
 * linked to the engine keeps that link unless the prebuild takes it out.
 *
 * Expected behaviour: a freshly created target and one an earlier prebuild
 * linked both end with no phase building the library, no bridging header, no
 * link flag and no search path to the archive, and the push extension, which
 * does open the engine, is left as it was.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import { configureWidgetProject, targetUuidByName } from '@/../src/plugins/with-ios-widget';
import { applyEngineLinkSettings, ensureRustPhase } from '@/../src/plugins/xcodeEngineLink';

const TARGET = 'VeloqWidget';
const PHASE = 'PBXShellScriptBuildPhase:Build Rust library';
const LINKED_HEADER = `${TARGET}/${TARGET}-Bridging-Header.h`;

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

/** What an earlier prebuild left on the widget target, as the pod install saved it. */
function linkAsAnEarlierPrebuildDid(proj: Proj) {
  ensureRustPhase(proj, targetUuidByName(proj, TARGET) as string);
  for (const settings of widgetSettings(proj)) {
    applyEngineLinkSettings(settings, LINKED_HEADER);
    settings.PRODUCT_NAME = TARGET;
    settings.LIBRARY_SEARCH_PATHS = [
      '"$(inherited)"',
      '"$(SDKROOT)/usr/lib/swift"',
      '"$(TARGET_TEMP_DIR)/VeloqrsFFI"',
    ];
    settings.OTHER_LDFLAGS = '"$(inherited) -lveloqrs_ffi -ObjC"';
  }
}

function expectNoEngine(proj: Proj) {
  expect(phaseOrder(proj).order).not.toContain(PHASE);
  const written = widgetSettings(proj);
  expect(written.length).toBeGreaterThan(0);
  for (const settings of written) {
    expect(settings.SWIFT_OBJC_BRIDGING_HEADER).toBeUndefined();
    expect(String(settings.OTHER_LDFLAGS ?? '')).not.toContain('veloqrs_ffi');
    expect(JSON.stringify(settings.LIBRARY_SEARCH_PATHS ?? [])).not.toContain('VeloqrsFFI');
  }
}

describe('the widget target', () => {
  it('is created with no engine link', () => {
    const proj = openFixture();

    configureWidgetProject(proj, options);

    expectNoEngine(proj);
  });

  it('loses the link an earlier prebuild gave it, and keeps everything else', () => {
    const proj = openFixture();
    configureWidgetProject(proj, options);
    linkAsAnEarlierPrebuildDid(proj);
    const phasesBefore = phaseOrder(proj).order.filter((name) => name !== PHASE);

    configureWidgetProject(proj, options);

    expectNoEngine(proj);
    expect(phaseOrder(proj).order).toEqual(phasesBefore);
    for (const settings of widgetSettings(proj)) {
      expect(settings.OTHER_LDFLAGS).toBe('"$(inherited) -ObjC"');
      expect(settings.LIBRARY_SEARCH_PATHS).toEqual([
        '"$(inherited)"',
        '"$(SDKROOT)/usr/lib/swift"',
      ]);
    }
  });

  it('stays unlinked however many prebuilds run', () => {
    const proj = openFixture();
    configureWidgetProject(proj, options);
    linkAsAnEarlierPrebuildDid(proj);

    configureWidgetProject(proj, options);
    configureWidgetProject(proj, options);

    expectNoEngine(proj);
  });
});
