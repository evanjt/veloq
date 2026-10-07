/**
 * Scenario: the extension target is created on a project that carries no
 * `PBXTargetDependency` section, which is what `expo prebuild` generates.
 *
 * Expected behaviour: the app target explicitly depends on the extension.
 * `pbxProject.addTargetDependency` guards its whole write on both that section
 * and `PBXContainerItemProxy` already existing and creates neither, so it
 * returned a value and wrote nothing. What built the extension was the
 * scheme's "Find Implicit Dependencies"; without it the embed phase copies a
 * `.appex` nobody built, and the failure names a missing file rather than a
 * target.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import { configurePushExtensionProject } from '@/../src/plugins/with-ios-push-extension';
import { configureWidgetProject } from '@/../src/plugins/with-ios-widget';

const APP_TARGET = 'VeloqDev';
const WIDGET_TARGET = 'VeloqWidget';
const PUSH_TARGET = 'VeloqPushExtension';

const fixtureDirs: string[] = [];
afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openFixture(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-pbx-'));
  fixtureDirs.push(dir);
  const file = path.join(dir, 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', name), file);
  return xcode.project(file).parseSync();
}

type Project = ReturnType<typeof openFixture>;

function targetUuid(proj: Project, name: string): string {
  const section = proj.pbxNativeTargetSection() as unknown as Record<string, { name?: string }>;
  for (const key of Object.keys(section)) {
    if (key.endsWith('_comment')) continue;
    if (section[key].name === name || section[key].name === `"${name}"`) return key;
  }
  throw new Error(`no target named ${name}`);
}

/** The names the app target declares an explicit dependency on. */
function dependencyTargetNames(proj: Project): string[] {
  // `xcode`'s types name three sections and the project carries every one, so
  // the dependency section and a target's `dependencies` are reached untyped.
  const objects = proj.hash.project.objects as unknown as Record<
    string,
    Record<string, { target: string }>
  >;
  const targets = proj.pbxNativeTargetSection() as unknown as Record<
    string,
    { name?: string; dependencies?: { value: string }[] }
  >;
  const dependencies = targets[targetUuid(proj, APP_TARGET)].dependencies ?? [];
  return dependencies.map((entry) =>
    String(targets[objects.PBXTargetDependency[entry.value].target].name).replace(/"/g, '')
  );
}

function configureWidget(proj: Project) {
  const nativeRoot = path.dirname(proj.filepath);
  for (const [dir, files] of [
    [APP_TARGET, ['RecordDeepLink.swift', 'VeloqAppShortcuts.swift']],
    [WIDGET_TARGET, ['VeloqWidget.swift']],
  ] as const) {
    fs.mkdirSync(path.join(nativeRoot, dir), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(nativeRoot, dir, file), '// source');
  }
  configureWidgetProject(proj, {
    projectName: APP_TARGET,
    swiftFiles: ['VeloqWidget.swift'],
    bundleId: 'com.veloq.app',
    version: '0.4.0',
    buildNumber: '29',
  });
}

function configurePushExtension(proj: Project) {
  configurePushExtensionProject(proj, {
    swiftFiles: ['NotificationService.swift'],
    bundleId: 'com.veloq.app',
    version: '0.4.0',
    buildNumber: '29',
  });
}

// Every plugin that adds an app extension, because each writes its own target
// and the guard in `addTargetDependency` is silent about the one that forgets.
const PLUGINS: [string, (proj: Project) => void][] = [
  [WIDGET_TARGET, configureWidget],
  [PUSH_TARGET, configurePushExtension],
];

const FIXTURES: [string, string][] = [
  ['a project generated without them', 'app-only-no-dependency-sections.pbxproj'],
  ['a project that already has them', 'app-only.pbxproj'],
];

describe.each(FIXTURES)('%s', (_label, fixture) => {
  describe.each(PLUGINS)('%s', (target, configure) => {
    it('leaves the app target depending on the extension', () => {
      const proj = openFixture(fixture);

      configure(proj);

      expect(dependencyTargetNames(proj)).toEqual([target]);
    });

    it('writes a dependency that survives a round trip through the file', () => {
      const first = openFixture(fixture);
      configure(first);
      fs.writeFileSync(first.filepath, first.writeSync());

      const reopened = xcode.project(first.filepath).parseSync();

      expect(dependencyTargetNames(reopened)).toEqual([target]);
    });

    it('adds one dependency across repeated prebuilds, not one per pass', () => {
      const proj = openFixture(fixture);

      configure(proj);
      configure(proj);

      expect(dependencyTargetNames(proj)).toEqual([target]);
    });
  });
});
