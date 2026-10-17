#!/usr/bin/env node
// Refuse a native build that is missing a stated prerequisite, and say which.
//
// A fresh clone builds Android with Node, Rust with cargo-ndk and the Android
// targets, a JDK, and the npm, crates.io and Maven registries. It builds iOS
// with Node, Rust with the Apple targets the Xcode phase compiles, and Xcode,
// on a Mac that need hold none of the Android pieces. Without this check a
// missing piece surfaces deep inside the Expo plugin: an empty tracematch
// directory fails inside cargo, and no Rust at all prints a warning while the
// build carries on. It prints one line per missing prerequisite and nothing
// when the tree is ready. It does nothing in CI, where the workflows check out
// submodules and install the toolchains themselves.
//
// CI builds under the Node major `.nvmrc` pins, so a local build under another
// major runs Metro, the config plugins and the postinstall repairs on a Node
// the release never sees. That is named as a warning and refuses nothing.
//
// A shell with no JAVA_HOME is not refused when the system JVM directory holds
// a JDK: the first of JDK_CANDIDATES with a `java` binary is chosen and named.
// `--print-java-home` prints the JDK on stdout, so a build script exports the
// one this check passed rather than whatever `java` the path finds first.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRACEMATCH = 'modules/veloqrs/rust/tracematch';
const PLATFORMS = ['android', 'ios'];
const APPLE_TARGETS = ['aarch64-apple-ios', 'aarch64-apple-ios-sim'];
// The JDK the Android build is made with, then the system default.
export const JDK_CANDIDATES = ['java-17-openjdk', 'default'];
// The override is for the tests, which cannot write the system directory.
const jvmDir = (env) => env.VELOQ_JVM_DIR || '/usr/lib/jvm';

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

/** The Node major `.nvmrc` under `root` pins, or null when it pins none. */
export function pinnedNodeMajor(root) {
  try {
    const major = /^\s*v?(\d+)/.exec(readFileSync(join(root, '.nvmrc'), 'utf8'))?.[1];
    return major === undefined ? null : Number(major);
  } catch {
    return null;
  }
}

/**
 * The JDK an Android build uses: `home`, and `chosen` when it was found rather
 * than set. JAVA_HOME wins when set, then the first candidate under the JVM
 * directory with a `java` binary. Null when there is none.
 */
export function javaHome(env) {
  if (env.JAVA_HOME) return { home: env.JAVA_HOME, chosen: false };
  for (const name of JDK_CANDIDATES) {
    const home = join(jvmDir(env), name);
    if (existsSync(join(home, 'bin', 'java'))) return { home, chosen: true };
  }
  return null;
}

/** A warning when `version` is not the major `root` pins, or null when it is or nothing is pinned. */
export function nodeMismatch(root, env, version = process.version) {
  if (env.CI) return null;
  const pinned = pinnedNodeMajor(root);
  const running = Number(/^v?(\d+)/.exec(version)?.[1]);
  if (pinned === null || running === pinned) return null;
  return `Node ${version} is running, but .nvmrc pins Node ${pinned}, the major CI builds with: switch with nvm use or fnm use`;
}

/** One line per prerequisite `root` lacks to build `platform`, after trying to init an empty submodule. */
export function missing(root, env, platform) {
  if (!PLATFORMS.includes(platform)) throw new Error(`unknown platform: ${platform}`);
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
  const installed =
    hasCargo && works('rustup', ['--version'], env)
      ? (run('rustup', ['target', 'list', '--installed'], { env }).stdout ?? '').split('\n')
      : null;

  if (platform === 'android') {
    if (hasCargo && !works('cargo', ['ndk', '--version'], env)) {
      lines.push('cargo ndk not found: cargo install cargo-ndk');
    }
    if (installed && !installed.some((target) => target.includes('-linux-android'))) {
      lines.push(
        'no Android Rust target installed: rustup target add aarch64-linux-android x86_64-linux-android'
      );
    }
    if (!javaHome(env)) {
      lines.push(`JAVA_HOME is not set and ${jvmDir(env)} holds no JDK: point it at a JDK`);
    }
  } else {
    for (const target of APPLE_TARGETS) {
      if (installed && !installed.includes(target)) {
        lines.push(`Apple Rust target ${target} not installed: rustup target add ${target}`);
      }
    }
    if (!works('xcodebuild', ['-version'], env)) {
      lines.push('xcodebuild not found: install Xcode and run xcode-select --install');
    }
  }

  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
  const platform = argv[argv.indexOf('--platform') + 1];
  if (!argv.includes('--platform') || !PLATFORMS.includes(platform)) {
    console.error(
      'usage: check-toolchain.mjs --platform android|ios [--root DIR] [--print-java-home]'
    );
    process.exit(2);
  }
  const mismatch = nodeMismatch(root, process.env);
  if (mismatch) console.error(`Warning: ${mismatch}`);
  const lines = missing(root, process.env, platform);
  if (lines.length > 0) {
    console.error('This clone cannot build the app yet:');
    for (const line of lines) console.error(`  ${line}`);
    process.exit(1);
  }
  const jdk = platform === 'android' && !process.env.CI ? javaHome(process.env) : null;
  if (jdk?.chosen) console.error(`JAVA_HOME is not set; using ${jdk.home}`);
  if (argv.includes('--print-java-home')) {
    const home = jdk?.home ?? process.env.JAVA_HOME;
    if (home) console.log(home);
  }
}
