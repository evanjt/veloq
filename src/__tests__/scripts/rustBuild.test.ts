/**
 * Scenario: Gradle, the Xcode build phases and CI build the Rust library
 * through one builder, and the app packages whatever that builder last
 * published. A
 * library that survives a failed compile, or one built for other ABIs, another
 * profile or another feature set, ships code the checkout does not hold.
 * Expected behaviour: each selection publishes its own validated output once
 * Cargo succeeded, reuses it only while every declared input is unchanged, and
 * leaves nothing to package when the compile or the validation fails.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '../../..');
const BUILDER = join(ROOT, 'modules/veloqrs/scripts/build-rust.js');
const { hashRustInputs } = require(join(ROOT, 'modules/veloqrs/scripts/rust-inputs.js'));
const { main } = require(BUILDER) as {
  main: (
    argv: string[],
    env: Record<string, string | undefined>,
    overrides: { moduleDir: string; log: (line: string) => void }
  ) => string;
};

// The fakes log beside their own directory and read their switches from a
// file as well as the environment, because the builder hands Cargo only a
// terminal's environment when an Xcode phase calls it.
const FAKE_FLAGS = `const fakeLog = path.join(__dirname, '..', 'calls.log');
const flagFile = path.join(__dirname, '..', 'fake-env.json');
const flags = { ...(fs.existsSync(flagFile) ? JSON.parse(fs.readFileSync(flagFile, 'utf8')) : {}), ...process.env };
`;

// Writes what cargo-ndk and `cargo build` would, and logs each call. The ELF
// header carries the machine for the ABI, and the body the UniFFI symbol
// prefix and the feature list, so a test can read which build it holds.
const FAKE_CARGO = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
${FAKE_FLAGS}const args = process.argv.slice(2);
if (args[0] === 'ndk' && args[1] === '--version') {
  console.log('cargo-ndk 4.1.2');
  process.exit(0);
}
fs.appendFileSync(fakeLog, 'cargo ' + args.join(' ') + '\\n');
if (flags.FAKE_LOG_ENV) {
  fs.appendFileSync(fakeLog, 'env CC=' + process.env.CC + ' SDKROOT=' + process.env.SDKROOT + ' LTO=' + process.env.CARGO_PROFILE_RELEASE_LTO + '\\n');
}
if (flags.FAKE_CARGO_DELAY_MS) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(flags.FAKE_CARGO_DELAY_MS));
}
if (flags.FAKE_CARGO_FAIL) process.exit(101);
if (flags.FAKE_EDIT) fs.appendFileSync(flags.FAKE_EDIT, '\\n// edited while compiling\\n');
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? '' : args[i + 1]; };
const features = value('--features');
const symbols = flags.FAKE_NO_SYMBOLS ? '' : 'uniffi_veloqrs_fn_init';
const machines = { 'arm64-v8a': 183, 'armeabi-v7a': 40, x86_64: 62, x86: 3 };
if (args[0] === 'ndk') {
  const out = value('-o');
  args.forEach((arg, i) => {
    if (arg !== '-t') return;
    const abi = args[i + 1];
    const header = Buffer.alloc(20);
    header.write('\\x7fELF', 0, 'latin1');
    header[5] = 1;
    header.writeUInt16LE(flags.FAKE_WRONG_MACHINE ? 999 : machines[abi], 18);
    fs.mkdirSync(path.join(out, abi), { recursive: true });
    fs.writeFileSync(path.join(out, abi, 'libveloqrs.so'),
      Buffer.concat([header, Buffer.from(symbols + ' features=' + features)]));
  });
} else if (args[0] === 'build') {
  const triple = value('--target');
  const profile = args.includes('--release') ? 'release' : 'debug';
  const dir = path.join(process.cwd(), 'target', triple, profile);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'libveloqrs.a');
  fs.writeFileSync(file, '!<arch>\\n' + symbols + ' triple=' + triple + ' features=' + features);
  console.log(JSON.stringify({ reason: 'compiler-artifact', target: { name: 'veloqrs' }, filenames: [file] }));
  console.log(JSON.stringify({ reason: 'build-finished', success: true }));
}
`;

const FAKE_RUSTC = `#!/usr/bin/env node
console.log('rustc 1.95.0 (fake)\\nhost: x86_64-unknown-linux-gnu');
`;

// Report their versions the way the real tools do, `-version` over two lines.
const FAKE_XCODEBUILD = `#!/usr/bin/env node
console.log('Xcode 26.2\\nBuild version 17C52');
`;

const FAKE_XCRUN = `#!/usr/bin/env node
const args = process.argv.slice(2);
console.log(args[args.indexOf('--sdk') + 1] === 'iphonesimulator' ? '26.1' : '26.2');
`;

const FAKE_LIPO = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
${FAKE_FLAGS}const args = process.argv.slice(2);
fs.appendFileSync(fakeLog, 'lipo ' + args.join(' ') + '\\n');
const out = args[args.indexOf('-output') + 1];
const inputs = args.slice(1, args.indexOf('-output'));
const magic = Buffer.alloc(4);
magic.writeUInt32BE(0xcafebabe, 0);
fs.writeFileSync(out, Buffer.concat([magic, ...inputs.map((f) => fs.readFileSync(f))]));
`;

let root: string;
let moduleDir: string;
let log: string;
let env: NodeJS.ProcessEnv;

function write(file: string, contents: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function tool(bin: string, name: string, source: string) {
  write(join(bin, name), source);
  chmodSync(join(bin, name), 0o755);
}

function ndk(revision: string) {
  const dir = join(root, `ndk-${revision}`);
  write(join(dir, 'source.properties'), `Pkg.Desc = Android NDK\nPkg.Revision = ${revision}\n`);
  return dir;
}

function build(argv: string[], extraEnv: Record<string, string | undefined> = {}) {
  const flags = Object.entries(extraEnv).filter(([name]) => name.startsWith('FAKE_'));
  writeFileSync(join(root, 'fake-env.json'), JSON.stringify(Object.fromEntries(flags)));
  return main(argv, { ...env, ...extraEnv }, { moduleDir, log: () => {} });
}

function calls(tool?: string) {
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  writeFileSync(log, '');
  return tool ? lines.filter((line) => line.startsWith(`${tool} `)) : lines;
}

function androidOut(selection: string) {
  return join(moduleDir, 'build/rust/android', selection);
}

function library(selection: string, abi: string) {
  return readFileSync(join(androidOut(selection), 'jniLibs', abi, 'libveloqrs.so'), 'latin1');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rust-build-'));
  moduleDir = join(root, 'modules/veloqrs');
  log = join(root, 'calls.log');
  const bin = join(root, 'bin');
  tool(bin, 'cargo', FAKE_CARGO);
  tool(bin, 'lipo', FAKE_LIPO);
  tool(bin, 'rustc', FAKE_RUSTC);
  tool(bin, 'xcodebuild', FAKE_XCODEBUILD);
  tool(bin, 'xcrun', FAKE_XCRUN);
  write(join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.95.0"\n');
  write(join(moduleDir, 'rust/Cargo.toml'), '[workspace]\nmembers = ["veloqrs"]\n');
  write(join(moduleDir, 'rust/Cargo.lock'), 'version = 4\n');
  write(join(moduleDir, 'rust/veloqrs/Cargo.toml'), '[package]\nname = "veloqrs"\n');
  write(
    join(moduleDir, 'rust/veloqrs/src/lib.rs'),
    'pub const SCHEMA: &str = include_str!("../migrations/001_init.sql");\n'
  );
  write(join(moduleDir, 'rust/veloqrs/migrations/001_init.sql'), 'CREATE TABLE a (id);\n');
  write(join(moduleDir, 'cpp/veloqrs.h'), '// header\n');
  write(join(moduleDir, 'cpp/veloqrs.cpp'), '// wrapper\n');
  write(join(moduleDir, 'cpp/generated/veloqrs.hpp'), '// bindings header\n');
  write(join(moduleDir, 'cpp/generated/veloqrs.cpp'), '// bindings\n');
  env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: root,
    CARGO_HOME: join(root, 'cargo-home'),
    NODE_ENV: 'test',
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the Android build', () => {
  const ARM = ['android', '--abi', 'arm64-v8a'];

  it('publishes a validated library with its manifest, then reuses it with no compile', () => {
    const out = build(ARM);

    expect(out).toBe(androidOut('release-arm64-v8a'));
    expect(calls('cargo')).toEqual([
      expect.stringMatching(
        /^cargo ndk -t arm64-v8a --platform 24 -o \S+ build --release -p veloqrs$/
      ),
    ]);
    expect(library('release-arm64-v8a', 'arm64-v8a')).toContain('uniffi_veloqrs_');
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      platform: 'android',
      targets: ['arm64-v8a'],
      profile: 'release',
    });
    expect(Object.keys(manifest.files)).toEqual(['jniLibs/arm64-v8a/libveloqrs.so']);
    expect(manifest.toolchain).toEqual({
      rustc: 'rustc 1.95.0 (fake)\nhost: x86_64-unknown-linux-gnu',
      cargoNdk: 'cargo-ndk 4.1.2',
    });

    build(ARM);
    expect(calls('cargo')).toEqual([]);
  });

  it('reports the resolved compiler and cargo-ndk in the build output', () => {
    const lines: string[] = [];
    main(ARM, env, { moduleDir, log: (line: string) => lines.push(line) });
    const output = lines.join('\n');
    expect(output).toContain('rustc: rustc 1.95.0 (fake); host: x86_64-unknown-linux-gnu');
    expect(output).toContain('cargoNdk: cargo-ndk 4.1.2');
  });

  it('records the Rust sources hash it compiled from in the manifest', () => {
    const out = build(ARM);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.sources).toBe(hashRustInputs(join(moduleDir, 'rust')));
  });

  it('publishes nothing when a source changes while Cargo runs', () => {
    expect(() => build(ARM, { FAKE_EDIT: join(moduleDir, 'rust/veloqrs/src/lib.rs') })).toThrow(
      /changed while/
    );
    expect(existsSync(androidOut('release-arm64-v8a'))).toBe(false);
    calls();

    build(ARM);
    expect(calls('cargo')).toHaveLength(1);
  });

  it('compiles again after a source edit and after a change to embedded SQL alone', () => {
    build(ARM);
    calls();

    write(
      join(moduleDir, 'rust/veloqrs/src/lib.rs'),
      'pub const SCHEMA: &str = include_str!("../migrations/001_init.sql");\npub fn f() {}\n'
    );
    build(ARM);
    expect(calls('cargo')).toHaveLength(1);

    write(join(moduleDir, 'rust/veloqrs/migrations/001_init.sql'), 'CREATE TABLE a (id, name);\n');
    build(ARM);
    expect(calls('cargo')).toHaveLength(1);
  });

  it('gives each ABI set, profile and feature set its own output, and switching back compiles nothing', () => {
    build(ARM);
    build(['android', '--abi', 'x86_64', '--abi', 'arm64-v8a']);
    build([...ARM, '--profile', 'debug']);
    build([...ARM, '--features', 'lock-trace']);
    expect(calls('cargo')).toEqual([
      expect.stringContaining('-t arm64-v8a --platform'),
      expect.stringContaining('-t arm64-v8a -t x86_64 --platform'),
      expect.not.stringContaining('--release'),
      expect.stringContaining('--features lock-trace'),
    ]);

    expect(readdirSync(join(moduleDir, 'build/rust/android')).sort()).toEqual([
      'debug-arm64-v8a',
      'release-arm64-v8a',
      'release-arm64-v8a-lock-trace',
      'release-arm64-v8a_x86_64',
    ]);
    expect(library('release-arm64-v8a', 'arm64-v8a')).not.toContain('lock-trace');
    expect(library('release-arm64-v8a-lock-trace', 'arm64-v8a')).toContain('features=lock-trace');

    build(ARM);
    build([...ARM, '--features', 'lock-trace']);
    expect(calls('cargo')).toEqual([]);
  });

  it('takes the feature set from the environment when none is passed, in any order', () => {
    build(ARM, { VELOQRS_CARGO_FEATURES: 'lock-trace' });
    build([...ARM, '--features', 'lock-trace']);
    expect(calls('cargo')).toHaveLength(1);
    expect(existsSync(androidOut('release-arm64-v8a-lock-trace'))).toBe(true);
  });

  it('compiles again when a published library is deleted or altered', () => {
    const out = build(ARM);
    calls();

    rmSync(join(out, 'jniLibs/arm64-v8a/libveloqrs.so'));
    build(ARM);
    expect(calls('cargo')).toHaveLength(1);

    writeFileSync(join(out, 'jniLibs/arm64-v8a/libveloqrs.so'), 'an older library');
    build(ARM);
    expect(calls('cargo')).toHaveLength(1);
  });

  it('leaves no library to package when the compile fails after an earlier success', () => {
    const out = build(ARM);
    write(join(moduleDir, 'rust/veloqrs/src/lib.rs'), 'pub fn broken(\n');
    calls();

    expect(() => build(ARM, { FAKE_CARGO_FAIL: '1' })).toThrow(
      /cargo ndk .* exited with status 101/
    );
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(join(moduleDir, 'build/rust/android'))).toEqual([]);
  });

  it('refuses a library that is built for another ABI or exports no UniFFI symbols', () => {
    expect(() => build(ARM, { FAKE_WRONG_MACHINE: '1' })).toThrow(/ELF machine 999, not arm64-v8a/);
    expect(existsSync(androidOut('release-arm64-v8a'))).toBe(false);

    expect(() => build(ARM, { FAKE_NO_SYMBOLS: '1' })).toThrow(/exports no uniffi_veloqrs_/);
    expect(existsSync(androidOut('release-arm64-v8a'))).toBe(false);
  });

  it('compiles again when the NDK, the toolchain pin or compile flags change, and not for build-only settings', () => {
    build([...ARM, '--ndk', ndk('27.1.12297006')]);
    build([...ARM, '--ndk', ndk('27.1.12297006')], {
      CARGO_INCREMENTAL: '0',
      CARGO_PROFILE_DEV_DEBUG: '0',
    });
    expect(calls('cargo')).toHaveLength(1);

    build([...ARM, '--ndk', ndk('28.0.13004108')]);
    expect(calls('cargo')).toHaveLength(1);

    build([...ARM, '--ndk', ndk('28.0.13004108')], { RUSTFLAGS: '-C target-cpu=native' });
    expect(calls('cargo')).toHaveLength(1);

    build([...ARM, '--ndk', ndk('28.0.13004108')], { CARGO_PROFILE_RELEASE_LTO: 'false' });
    expect(calls('cargo')).toHaveLength(1);

    write(join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.96.0"\n');
    build([...ARM, '--ndk', ndk('28.0.13004108')]);
    expect(calls('cargo')).toHaveLength(1);
  });

  it('treats a compile setting left empty as unset, which is how a Gradle daemon unsets one', () => {
    build(ARM);
    calls();

    build(ARM, { CARGO_PROFILE_RELEASE_LTO: '', RUSTFLAGS: '' });
    expect(calls('cargo')).toEqual([]);

    rmSync(androidOut('release-arm64-v8a'), { recursive: true });
    build(ARM, { CARGO_PROFILE_RELEASE_LTO: '', FAKE_LOG_ENV: '1' });
    expect(calls().filter((line) => line.startsWith('env '))).toEqual([
      'env CC=undefined SDKROOT=undefined LTO=undefined',
    ]);
  });

  it('passes the NDK it fingerprinted to cargo-ndk', () => {
    const dir = ndk('27.1.12297006');
    write(
      join(root, 'bin/cargo'),
      FAKE_CARGO.replace(
        'const args =',
        "fs.appendFileSync(fakeLog, 'ndk-home ' + process.env.ANDROID_NDK_HOME + '\\n');\nconst args ="
      )
    );
    build([...ARM, '--ndk', dir]);
    expect(calls()).toContain(`ndk-home ${dir}`);
  });

  it('refuses an unknown ABI or profile before compiling', () => {
    expect(() => build(['android', '--abi', 'mips'])).toThrow(/unknown ABI mips/);
    expect(() => build([...ARM, '--profile', 'fast'])).toThrow(/unknown profile fast/);
    expect(calls('cargo')).toEqual([]);
  });
});

describe('the iOS build', () => {
  const BOTH = ['ios', '--slice', 'iphoneos:arm64', '--slice', 'iphonesimulator:arm64'];
  const SIM = ['ios', '--slice', 'iphonesimulator:arm64'];
  const SIM_PHASE = { PLATFORM_NAME: 'iphonesimulator', ARCHS: 'arm64' };
  const DEVICE_PHASE = { PLATFORM_NAME: 'iphoneos', ARCHS: 'arm64' };
  const archive = (selection: string) =>
    readFileSync(join(moduleDir, 'build/rust/ios', selection, 'libveloqrs_ffi.a'), 'latin1');
  const phase = (out: string) => ['ios', '--from-xcode', '--out', out];

  it('builds each SDK into its own output, then reuses both with no compile', () => {
    build(BOTH);

    expect(calls('cargo')).toEqual([
      expect.stringContaining('--target aarch64-apple-ios -p veloqrs'),
      expect.stringContaining('--target aarch64-apple-ios-sim -p veloqrs'),
    ]);
    expect(archive('release-iphoneos-arm64')).toContain('triple=aarch64-apple-ios ');
    expect(archive('release-iphonesimulator-arm64')).toContain('triple=aarch64-apple-ios-sim ');
    expect(readFileSync(join(moduleDir, 'ios/cpp/generated/veloqrs.cpp'), 'utf8')).toBe(
      '// bindings\n'
    );
    expect(readFileSync(join(moduleDir, 'ios/cpp/veloqrs.h'), 'utf8')).toBe('// header\n');

    const manifest = JSON.parse(
      readFileSync(join(moduleDir, 'build/rust/ios/release-iphoneos-arm64/manifest.json'), 'utf8')
    );
    expect(manifest.toolchain).toEqual({
      rustc: 'rustc 1.95.0 (fake)\nhost: x86_64-unknown-linux-gnu',
      xcode: 'Xcode 26.2\nBuild version 17C52',
      sdks: { iphoneos: '26.2' },
    });

    build(BOTH);
    expect(calls()).toEqual([]);
  });

  it('reports the resolved compiler, Xcode and each SDK in the build output', () => {
    const lines: string[] = [];
    main(BOTH, env, { moduleDir, log: (line: string) => lines.push(line) });
    const output = lines.join('\n');
    expect(output).toContain('rustc: rustc 1.95.0 (fake); host: x86_64-unknown-linux-gnu');
    expect(output).toContain('xcode: Xcode 26.2; Build version 17C52');
    expect(output).toContain('"iphoneos":"26.2"');
    expect(output).toContain('"iphonesimulator":"26.1"');
  });

  it('refuses to publish when Xcode cannot report its version', () => {
    expect(() => build(BOTH, { PATH: join(root, 'bin-without-xcode') })).toThrow();
    expect(existsSync(join(moduleDir, 'build/rust/ios/release-iphoneos-arm64'))).toBe(false);
  });

  it('judges a restored output current with no toolchain installed', () => {
    build(BOTH);
    calls();

    build(BOTH, { PATH: '/nonexistent' });

    expect(calls()).toEqual([]);
  });

  it('links the device archive in a device build that follows a simulator build', () => {
    const linked = join(root, 'Build/Products/Debug-iphoneos/Veloqrs');
    build(SIM);
    calls();

    build(phase(linked), DEVICE_PHASE);

    expect(calls('cargo')).toEqual([expect.stringContaining('--target aarch64-apple-ios -p')]);
    expect(readFileSync(join(linked, 'libveloqrs_ffi.a'), 'latin1')).toContain(
      'triple=aarch64-apple-ios '
    );
  });

  it('gives the simulator and device phases their own archives, and switching back compiles nothing', () => {
    const simulator = join(root, 'Build/Products/Debug-iphonesimulator/Veloqrs');
    const device = join(root, 'Build/Products/Debug-iphoneos/Veloqrs');
    build(phase(simulator), SIM_PHASE);
    build(phase(device), DEVICE_PHASE);
    calls();

    build(phase(simulator), SIM_PHASE);
    build(phase(device), DEVICE_PHASE);

    expect(calls('cargo')).toEqual([]);
    expect(readFileSync(join(simulator, 'libveloqrs_ffi.a'), 'latin1')).toContain(
      'triple=aarch64-apple-ios-sim '
    );
    expect(readFileSync(join(device, 'libveloqrs_ffi.a'), 'latin1')).toContain(
      'triple=aarch64-apple-ios '
    );
  });

  it('reuses a terminal build from an Xcode phase, whose environment carries every build setting', () => {
    const linked = join(root, 'Build/Products/Debug-iphonesimulator/Veloqrs');
    build(SIM);
    calls();

    build(phase(linked), {
      ...SIM_PHASE,
      CC: '/Xcode/usr/bin/clang',
      SDKROOT: '/Xcode/SDKs/iPhoneSimulator.sdk',
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
      CFLAGS: '-isysroot /Xcode/SDKs/iPhoneSimulator.sdk',
    });

    expect(calls('cargo')).toEqual([]);
    expect(existsSync(join(linked, 'libveloqrs_ffi.a'))).toBe(true);
  });

  it('hands Cargo none of the Xcode build settings from a phase', () => {
    build(phase(join(root, 'out')), {
      ...SIM_PHASE,
      CC: '/Xcode/usr/bin/clang',
      SDKROOT: '/Xcode/SDKs/iPhoneSimulator.sdk',
      FAKE_LOG_ENV: '1',
    });

    expect(calls().filter((line) => line.startsWith('env '))).toEqual([
      'env CC=undefined SDKROOT=undefined LTO=undefined',
    ]);
  });

  it('keeps the linked archive untouched when nothing changed, so Xcode does not relink', () => {
    const linked = join(root, 'Build/Products/Debug-iphonesimulator/Veloqrs');
    const file = join(linked, 'libveloqrs_ffi.a');
    build(phase(linked), SIM_PHASE);
    writeFileSync(join(root, 'marker'), '');
    const before = statSync(file).mtimeMs;
    const cpp = statSync(join(moduleDir, 'ios/cpp/generated/veloqrs.cpp')).mtimeMs;

    build(phase(linked), SIM_PHASE);

    expect(statSync(file).mtimeMs).toBe(before);
    expect(statSync(join(moduleDir, 'ios/cpp/generated/veloqrs.cpp')).mtimeMs).toBe(cpp);
  });

  it('leaves beside the linked archive the manifest of the selection it was copied from', () => {
    const linked = join(root, 'Build/Products/Debug-iphoneos/Veloqrs');
    build(phase(linked), DEVICE_PHASE);

    const record = JSON.parse(readFileSync(join(linked, 'libveloqrs_ffi.manifest.json'), 'utf8'));
    expect(record).toEqual(
      JSON.parse(
        readFileSync(join(moduleDir, 'build/rust/ios/release-iphoneos-arm64/manifest.json'), 'utf8')
      )
    );
    expect(record).toMatchObject({
      platform: 'ios',
      targets: ['iphoneos:arm64'],
      sources: hashRustInputs(join(moduleDir, 'rust')),
    });
    expect(record.files['libveloqrs_ffi.a']).toBe(
      createHash('sha256')
        .update(readFileSync(join(linked, 'libveloqrs_ffi.a')))
        .digest('hex')
    );

    write(join(moduleDir, 'rust/veloqrs/src/lib.rs'), 'pub fn changed() {}\n');
    build(phase(linked), DEVICE_PHASE);

    const rebuilt = JSON.parse(readFileSync(join(linked, 'libveloqrs_ffi.manifest.json'), 'utf8'));
    expect(rebuilt.sources).toBe(hashRustInputs(join(moduleDir, 'rust')));
    expect(rebuilt.sources).not.toBe(record.sources);
  });

  it('leaves nothing to link when the compile fails after an earlier success', () => {
    const linked = join(root, 'Build/Products/Debug-iphonesimulator/Veloqrs');
    build(phase(linked), SIM_PHASE);
    write(join(moduleDir, 'rust/veloqrs/src/lib.rs'), 'pub fn broken(\n');

    expect(() => build(phase(linked), { ...SIM_PHASE, FAKE_CARGO_FAIL: '1' })).toThrow(
      /exited with status 101/
    );
    expect(existsSync(join(linked, 'libveloqrs_ffi.a'))).toBe(false);
    expect(existsSync(join(linked, 'libveloqrs_ffi.manifest.json'))).toBe(false);
    expect(existsSync(join(moduleDir, 'build/rust/ios/release-iphonesimulator-arm64'))).toBe(false);
  });

  it('compiles only the SDK whose published library went missing', () => {
    build(BOTH);
    rmSync(join(moduleDir, 'build/rust/ios/release-iphoneos-arm64'), { recursive: true });
    calls();

    build(BOTH);
    expect(calls('cargo')).toEqual([expect.stringContaining('--target aarch64-apple-ios -p')]);
  });

  it('rebuilds every SDK after an Android build of a changed tree', () => {
    build(BOTH);
    write(join(moduleDir, 'rust/veloqrs/migrations/001_init.sql'), 'CREATE TABLE b (id);\n');
    build(['android', '--abi', 'arm64-v8a']);
    calls();

    build(SIM);
    expect(calls('cargo')).toEqual([expect.stringContaining('aarch64-apple-ios-sim')]);
  });

  it('joins the architectures a phase names with lipo, and refuses a platform it does not build', () => {
    build(phase(join(root, 'out')), { PLATFORM_NAME: 'iphonesimulator', ARCHS: 'arm64 x86_64' });

    expect(calls()).toEqual([
      expect.stringContaining('cargo build --release --target aarch64-apple-ios-sim'),
      expect.stringContaining('cargo build --release --target x86_64-apple-ios'),
      expect.stringMatching(/^lipo -create /),
    ]);
    expect(() =>
      build(['ios', '--from-xcode'], { PLATFORM_NAME: 'macosx', ARCHS: 'arm64' })
    ).toThrow(/PLATFORM_NAME is macosx/);
  });

  it('refuses to put two SDKs archives in one linked directory', () => {
    expect(() => build([...BOTH, '--out', join(root, 'out')])).toThrow(
      /--out takes one SDK's archive, not iphoneos and iphonesimulator/
    );
    expect(calls('cargo')).toEqual([]);
  });

  it('copies the C++ bridge for the pod with no compile, and drops a file the bindings no longer have', () => {
    write(join(moduleDir, 'ios/cpp/generated/removed.hpp'), '// old\n');

    build(['ios', '--sources-only']);

    expect(calls('cargo')).toEqual([]);
    expect(readFileSync(join(moduleDir, 'ios/cpp/generated/veloqrs.hpp'), 'utf8')).toBe(
      '// bindings header\n'
    );
    expect(existsSync(join(moduleDir, 'ios/cpp/generated/removed.hpp'))).toBe(false);
  });
});

describe('the environment of an Xcode phase', () => {
  it('puts Cargo s own bin directory on PATH, which Xcode started from the Dock lacks', () => {
    const { terminalEnvironment } = require(BUILDER) as {
      terminalEnvironment: (env: Record<string, string>) => Record<string, string>;
    };
    mkdirSync(join(root, '.cargo/bin'), { recursive: true });

    const result = terminalEnvironment({ PATH: '/usr/bin:/bin', HOME: root, SDKROOT: '/sdk' });

    expect(result.PATH).toBe(`${join(root, '.cargo/bin')}:/usr/bin:/bin`);
    expect(result.SDKROOT).toBeUndefined();
  });
});

describe('the command line', () => {
  function installBuilder() {
    const scripts = join(moduleDir, 'scripts');
    mkdirSync(scripts, { recursive: true });
    copyFileSync(BUILDER, join(scripts, 'build-rust.js'));
    copyFileSync(
      join(ROOT, 'modules/veloqrs/scripts/rust-inputs.js'),
      join(scripts, 'rust-inputs.js')
    );
    return join(scripts, 'build-rust.js');
  }

  function runPhase(builder: string, out: string) {
    return new Promise<number | null>((done) => {
      const child = spawn('node', [builder, 'ios', '--from-xcode', '--out', out], {
        env: { ...env, PLATFORM_NAME: 'iphonesimulator', ARCHS: 'arm64' },
        stdio: 'ignore',
      });
      child.on('exit', done);
    });
  }

  it('exits nonzero naming the failed compile', () => {
    const builder = installBuilder();

    const result = spawnSync('node', [builder, 'android', '--abi', 'arm64-v8a'], {
      env: { ...env, FAKE_CARGO_FAIL: '1' },
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[veloqrs\] cargo ndk .* exited with status 101/);
    expect(existsSync(androidOut('release-arm64-v8a'))).toBe(false);
  });

  it('compiles once when the pod and the extension phases ask for the same library at once', async () => {
    const builder = installBuilder();
    writeFileSync(join(root, 'fake-env.json'), JSON.stringify({ FAKE_CARGO_DELAY_MS: '1500' }));
    const pod = join(root, 'Build/Products/Debug-iphonesimulator/Veloqrs');
    const extension = join(root, 'Build/Intermediates/VeloqPushExtension.build/VeloqrsFFI');

    const codes = await Promise.all([runPhase(builder, pod), runPhase(builder, extension)]);

    expect(codes).toEqual([0, 0]);
    expect(calls('cargo')).toHaveLength(1);
    expect(readFileSync(join(pod, 'libveloqrs_ffi.a'), 'latin1')).toContain(
      'aarch64-apple-ios-sim'
    );
    expect(readFileSync(join(extension, 'libveloqrs_ffi.a'), 'latin1')).toContain(
      'aarch64-apple-ios-sim'
    );
  });

  it('takes over a lock its holder left when it died', async () => {
    const builder = installBuilder();
    const dead = spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))'], {
      encoding: 'utf8',
    });
    const lock = join(moduleDir, 'build/rust/ios/release-iphonesimulator-arm64.lock');
    write(join(lock, 'pid'), dead.stdout);

    const code = await runPhase(builder, join(root, 'out'));

    expect(code).toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(join(root, 'out/libveloqrs_ffi.a'))).toBe(true);
  });
});
