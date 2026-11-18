// What the release archive must carry of the watch app, judged from the file
// listing of the unpacked app bundle and the watch app's parsed Info.plist.
//
//   node scripts/lib/watch-embed.js <app-dir> --bundle-id ID
//
// The command lists the directory, reads `Watch/VeloqWatch.app/Info.plist` (XML
// or binary, the latter through `plutil` on macOS) and prints each problem. On
// macOS it also reads the watch's compiled catalogue with `xcrun assetutil` and
// requires an `AppIcon` entry, which a listing cannot show.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WATCH_APP = 'Watch/VeloqWatch.app';
const ICON_ENTRY = 'AppIcon';

/**
 * The reasons an app bundle does not carry a usable watch app, empty when it
 * does. `files` are paths relative to the app bundle; `info` is the parsed
 * watch Info.plist, or null when it could not be read.
 */
function watchEmbedProblems({ files, info, appBundleId }) {
  const present = new Set(files);
  const plistPath = `${WATCH_APP}/Info.plist`;
  const catalogue = `${WATCH_APP}/Assets.car`;
  const problems = [];

  if (!present.has(plistPath)) {
    problems.push(`${plistPath} is absent: the app does not embed the watch app`);
  } else if (!info) {
    problems.push(`${plistPath} could not be read`);
  } else {
    if (info.WKCompanionAppBundleIdentifier !== appBundleId) {
      problems.push(
        `WKCompanionAppBundleIdentifier is ${info.WKCompanionAppBundleIdentifier}, not ${appBundleId}`
      );
    }
    if (info.WKRunsIndependentlyOfCompanionApp !== false) {
      problems.push('WKRunsIndependentlyOfCompanionApp is not false');
    }
  }
  if (present.has(plistPath) && !present.has(catalogue)) {
    problems.push(`${catalogue} is absent: the watch app carries no compiled ${ICON_ENTRY}`);
  }
  return problems;
}

function listFiles(root, dir = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
  }
  return out;
}

function readPlist(file) {
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  return JSON.parse(json);
}

/** The catalogue's `AppIcon` entry, read with `assetutil`, or a problem. */
function iconProblems(catalogue) {
  const info = JSON.parse(
    execFileSync('xcrun', ['assetutil', '--info', catalogue], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  );
  const named = info.some((entry) => entry.Name === ICON_ENTRY);
  return named ? [] : [`${catalogue} holds no ${ICON_ENTRY} entry`];
}

function main(argv) {
  const [appDir, flag, appBundleId] = argv;
  if (!appDir || flag !== '--bundle-id' || !appBundleId) {
    console.error('usage: watch-embed.js <app-dir> --bundle-id ID');
    return 2;
  }
  const files = listFiles(appDir);
  const plistFile = path.join(appDir, WATCH_APP, 'Info.plist');
  let info = null;
  if (files.includes(`${WATCH_APP}/Info.plist`)) {
    try {
      info = readPlist(plistFile);
    } catch {
      info = null;
    }
  }
  const problems = watchEmbedProblems({ files, info, appBundleId });
  const catalogue = path.join(appDir, WATCH_APP, 'Assets.car');
  if (!problems.length && process.platform === 'darwin') {
    problems.push(...iconProblems(catalogue));
  }
  for (const problem of problems) console.error(`watch-embed: ${problem}`);
  if (!problems.length) console.log(`watch-embed: ${WATCH_APP} is embedded for ${appBundleId}`);
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { ICON_ENTRY, WATCH_APP, watchEmbedProblems };
