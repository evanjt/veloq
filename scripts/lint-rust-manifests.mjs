#!/usr/bin/env node
// The veloqrs and tracematch manifests, and the test and bench sources they
// build, must agree in four ways cargo cannot check for itself.
//
// 1. A test or bench file gated on a feature needs `required-features` in its
//    manifest stanza. A crate-level `#![cfg(feature = "...")]`, or an item-level
//    `#[cfg(feature = "...")]` on a `#[test]`, still builds under a lane without
//    the feature. Every gated item compiles away, the binary runs and cargo
//    prints `ok. 0 passed`, indistinguishable from a pass. `required-features`
//    makes cargo skip the target and say so. A test source counts as covered
//    when a gated stanza owns it directly or through an area binary's
//    `#[path = "../<stem>.rs"]` include.
// 2. `autotests = false`, and every `tests/*.rs` has exactly one `[[test]]`
//    stanza, direct or through an area binary's include.
// 3. A `[profile.*]` in a workspace member is discarded by cargo, so only the
//    workspace root may declare one. tracematch is the exception because it is
//    also built standalone, where cargo honours its own; its `[profile.release]`
//    must hold the same settings as the root's. The root's release profile pins
//    `codegen-units = 1` and `lto = true`, because at the default 16 the
//    section fold's nearest-neighbour queries inline or not by partitioning
//    luck, and does not optimise for size.
// 4. A checkout without the tracematch submodule is judged on the rest.
//
// Usage: node scripts/lint-rust-manifests.mjs [--root <dir>]

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const WORKSPACE = join(ROOT, 'modules/veloqrs/rust');
const CRATE = join(WORKSPACE, 'veloqrs');

// A member allowed a profile of its own, because it is also built standalone.
const PROFILE_EXEMPT = ['tracematch'];

const TARGET_KINDS = [
  { dir: 'tests', stanza: '[[test]]' },
  { dir: 'benches', stanza: '[[bench]]' },
];

const failures = [];
const fail = (message) => failures.push(message);

// The manifests and sources come out of the index. The tracematch manifest is
// read off the disk on purpose: it sits inside the submodule, whose files the
// superproject's index does not hold.
const tree = treeView(ROOT, ['modules/veloqrs/rust']);
const read = (path) => {
  const text = tree.text(path);
  if (text === undefined) throw new Error(`${path} is not in the tree`);
  return text;
};
const rel = (path) =>
  path
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/');

/** The feature named by a crate-level `#![cfg(feature = "...")]`, if any. */
function featureInCrateLevelCfg(source) {
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('#![cfg(')) {
      // Crate-level attributes precede any item, so once code starts there is
      // nothing left to find.
      if (line !== '' && !line.startsWith('//') && !line.startsWith('#![')) return null;
      continue;
    }
    const found = /feature = "([^"]*)"/.exec(line);
    if (found) return found[1];
  }
  return null;
}

const isTestAttribute = (line) => {
  const inner = /^#\[(.*)\]$/.exec(line)?.[1];
  return inner !== undefined && (inner === 'test' || inner.endsWith('::test'));
};

/**
 * The feature named by an item-level gate that removes a `#[test]`. The gate and
 * the `#[test]` have to sit in one run of attributes, in either order; a `cfg`
 * on anything else removes no test from the report.
 */
function featureInItemLevelTestCfg(source) {
  let feature = null;
  let hasTest = false;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#[')) {
      if (line.startsWith('#[cfg(')) {
        const found = /feature = "([^"]*)"/.exec(line);
        if (found) feature = found[1];
      }
      hasTest ||= isTestAttribute(line);
      continue;
    }
    if (line.startsWith('//')) continue;
    if (hasTest && feature !== null) return feature;
    feature = null;
    hasTest = false;
  }
  return null;
}

/** Each table's body, `name` in `[[test]]` style headers, split on the header lines. */
function stanzas(manifest, header) {
  const out = [];
  let current = null;
  for (const raw of manifest.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      current = line === header ? [] : null;
      if (current) out.push(current);
      continue;
    }
    current?.push(line);
  }
  return out;
}

const valueOf = (lines, key) => {
  for (const line of lines) {
    const match = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`).exec(line);
    if (match) return match[1];
  }
  return null;
};

function targets(manifest, header) {
  return stanzas(manifest, header).map((lines) => ({
    name: valueOf(lines, 'name'),
    path: valueOf(lines, 'path'),
    gated: lines.some((line) => line.startsWith('required-features')),
  }));
}

/** The `[[test]]` stanzas that build `tests/<stem>.rs`, directly or by an include. */
function owningTests(tests, stem) {
  return tests.filter((target) => {
    if (target.path === `tests/${stem}.rs`) return true;
    if (!target.path?.endsWith('/main.rs')) return false;
    try {
      return tree.text(join(CRATE, target.path))?.includes(`#[path = "../${stem}.rs"]`) ?? false;
    } catch {
      return false;
    }
  });
}

/** The `.rs` files directly inside `dir`, sorted; a nested directory is another target's. */
function rustFiles(dir) {
  return tree
    .files(dir, (rel) => rel.endsWith('.rs'))
    .filter((file) => dirname(file) === dir)
    .map((file) => basename(file))
    .sort();
}

function checkTargets() {
  const manifestPath = join(CRATE, 'Cargo.toml');
  const manifest = read(manifestPath);
  if (!/^autotests\s*=\s*false\s*$/m.test(manifest)) {
    fail(
      `${rel(manifestPath)}: autotests = false is missing, so implicit test binaries are enabled`
    );
  }
  const tests = targets(manifest, '[[test]]');
  let checked = 0;

  for (const { dir, stanza } of TARGET_KINDS) {
    const declared = targets(manifest, stanza);
    const gatedNames = new Set(declared.filter((t) => t.gated).map((t) => t.name));
    for (const file of rustFiles(join(CRATE, dir))) {
      checked += 1;
      const stem = file.slice(0, -3);
      const source = read(join(CRATE, dir, file));
      const owners = dir === 'tests' ? owningTests(tests, stem) : [];
      if (dir === 'tests' && owners.length !== 1) {
        fail(`tests/${file} must have exactly one [[test]] target, found ${owners.length}`);
      }
      const covered = gatedNames.has(stem) || owners.some((owner) => owner.gated);
      if (covered) continue;
      const crateLevel = featureInCrateLevelCfg(source);
      if (crateLevel !== null) {
        fail(
          `${dir}/${file} gates on feature "${crateLevel}" but has no ${stanza} stanza with ` +
            'required-features, so it compiles to an empty binary and reports `ok. 0 passed` without the feature'
        );
        continue;
      }
      const itemLevel = featureInItemLevelTestCfg(source);
      if (itemLevel !== null) {
        fail(
          `${dir}/${file} gates a #[test] on feature "${itemLevel}" but has no ${stanza} stanza with ` +
            'required-features, so those tests compile away and report `ok. 0 passed` beside the ungated ones'
        );
      }
    }
  }
  if (checked === 0) fail(`${rel(CRATE)}: no test or bench sources found to check`);
}

/** A manifest's `[profile.release]` as sorted `key = value` lines, or null. */
function releaseProfile(manifest) {
  const body = stanzas(manifest, '[profile.release]')[0];
  if (!body) return null;
  return body.filter((line) => line !== '' && !line.startsWith('#')).sort();
}

const setting = (profile, key) => {
  const line = profile.find((l) => l.split('=')[0].trim() === key);
  return line?.split('=').slice(1).join('=').trim();
};

function checkProfiles() {
  const rootPath = join(WORKSPACE, 'Cargo.toml');
  const rootManifest = read(rootPath);
  const release = releaseProfile(rootManifest);
  if (release === null) {
    fail(
      `${rel(rootPath)} declares no [profile.release]: the release build takes cargo's defaults, ` +
        'and codegen-units = 16 makes the warm-add median a coin toss decided by unrelated edits'
    );
  } else {
    if (setting(release, 'codegen-units') !== '1') {
      fail(`${rel(rootPath)}: [profile.release] must pin codegen-units = 1`);
    }
    if (setting(release, 'lto') !== 'true') {
      fail(`${rel(rootPath)}: [profile.release] must keep lto = true`);
    }
    if (['"s"', '"z"'].includes(setting(release, 'opt-level'))) {
      fail(
        `${rel(rootPath)}: [profile.release] sets opt-level for size, which measured 2.5x slower on the warm-add median`
      );
    }
  }

  const tracematchPath = join(WORKSPACE, 'tracematch/Cargo.toml');
  if (existsSync(tracematchPath) && release !== null) {
    const own = releaseProfile(readFileSync(tracematchPath, 'utf8'));
    if (own === null || own.join('\n') !== release.join('\n')) {
      fail(
        `${rel(tracematchPath)}: [profile.release] differs from the workspace root's, so a veloq build ` +
          'and a standalone tracematch build compile the detector differently'
      );
    }
  }

  const list = /members\s*=\s*\[([^\]]*)\]/.exec(rootManifest)?.[1];
  const members = (list ?? '')
    .split(',')
    .map((member) => member.trim().replace(/^"|"$/g, '').trim())
    .filter(Boolean);
  if (members.length === 0) fail(`${rel(rootPath)}: no workspace members found to check`);
  let checked = 0;
  for (const member of members) {
    if (PROFILE_EXEMPT.includes(member)) continue;
    checked += 1;
    const path = join(WORKSPACE, member, 'Cargo.toml');
    if (!tree.has(path)) continue;
    const ignored = read(path)
      .split('\n')
      .map((line) => /^\[(.*)\]$/.exec(line.trim())?.[1].trim())
      .filter((section) => section === 'profile' || section?.startsWith('profile.'));
    if (ignored.length > 0) {
      fail(
        `${rel(path)} declares [${ignored.join('], [')}], which cargo discards with ` +
          '`profiles for the non root package will be ignored`. Move it to the workspace root'
      );
    }
  }
  if (members.length > 0 && checked === 0)
    fail('every workspace member is exempt, so the profile ban checks nothing');
}

checkTargets();
checkProfiles();

if (failures.length > 0) {
  console.error(`Rust manifest guard: ${failures.length} violation(s).`);
  for (const message of failures) console.error(`  ${message}`);
  process.exit(1);
}
console.log('Rust manifest guard: no violations.');
