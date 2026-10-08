#!/usr/bin/env node
// Write the Android widget sources for the engine module's instrumented tests.
//
// The widget capture test inflates the providers' RemoteViews on a device, so it
// needs the Kotlin and the resources the app ships, with the strings and the
// flag the plugin generates. The plugin's own writer produces them, into an
// Android tree under `--out`, for the package `--pkg`, so the test draws exactly
// what a build of the app would compile. Gradle runs this before the test's
// sources are compiled.

import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (!value) {
    console.error(`write-widget-test-sources: ${name} is required`);
    process.exit(1);
  }
  return value;
}

const out = resolve(option('--out'));
const pkg = option('--pkg');

// A rename or a deleted layout must not survive in the generated tree.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'app', 'src', 'main'), { recursive: true });

const plugin = require(join(root, 'src', 'plugins', 'with-android-widget.js'));
plugin.writeWidgetSources(root, out, pkg);

// The quick settings tile is not a widget, and it names the app through a string
// only the app's own resources define.
rmSync(
  join(out, 'app', 'src', 'main', 'java', ...pkg.split('.'), 'widget', 'RecordTileService.kt')
);
