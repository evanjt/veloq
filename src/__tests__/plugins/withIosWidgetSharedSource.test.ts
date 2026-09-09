/**
 * Scenario: `RecordDeepLink.swift` is compiled by two targets, the app for its
 * App Shortcut and the widget extension for its Control. The plugin adds it to
 * the app first, then to the extension.
 *
 * Expected behaviour: both targets end up compiling it. `xcode`'s `addFile`
 * refuses a path the project already references, project-wide rather than per
 * target, so the second add is dropped and the extension fails to build with
 * "cannot find type 'RecordDeepLink' in scope". One file reference, one build
 * file per target, is what Xcode itself does for a shared source.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import {
  addMissingSourceFiles,
  compiledSourceNames,
  configureWidgetProject,
} from '@/../src/plugins/with-ios-widget';

const APP_TARGET = 'VeloqDev';
const WIDGET_TARGET = 'VeloqWidget';
const SHARED = 'RecordDeepLink.swift';

const fixtureDirs: string[] = [];
afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openFixture(name = 'project.pbxproj') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-pbx-'));
  fixtureDirs.push(dir);
  const file = path.join(dir, 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', name), file);
  const proj = xcode.project(file).parseSync();
  return proj;
}

function targetUuid(proj: ReturnType<typeof openFixture>, name: string): string {
  const section = proj.pbxNativeTargetSection();
  for (const key of Object.keys(section)) {
    if (key.endsWith('_comment')) continue;
    if (String(section[key].name).replace(/"/g, '') === name) return key;
  }
  throw new Error(`no target named ${name}`);
}

describe('a source file shared by two targets', () => {
  it('is compiled by the extension as well as the app', () => {
    const proj = openFixture();
    const app = targetUuid(proj, APP_TARGET);
    const widget = targetUuid(proj, WIDGET_TARGET);

    addMissingSourceFiles(proj, app, [SHARED], APP_TARGET);
    addMissingSourceFiles(proj, widget, [SHARED], WIDGET_TARGET);

    expect([...compiledSourceNames(proj, app)]).toContain(SHARED);
    expect([...compiledSourceNames(proj, widget)]).toContain(SHARED);
  });

  it('is compiled by the app when the extension took it first, whichever order runs', () => {
    const proj = openFixture();
    const app = targetUuid(proj, APP_TARGET);
    const widget = targetUuid(proj, WIDGET_TARGET);

    addMissingSourceFiles(proj, widget, [SHARED], WIDGET_TARGET);
    addMissingSourceFiles(proj, app, [SHARED], APP_TARGET);

    expect([...compiledSourceNames(proj, widget)]).toContain(SHARED);
    expect([...compiledSourceNames(proj, app)]).toContain(SHARED);
  });

  it('does not add a second build file when the same target is asked twice', () => {
    const proj = openFixture();
    const app = targetUuid(proj, APP_TARGET);

    addMissingSourceFiles(proj, app, [SHARED], APP_TARGET);
    addMissingSourceFiles(proj, app, [SHARED], APP_TARGET);

    const compiled = proj
      .pbxSourcesBuildPhaseObj(app)
      .files.filter((f: { comment?: string }) => String(f.comment).startsWith(SHARED));
    expect(compiled).toHaveLength(1);
  });
});

/**
 * Scenario: a clean prebuild, where the extension target does not exist yet and
 * is created from scratch.
 *
 * Expected behaviour: the new target compiles the shared source too. The app
 * target claims the only file reference before the extension is created, so
 * whatever adds the extension's sources has to fall back to a second build
 * file rather than trusting `addSourceFile`.
 */
describe('a freshly created extension target', () => {
  it.each([false, true])(
    'resolves sources across prebuilds (app group has path: %s)',
    (hasPath) => {
      let proj = openFixture('app-only.pbxproj');
      if (hasPath) {
        const group = proj.findPBXGroupKey({ name: APP_TARGET });
        if (!group) throw new Error(`no group named ${APP_TARGET}`);
        proj.getPBXGroupByKey(group).path = APP_TARGET;
      }
      const options = {
        projectName: APP_TARGET,
        swiftFiles: ['VeloqWidget.swift', SHARED],
        bundleId: 'com.veloq.app',
        version: '0.4.0',
        buildNumber: '29',
      };
      const nativeRoot = path.dirname(proj.filepath);
      for (const [dir, files] of [
        [APP_TARGET, [SHARED, 'VeloqAppShortcuts.swift']],
        [WIDGET_TARGET, options.swiftFiles],
      ] as const) {
        fs.mkdirSync(path.join(nativeRoot, dir));
        for (const file of files) fs.writeFileSync(path.join(nativeRoot, dir, file), '// source');
      }

      for (let pass = 0; pass < 2; pass++) {
        configureWidgetProject(proj, options);
        fs.writeFileSync(proj.filepath, proj.writeSync());
        proj = xcode.project(proj.filepath).parseSync();
        const objects = proj.hash.project.objects;
        const app = targetUuid(proj, APP_TARGET);
        const widget = targetUuid(proj, WIDGET_TARGET);
        expect(
          proj.getFirstProject().firstProject.targets.map((t: { value: string }) => t.value)
        ).toEqual([app, widget]);
        const groups = Object.values(objects.PBXGroup).filter(
          (entry) => typeof entry === 'object'
        ) as { name?: string; path?: string; children?: { value: string }[] }[];
        const widgetGroups = groups.filter(
          (g) => String(g.name).replace(/"/g, '') === WIDGET_TARGET
        );
        expect(widgetGroups).toHaveLength(1);

        for (const [target, expected] of [
          [app, [SHARED, 'VeloqAppShortcuts.swift']],
          [widget, options.swiftFiles],
        ] as const) {
          const phase = proj.pbxSourcesBuildPhaseObj(target);
          const paths = phase.files.map((entry: { value: string }) => {
            const build = objects.PBXBuildFile[entry.value];
            expect(build).toBeDefined();
            if (typeof build === 'string') throw new Error('Source points to a build-file comment');
            const reference = objects.PBXFileReference[build.fileRef];
            expect(reference).toBeDefined();
            if (typeof reference === 'string') throw new Error('Build file points to a comment');
            const group = groups.find((g) =>
              g.children?.some((child: { value: string }) => child.value === build.fileRef)
            ) as { path?: string };
            expect(group).toBeDefined();
            const file = path.join(
              nativeRoot,
              String(group.path || '').replace(/"/g, ''),
              String(reference.path).replace(/"/g, '')
            );
            expect(fs.existsSync(file)).toBe(true);
            return path.basename(file);
          });
          expect(paths.sort()).toEqual([...expected].sort());
        }
      }
    }
  );
});
