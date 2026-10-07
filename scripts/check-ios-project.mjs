#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const ios = join(root, 'ios');
const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const build = config.expo.plugins.find((plugin) =>
  Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
);
const configured = build?.[1]?.ios?.deploymentTarget;
function version(value) {
  const match = String(value).replaceAll('"', '').trim().match(/^(\d+)(?:\.(\d+))?$/);
  return match ? Number(match[1]) * 100 + Number(match[2] ?? 0) : NaN;
}

if (!configured || !Number.isFinite(version(configured))) {
  console.error('iOS deployment target is missing from expo-build-properties');
  process.exit(1);
}
if (version(configured) < 1604) {
  console.error(`iOS deployment target ${configured} is below the app minimum 16.4`);
  process.exit(1);
}

function paths(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['Pods', 'build', '.gradle'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? paths(path) : [path];
  });
}

const files = paths(ios);
const shortcutCatalogues = files.filter((file) => file.endsWith('/AppShortcuts.xcstrings'));
const projectTargets = files
  .filter((file) => file.endsWith('/project.pbxproj'))
  .flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([^;]+);/g)].map(
      (match) => ({ file, target: version(match[1]), label: match[1].trim() })
    )
  );

let failed = false;
for (const { file, target, label } of projectTargets) {
  if (Number.isFinite(target) && target >= version(configured)) continue;
  console.error(`${file}: deployment target ${label} is below configured ${configured}`);
  failed = true;
}
if (version(configured) < 1700 && shortcutCatalogues.length > 0) {
  for (const file of shortcutCatalogues) {
    console.error(`${file}: AppShortcuts.xcstrings requires iOS 17, target is ${configured}`);
  }
  failed = true;
}
if (failed) process.exit(1);
