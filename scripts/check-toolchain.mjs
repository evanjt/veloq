#!/usr/bin/env node
// Refuse a native build that is missing a stated prerequisite, and say which.
//
// A fresh clone builds with Node, Rust with cargo-ndk and the Android targets,
// a JDK, and the npm, crates.io and Maven registries. Without this check a
// missing piece surfaces deep inside the Expo plugin: an empty tracematch
// directory fails inside cargo, and no Rust at all prints a warning while the
// build carries on. It prints one line per missing prerequisite and nothing
// when the tree is ready. It does nothing in CI, where the workflows check out
// submodules and install the toolchains themselves.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACEMATCH = 'modules/veloqrs/rust/tracematch';

function run(command, args, options) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function works(command, args, env) {
  const result = run(command, args, { env });
  return result.error === undefined && result.status === 0;
}

function submoduleUrl(root) {
  try {
    const text = readFileSync(join(root, '.gitmodules'), 'utf8');
    return /url\s*=\s*(\S+)/.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isEmpty(dir) {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/** One line per prerequisite `root` lacks, after trying to init an empty submodule. */
export function missing(root, env = process.env) {
  if (env.CI) return [];
  const lines = [];

  const submodule = join(root, TRACEMATCH);
  if (isEmpty(submodule)) {
    run('git', ['submodule', 'update', '--init', TRACEMATCH], { cwd: root, env });
    if (isEmpty(submodule)) {
      const url = submoduleUrl(root);
      lines.push(
        `${TRACEMATCH} is empty and git submodule update --init failed` +
          (url ? `: it fetches ${url} over SSH, so check that key is loaded` : '')
      );
    }
  }

  const hasCargo = works('cargo', ['--version'], env);
  if (!hasCargo) lines.push('cargo not found: install Rust from https://rustup.rs');
  if (hasCargo && !works('cargo', ['ndk', '--version'], env)) {
    lines.push('cargo ndk not found: cargo install cargo-ndk');
  }
  if (hasCargo && works('rustup', ['--version'], env)) {
    const installed = run('rustup', ['target', 'list', '--installed'], { env }).stdout ?? '';
    if (!/-linux-android/.test(installed)) {
      lines.push(
        'no Android Rust target installed: rustup target add aarch64-linux-android x86_64-linux-android'
      );
    }
  }
  if (!env.JAVA_HOME) lines.push('JAVA_HOME is not set: point it at a JDK');

  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
  const lines = missing(root);
  if (lines.length > 0) {
    console.error('This clone cannot build the app yet:');
    for (const line of lines) console.error(`  ${line}`);
    process.exit(1);
  }
}
