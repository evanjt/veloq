/**
 * Scenario: the Android widget sources are tracked under `widget/android/`
 * and reach the build tree only through a copy that fills in the package.
 * A widget change that lands without the copy leaves the build tree compiling
 * the previous widgets, and the APK installs and launches regardless.
 *
 * Expected behaviour: the native tree check refuses a build tree whose widget
 * sources, resources or manifest entries differ from the tracked ones, naming
 * what differs and the command that copies them. After that command the check
 * passes, a second run changes nothing, and a Kotlin file removed from the
 * tracked tree is removed from the build tree.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const projectRoot = path.join(__dirname, '../../..');
const checkScript = path.join(projectRoot, 'scripts/check-native-tree.mjs');
const syncScript = path.join(projectRoot, 'scripts/sync-android-widgets.mjs');

const PKG = 'com.example.sample';
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication">
    <activity android:name=".MainActivity" android:exported="true"/>
  </application>
</manifest>
`;

/** A self-contained checkout with one tracked widget file and an Android tree built before it. */
function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-sources-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'modules', 'veloqrs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'react'), { recursive: true });
  fs.symlinkSync(path.join(root, 'modules', 'veloqrs'), path.join(root, 'node_modules', 'veloqrs'));

  write(
    path.join(root, 'widget/android/java/SampleProvider.kt'),
    `package __PKG__.widget\n\nconst val SAMPLE = "current"\n`
  );
  write(
    path.join(root, 'widget/android/res/xml/sample_info.xml'),
    `<info android:configure="__PKG__.widget.SampleConfigure"/>\n`
  );

  const main = path.join(root, 'android/app/src/main');
  write(path.join(root, 'android/app/build.gradle'), `android {\n    namespace '${PKG}'\n}\n`);
  write(path.join(main, 'AndroidManifest.xml'), MANIFEST);
  const built = path.join(main, 'java', ...PKG.split('.'), 'widget');
  write(
    path.join(built, 'SampleProvider.kt'),
    `package ${PKG}.widget\n\nconst val SAMPLE = "old"\n`
  );
  return { root, built, main };
}

function run(script: string, root: string) {
  return spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
}

describe('the Android widget sources in the build tree', () => {
  it('refuses a build tree whose widget Kotlin differs from the tracked file', () => {
    const { root } = tree();

    const result = run(checkScript, root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SampleProvider.kt');
    expect(result.stderr).toContain('npm run sync:android-widgets');
  });

  it('passes after the copy, with the package filled in', () => {
    const { root, built } = tree();

    const synced = run(syncScript, root);
    const checked = run(checkScript, root);

    expect(synced.status).toBe(0);
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);
    expect(fs.readFileSync(path.join(built, 'SampleProvider.kt'), 'utf8')).toBe(
      `package ${PKG}.widget\n\nconst val SAMPLE = "current"\n`
    );
  });

  it('copies resources with the package filled in and registers the widget manifest entries', () => {
    const { root, main } = tree();

    run(syncScript, root);

    expect(fs.readFileSync(path.join(main, 'res/xml/sample_info.xml'), 'utf8')).toBe(
      `<info android:configure="${PKG}.widget.SampleConfigure"/>\n`
    );
    const manifest = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('.widget.VeloqWidgetProvider');
    expect(manifest).toContain('.widget.InsightsWidgetConfigureActivity');
    expect(manifest).toContain('.MainActivity');
  });

  it('refuses a tree missing a widget file that is only tracked', () => {
    const { root } = tree();
    run(syncScript, root);
    write(path.join(root, 'widget/android/java/NewWidget.kt'), 'package __PKG__.widget\n');

    const result = run(checkScript, root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NewWidget.kt');
  });

  it('refuses a manifest that lacks a widget entry', () => {
    const { root, main } = tree();
    run(syncScript, root);
    write(path.join(main, 'AndroidManifest.xml'), MANIFEST);

    const result = run(checkScript, root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AndroidManifest.xml');
  });

  it('removes a Kotlin file that is no longer tracked, and a second copy changes nothing', () => {
    const { root, built } = tree();
    write(path.join(built, 'Removed.kt'), 'package gone\n');

    run(syncScript, root);
    const before = fs.statSync(path.join(built, 'SampleProvider.kt')).mtimeMs;
    const again = run(syncScript, root);

    expect(fs.existsSync(path.join(built, 'Removed.kt'))).toBe(false);
    expect(again.status).toBe(0);
    expect(fs.statSync(path.join(built, 'SampleProvider.kt')).mtimeMs).toBe(before);
  });

  it('skips the widget comparison when there is no Android tree to build', () => {
    const { root } = tree();
    fs.rmSync(path.join(root, 'android'), { recursive: true });

    const result = run(checkScript, root);

    expect(result.status).toBe(0);
  });

  it('is run by every recipe that builds the app, inside the build lock', () => {
    const scripts = (
      JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['sync:android-widgets']).toContain('sync-android-widgets.mjs');
    for (const name of ['android:debug', 'test:android', 'test:android:unit']) {
      expect(scripts[name]).toContain('sync-android-widgets.mjs');
    }
    const runner = fs.readFileSync(path.join(projectRoot, 'scripts/run-android.sh'), 'utf8');
    expect(runner.match(/sync-android-widgets\.mjs/g)).toHaveLength(2);
  });
});
