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

import { addMissingSourceFiles, compiledSourceNames } from '@/../src/plugins/with-ios-widget';

const APP_TARGET = 'VeloqDev';
const WIDGET_TARGET = 'VeloqWidget';
const SHARED = 'RecordDeepLink.swift';

function openFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-pbx-'));
  const file = path.join(dir, 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', 'project.pbxproj'), file);
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
