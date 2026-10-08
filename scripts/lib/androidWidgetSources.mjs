// The Android widget sources as the build tree must hold them.
//
// The widgets are tracked under `widget/android/` with a `__PKG__` placeholder, and
// `src/plugins/with-android-widget.js` is the one place that turns them into the
// files Gradle compiles: Kotlin and resources with the package filled in, and the
// receiver, service and picker entries in the manifest. `expo prebuild` runs that
// plugin when it generates `android/`. A widget edit after generation needs only the
// widget files, so the plugin's own writer is run here, against a scratch
// directory, and the build tree is brought to what it wrote. The comparison and the
// copy are the same plan, so what the check refuses is exactly what the copy fixes.

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const require = createRequire(import.meta.url);

export const SYNC = 'npm run sync:android-widgets';

const GRADLE = join('android', 'app', 'build.gradle');
const MAIN = join('android', 'app', 'src', 'main');
const MANIFEST = join(MAIN, 'AndroidManifest.xml');

/** The Kotlin package of the build tree: the namespace its Gradle file declares. */
export function treePackage(root) {
  let gradle;
  try {
    gradle = readFileSync(join(root, GRADLE), 'utf8');
  } catch {
    return null;
  }
  return /namespace\s+['"]([\w.]+)['"]/.exec(gradle)?.[1] ?? null;
}

/** Whether `root` has both an Android tree and tracked widget sources to compare. */
export function hasWidgetTree(root) {
  return treePackage(root) !== null && files(join(root, 'widget', 'android')).length > 0;
}

function files(dir) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

function read(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * What the build tree lacks or holds stale, as `{ write: [{ path, data }], remove: [path] }`
 * with paths relative to `root`. The manifest is separate, see `manifestPlan`.
 */
export function filePlan(root) {
  const pkg = treePackage(root);
  const plugin = require('../../src/plugins/with-android-widget.js');
  const scratch = mkdtempSync(join(tmpdir(), 'veloq-widget-render-'));
  try {
    plugin.writeWidgetSources(root, scratch, pkg);
    const write = [];
    for (const rendered of files(scratch)) {
      const rel = relative(scratch, rendered);
      const data = readFileSync(rendered);
      const existing = read(join(root, 'android', rel));
      if (existing === null || !existing.equals(data)) {
        write.push({ path: join('android', rel), data });
      }
    }
    // The widget Kotlin directory holds nothing else, so a file the render does not
    // produce is one that is no longer tracked.
    const kotlin = join('app', 'src', 'main', 'java', ...pkg.split('.'), 'widget');
    const rendered = new Set(files(join(scratch, kotlin)).map((p) => relative(scratch, p)));
    const remove = files(join(root, 'android', kotlin))
      .map((p) => relative(join(root, 'android'), p))
      .filter((rel) => !rendered.has(rel))
      .map((rel) => join('android', rel));
    return { write, remove };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The widget components of a manifest's application, by element and name. */
function components(app) {
  const found = {};
  for (const kind of ['receiver', 'service', 'activity']) {
    found[kind] = (app[kind] ?? [])
      .filter((c) => (c.$?.['android:name'] ?? '').startsWith('.widget.'))
      .map((c) => JSON.stringify(c))
      .sort();
  }
  return found;
}

/**
 * Apply the plugin's manifest edits to a copy of the tree's manifest. Returns the
 * edited manifest and whether its widget components differ from the tree's.
 */
export async function manifestPlan(root) {
  const { AndroidConfig } = require('expo/config-plugins');
  const plugin = require('../../src/plugins/with-android-widget.js');
  const path = join(root, MANIFEST);
  const current = await AndroidConfig.Manifest.readAndroidManifestAsync(path);
  const edited = JSON.parse(JSON.stringify(current));
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(edited);
  plugin.applyReceivers(app);
  plugin.applyServices(app);
  plugin.applyActivities(app);
  const before = components(AndroidConfig.Manifest.getMainApplicationOrThrow(current));
  const after = components(app);
  return { edited, stale: JSON.stringify(before) !== JSON.stringify(after) };
}

/** Every difference, as lines naming the file, empty when the build tree is current. */
export async function widgetDrift(root) {
  const plan = filePlan(root);
  const lines = [
    ...plan.write.map((w) => `${w.path} differs from widget/android/`),
    ...plan.remove.map((p) => `${p} is no longer tracked`),
  ];
  if ((await manifestPlan(root)).stale) {
    lines.push(`${MANIFEST} lacks or carries stale widget entries`);
  }
  return lines;
}

/** Bring the build tree to the tracked widget sources and return what changed. */
export async function syncWidgetSources(root) {
  const plan = filePlan(root);
  for (const { path, data } of plan.write) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  }
  for (const path of plan.remove) rmSync(join(root, path), { force: true });

  const manifest = await manifestPlan(root);
  const changed = [...plan.write.map((w) => w.path), ...plan.remove];
  if (manifest.stale) {
    const { AndroidConfig } = require('expo/config-plugins');
    await AndroidConfig.Manifest.writeAndroidManifestAsync(join(root, MANIFEST), manifest.edited);
    changed.push(MANIFEST);
  }
  return changed;
}
