// The one Rust library build. Gradle's buildRustLibrary task, the Xcode
// build phases and CI all call it, so a selection means the same compile and the
// same validated output wherever it runs.
//
// A selection is a platform, its targets, a Cargo profile and a feature set,
// and each selection publishes to a directory of its own, so switching ABIs,
// profile or features never reuses or overwrites a library built for another.
// The output carries a manifest naming the fingerprint of every declared input
// (the Rust sources and embedded files, the toolchain pin, Cargo configuration,
// compile-affecting environment, the NDK revision and this builder) and a hash
// of each file, and the rustc and cargo-ndk versions that built it. When the
// manifest's fingerprint matches, Cargo is not called. Otherwise the
// old output is removed before compiling and the new one is published only
// once Cargo succeeded and every library validated, so a failed compile leaves
// nothing behind to package. A compile whose inputs changed while Cargo ran is
// refused too, and the manifest names the Rust sources hash it was built
// from, which is how the APK build record ties a packaged library to a tree.
//
// Usage:
//   node build-rust.js android --abi arm64-v8a [--abi x86_64] [--profile release]
//     [--features a,b] [--ndk DIR] [--api 24] [--out DIR]
//   node build-rust.js ios --slice iphoneos:arm64 --slice iphonesimulator:arm64
//     [--profile release] [--features a,b]
//   node build-rust.js ios --from-xcode --out DIR
//   node build-rust.js ios --sources-only
//
// On iOS each SDK's archive is built into its own selection directory. An
// Xcode build phase passes --from-xcode, which reads the SDK and architectures
// from PLATFORM_NAME and ARCHS, and --out, the directory its target links
// from, so a device build after a simulator build links the device archive
// rather than whatever was last assembled. The selection's manifest goes into
// that directory beside the archive. --sources-only copies the UniFFI
// C++ bridge into the pod and builds nothing, for `pod install`.
//
// Features default to VELOQRS_CARGO_FEATURES, so a one-off instrumented build
// needs no edit to Cargo.toml.

const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashRustInputs } = require('./rust-inputs');

const MODULE_DIR = path.resolve(__dirname, '..');
const LIBRARY = 'veloqrs';
const MANIFEST = 'manifest.json';
// The archive is renamed so CocoaPods does not auto-link `-lveloqrs`, which
// collides with the `-lVeloqrs` pod target on a case-insensitive filesystem.
const IOS_ARCHIVE = 'libveloqrs_ffi.a';
// The selection's manifest, copied beside the archive a phase links, so a
// record of the app can name the sources, profile and features of the library
// it linked and check the archive against the manifest's hash of it.
const IOS_LINKED_MANIFEST = 'libveloqrs_ffi.manifest.json';

const ANDROID_TRIPLES = {
  'arm64-v8a': 'aarch64-linux-android',
  'armeabi-v7a': 'armv7-linux-androideabi',
  x86_64: 'x86_64-linux-android',
  x86: 'i686-linux-android',
};
// ELF e_machine for each ABI, so a library for the wrong ABI is refused.
const ANDROID_MACHINES = { 'arm64-v8a': 183, 'armeabi-v7a': 40, x86_64: 62, x86: 3 };

const IOS_TRIPLES = {
  'iphoneos:arm64': 'aarch64-apple-ios',
  'iphonesimulator:arm64': 'aarch64-apple-ios-sim',
  'iphonesimulator:x86_64': 'x86_64-apple-ios',
};

const PROFILES = { release: { flag: ['--release'] }, debug: { flag: [] } };

class BuildError extends Error {}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function parseFeatures(text) {
  return sortedUnique(String(text ?? '').split(/[\s,]+/));
}

/** The directory name of a selection: profile, targets, then features. */
function selectionName({ profile, targets, features }) {
  const parts = [profile, targets.map((t) => t.replace(/[^A-Za-z0-9_-]/g, '-')).join('_')];
  if (features.length) parts.push(features.join('_'));
  return parts.join('-');
}

/** The nearest rust-toolchain file at or above the Rust tree, read as text. */
function toolchainPin(rustDir) {
  for (let dir = rustDir; ; dir = path.dirname(dir)) {
    for (const name of ['rust-toolchain.toml', 'rust-toolchain']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    }
    if (path.dirname(dir) === dir) return '';
  }
}

/**
 * Cargo configuration Cargo reads for a build in the Rust tree that lies
 * outside it: every ancestor's `.cargo/config.toml` and the one in CARGO_HOME.
 * The tree's own are already inputs of the source hash.
 */
function cargoConfigOutside(rustDir, env) {
  const files = [];
  for (let dir = path.dirname(rustDir); ; dir = path.dirname(dir)) {
    for (const name of ['config.toml', 'config']) files.push(path.join(dir, '.cargo', name));
    if (path.dirname(dir) === dir) break;
  }
  const cargoHome = env.CARGO_HOME || path.join(os.homedir(), '.cargo');
  for (const name of ['config.toml', 'config']) files.push(path.join(cargoHome, name));
  return [...new Set(files)]
    .filter((file) => fs.existsSync(file))
    .map((file) => `${file}\0${sha256(fs.readFileSync(file))}`);
}

/**
 * The environment that changes what the compiler emits for this selection:
 * rustc and C flags (the bundled SQLite is C), the selected profile's
 * overrides and the selected targets' settings. Variables that change only
 * how a build runs (incremental, job count, colour) are left out, so a CI run
 * restoring a cached library agrees with the run that built it.
 */
function compileEnvironment(env, { profile, triples }) {
  const profileKey = `CARGO_PROFILE_${profile === 'debug' ? 'DEV' : profile.toUpperCase()}_`;
  const tripleKeys = triples.map((t) => t.toUpperCase().replace(/-/g, '_'));
  const exact = new Set([
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'CARGO_BUILD_RUSTFLAGS',
    'RUSTC',
    'CC',
    'CXX',
    'AR',
    'CFLAGS',
    'CXXFLAGS',
    'TARGET_CC',
    'TARGET_CFLAGS',
    'TARGET_CXXFLAGS',
    'LIBSQLITE3_FLAGS',
    'IPHONEOS_DEPLOYMENT_TARGET',
  ]);
  const relevant = (name) =>
    exact.has(name) ||
    name.startsWith(profileKey) ||
    tripleKeys.some(
      (t) =>
        name.startsWith(`CARGO_TARGET_${t}_`) ||
        (/^(CC|CXX|AR|CFLAGS|CXXFLAGS)_/.test(name) &&
          name.slice(name.indexOf('_') + 1).replace(/-/g, '_').toUpperCase() === t)
    );
  return Object.keys(env)
    .filter(relevant)
    .sort()
    .map((name) => `${name}=${env[name]}`);
}

/**
 * The environment with every compile setting that is set but empty removed.
 * A Gradle daemon unsets a variable a previous build had by leaving it empty,
 * and Cargo reads an empty profile or target setting as a value and fails, so
 * an empty one means what an unset one means, to Cargo and to the fingerprint.
 */
function withoutEmptyCompileSettings(env) {
  const compileSetting = (name) =>
    /^CARGO_(PROFILE|TARGET)_/.test(name) ||
    /^(RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|RUSTC|LIBSQLITE3_FLAGS|IPHONEOS_DEPLOYMENT_TARGET)$/.test(name) ||
    /^(CC|CXX|AR|CFLAGS|CXXFLAGS|TARGET_CC|TARGET_CFLAGS|TARGET_CXXFLAGS)(_.*)?$/.test(name);
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => value !== '' || !compileSetting(name))
  );
}

/** The NDK's own revision, from the source.properties every NDK carries. */
function ndkRevision(ndkDir) {
  if (!ndkDir) return '';
  const file = path.join(ndkDir, 'source.properties');
  if (!fs.existsSync(file)) throw new BuildError(`${ndkDir} is not an NDK: no source.properties`);
  const match = /^Pkg\.Revision\s*=\s*(\S+)/m.exec(fs.readFileSync(file, 'utf8'));
  if (!match) throw new BuildError(`${file} names no Pkg.Revision`);
  return match[1];
}

/** One hash over every input the selection's library is compiled from. */
function fingerprint(selection, context) {
  const parts = [
    'veloqrs-native-build-v1',
    `builder=${sha256(fs.readFileSync(__filename))}`,
    `inputs-script=${sha256(fs.readFileSync(path.join(__dirname, 'rust-inputs.js')))}`,
    `sources=${hashRustInputs(context.rustDir)}`,
    `toolchain=${sha256(toolchainPin(context.rustDir))}`,
    ...cargoConfigOutside(context.rustDir, context.env).map((c) => `cargo-config=${c}`),
    `platform=${selection.platform}`,
    `targets=${selection.targets.join(',')}`,
    `triples=${selection.triples.join(',')}`,
    `profile=${selection.profile}`,
    `features=${selection.features.join(',')}`,
    `api=${selection.api ?? ''}`,
    `ndk=${ndkRevision(selection.ndk)}`,
    ...compileEnvironment(context.env, selection).map((e) => `env=${e}`),
  ];
  return sha256(parts.join('\n'));
}

/**
 * Refuse a compile whose inputs moved while Cargo ran: its output belongs to
 * no single state of the tree, so it is not published under either.
 */
function requireUnchanged(selection, context, print) {
  if (fingerprint(selection, context) !== print) {
    throw new BuildError('the Rust build inputs changed while Cargo ran; build again');
  }
}

function listFiles(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(full, base);
      return entry.name === MANIFEST ? [] : [path.relative(base, full).split(path.sep).join('/')];
    })
    .sort();
}

function writeManifest(dir, fields) {
  const files = Object.fromEntries(
    listFiles(dir).map((rel) => [rel, sha256(fs.readFileSync(path.join(dir, rel)))])
  );
  fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify({ ...fields, files }, null, 2)}\n`);
}

/** Whether `dir` holds a complete output for `print`, every file unchanged. */
function isCurrent(dir, print) {
  const file = path.join(dir, MANIFEST);
  if (!fs.existsSync(file)) return false;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (manifest.fingerprint !== print || !manifest.files || !manifest.sources) return false;
  const expected = Object.keys(manifest.files).sort();
  if (expected.length === 0 || listFiles(dir).join('\n') !== expected.join('\n')) return false;
  return expected.every((rel) => sha256(fs.readFileSync(path.join(dir, rel))) === manifest.files[rel]);
}

/** A sibling scratch directory that is renamed over `dir` once complete. */
function stagingFor(dir) {
  const staging = `${dir}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  return staging;
}

function publish(staging, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(staging, dir);
}

/** Whether a process with this id is still running. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `fn` holding a lock on one output directory. Xcode builds the app's
 * pod and the push extension in parallel, and both ask for the same library:
 * the second waits for the first, then finds the output current. A lock left
 * by a process that died is taken over.
 */
function exclusive(dir, fn, context) {
  const lock = `${dir}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let waited = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let owner = NaN;
    try {
      owner = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
    } catch {
      // Between the owner's mkdir and its pid write.
    }
    if (Number.isInteger(owner) && owner > 0 && !alive(owner)) {
      fs.rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (!waited) context.log(`[veloqrs] Waiting for another build of ${path.basename(dir)}`);
    waited = true;
    pause(200);
  }
  try {
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// What a terminal build hands Cargo. An Xcode script phase runs with every
// build setting of its target exported, CC and SDKROOT among them, which
// would compile the host's build scripts against the iOS SDK and give the
// selection another fingerprint than the same build run from a terminal.
const TERMINAL_ENVIRONMENT = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'DEVELOPER_DIR',
  'VELOQRS_CARGO_FEATURES',
  'RUSTC_WRAPPER',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
]);

/**
 * The environment of an Xcode build phase, cut back to what a terminal build
 * sees, with Cargo's own bin directory on PATH, since an Xcode started from
 * the Dock has never read the shell profile that puts it there.
 */
function terminalEnvironment(env) {
  const kept = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        TERMINAL_ENVIRONMENT.has(name) ||
        /^(CARGO|RUSTUP|SCCACHE)_/.test(name) ||
        /^RUST(C|FLAGS|DOCFLAGS)?$/.test(name) ||
        /^(https?|no|all)_proxy$/i.test(name)
    )
  );
  const cargoBin = path.join(env.CARGO_HOME || path.join(env.HOME || os.homedir(), '.cargo'), 'bin');
  const entries = String(kept.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (fs.existsSync(cargoBin) && !entries.includes(cargoBin)) entries.unshift(cargoBin);
  kept.PATH = entries.join(path.delimiter);
  return kept;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    throw new BuildError(`${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const how = result.signal ? `signal ${result.signal}` : `status ${result.status}`;
    throw new BuildError(`${command} ${args.join(' ')} exited with ${how}`);
  }
  return result;
}

/**
 * The compiler that built an output, recorded in its manifest and kept out of
 * the fingerprint: the toolchain pin already decides it, and a restored cache
 * has to be judged current on a machine with no toolchain installed.
 */
function toolchainRecord(selection, context) {
  const query = (command, args) =>
    run(command, args, {
      cwd: context.rustDir,
      env: context.env,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    }).stdout.trim();
  const record = { rustc: query('rustc', ['-vV']) };
  if (selection.platform === 'android') {
    record.cargoNdk = query('cargo', ['ndk', '--version']);
  } else {
    record.xcode = query('xcodebuild', ['-version']);
    const sdks = sortedUnique(selection.targets.map((slice) => slice.split(':')[0]));
    record.sdks = Object.fromEntries(
      sdks.map((sdk) => [sdk, query('xcrun', ['--sdk', sdk, '--show-sdk-version'])])
    );
  }
  for (const [name, value] of Object.entries(record)) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    context.log(`[veloqrs] ${name}: ${text.replace(/\n/g, '; ')}`);
  }
  return record;
}

const UNIFFI_MARKER = Buffer.from(`uniffi_${LIBRARY}_`);

function validateAndroidLibrary(file, abi) {
  if (!fs.existsSync(file)) throw new BuildError(`Cargo reported success but wrote no ${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length < 20 || bytes.toString('latin1', 0, 4) !== '\x7fELF') {
    throw new BuildError(`${file} is not an ELF library`);
  }
  const machine = bytes[5] === 2 ? bytes.readUInt16BE(18) : bytes.readUInt16LE(18);
  if (machine !== ANDROID_MACHINES[abi]) {
    throw new BuildError(`${file} is built for ELF machine ${machine}, not ${abi}`);
  }
  if (!bytes.includes(UNIFFI_MARKER)) {
    throw new BuildError(`${file} exports no ${UNIFFI_MARKER} symbols`);
  }
}

function validateArchive(file) {
  if (!fs.existsSync(file)) throw new BuildError(`Cargo reported success but wrote no ${file}`);
  const bytes = fs.readFileSync(file);
  const archive = bytes.toString('latin1', 0, 8) === '!<arch>\n';
  const fat = bytes.length >= 4 && bytes.readUInt32BE(0) === 0xcafebabe;
  if (!archive && !fat) throw new BuildError(`${file} is not a static library`);
  if (!bytes.includes(UNIFFI_MARKER)) {
    throw new BuildError(`${file} exports no ${UNIFFI_MARKER} symbols`);
  }
}

function featureArgs(features) {
  return features.length ? ['--features', features.join(',')] : [];
}

function buildAndroid(options, context) {
  const abis = sortedUnique(options.abis);
  if (abis.length === 0) throw new BuildError('android needs at least one --abi');
  for (const abi of abis) {
    if (!ANDROID_TRIPLES[abi]) {
      throw new BuildError(`unknown ABI ${abi}: one of ${Object.keys(ANDROID_TRIPLES).join(', ')}`);
    }
  }
  const selection = {
    platform: 'android',
    targets: abis,
    triples: abis.map((abi) => ANDROID_TRIPLES[abi]),
    profile: options.profile,
    features: options.features,
    api: options.api,
    ndk: options.ndk,
  };
  const out =
    options.out ?? path.join(context.buildRoot, 'android', selectionName(selection));
  return exclusive(out, () => buildAndroidSelection(selection, out, options, context), context);
}

function buildAndroidSelection(selection, out, options, context) {
  const abis = selection.targets;
  const sources = hashRustInputs(context.rustDir);
  const print = fingerprint(selection, context);
  if (isCurrent(out, print)) {
    context.log(`[veloqrs] Rust library current for ${selectionName(selection)}`);
    return out;
  }
  // Removed before compiling, so a failure leaves no library to package.
  fs.rmSync(out, { recursive: true, force: true });
  context.log(`[veloqrs] Building Rust for android ${selectionName(selection)}`);
  const staging = stagingFor(out);
  try {
    const env = { ...context.env };
    if (options.ndk) env.ANDROID_NDK_HOME = options.ndk;
    const jniLibs = path.join(staging, 'jniLibs');
    run(
      'cargo',
      [
        'ndk',
        ...abis.flatMap((abi) => ['-t', abi]),
        '--platform',
        String(options.api),
        '-o',
        jniLibs,
        'build',
        ...PROFILES[options.profile].flag,
        '-p',
        LIBRARY,
        ...featureArgs(options.features),
      ],
      { cwd: context.rustDir, env }
    );
    const built = fs.existsSync(jniLibs) ? fs.readdirSync(jniLibs).sort() : [];
    const extra = built.filter((abi) => !abis.includes(abi));
    if (extra.length) throw new BuildError(`Cargo wrote unrequested ABIs: ${extra.join(', ')}`);
    for (const abi of abis) validateAndroidLibrary(path.join(jniLibs, abi, `lib${LIBRARY}.so`), abi);
    requireUnchanged(selection, context, print);
    writeManifest(staging, {
      fingerprint: print,
      sources,
      ...selection,
      toolchain: toolchainRecord(selection, context),
    });
    publish(staging, out);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  context.log(`[veloqrs] Published ${out}`);
  return out;
}

/** The library Cargo reports for `triple`, read from its JSON messages. */
function cargoStaticLibrary(stdout, triple) {
  const libraries = stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.reason === 'compiler-artifact' && m.target?.name === LIBRARY)
    .flatMap((m) => m.filenames ?? [])
    .filter((file) => file.endsWith(`lib${LIBRARY}.a`));
  if (libraries.length !== 1) {
    throw new BuildError(
      `Cargo reported ${libraries.length} static libraries for ${triple}: ${libraries.join(', ') || 'none'}`
    );
  }
  return libraries[0];
}

function iosSelection(slices, options) {
  return {
    platform: 'ios',
    targets: slices,
    triples: slices.map((slice) => IOS_TRIPLES[slice]),
    profile: options.profile,
    features: options.features,
  };
}

/** Build one SDK's static library, lipo'd across its architectures. */
function buildIosSdk(selection, options, context) {
  const out = path.join(context.buildRoot, 'ios', selectionName(selection));
  return exclusive(out, () => buildIosSelection(selection, out, options, context), context);
}

function buildIosSelection(selection, out, options, context) {
  const slices = selection.targets;
  const print = fingerprint(selection, context);
  if (isCurrent(out, print)) {
    context.log(`[veloqrs] Rust library current for ${slices.join(' ')}`);
    return out;
  }
  fs.rmSync(out, { recursive: true, force: true });
  context.log(`[veloqrs] Building Rust for ${slices.join(' ')}`);
  const staging = stagingFor(out);
  try {
    const archives = selection.triples.map((triple) => {
      const result = run(
        'cargo',
        [
          'build',
          ...PROFILES[options.profile].flag,
          '--target',
          triple,
          '-p',
          LIBRARY,
          ...featureArgs(options.features),
          '--message-format=json-render-diagnostics',
        ],
        { cwd: context.rustDir, env: context.env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 28 }
      );
      const archive = cargoStaticLibrary(result.stdout, triple);
      validateArchive(archive);
      return archive;
    });
    const target = path.join(staging, IOS_ARCHIVE);
    if (archives.length === 1) fs.copyFileSync(archives[0], target);
    else run('lipo', ['-create', ...archives, '-output', target], { env: context.env });
    validateArchive(target);
    requireUnchanged(selection, context, print);
    const sources = hashRustInputs(context.rustDir);
    writeManifest(staging, {
      fingerprint: print,
      sources,
      ...selection,
      toolchain: toolchainRecord(selection, context),
    });
    publish(staging, out);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  context.log(`[veloqrs] Published ${out}`);
  return out;
}

/**
 * Writes `contents` to `file` unless it already holds them, so a file Xcode
 * compiles or links keeps its timestamp, and with it the incremental build.
 */
function writeIfChanged(file, contents) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(contents)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  fs.writeFileSync(partial, contents);
  fs.renameSync(partial, file);
}

/**
 * The UniFFI C++ sources the pod compiles, copied beside the podspec, which
 * can only name files under its own directory.
 */
function syncIosCpp(moduleDir) {
  const target = path.join(moduleDir, 'ios', 'cpp');
  const wanted = new Map();
  for (const name of ['veloqrs.h', 'veloqrs.cpp']) {
    wanted.set(name, path.join(moduleDir, 'cpp', name));
  }
  const generated = path.join(moduleDir, 'cpp', 'generated');
  for (const name of fs.readdirSync(generated)) {
    const from = path.join(generated, name);
    if (fs.statSync(from).isFile()) wanted.set(`generated/${name}`, from);
  }
  if (fs.existsSync(target)) {
    for (const rel of listFiles(target)) {
      if (!wanted.has(rel)) fs.rmSync(path.join(target, rel));
    }
  }
  for (const [rel, from] of wanted) writeIfChanged(path.join(target, rel), fs.readFileSync(from));
  return target;
}

function buildIos(options, context) {
  const sources = syncIosCpp(context.moduleDir);
  if (options.sourcesOnly) return sources;
  const slices = sortedUnique(options.slices);
  if (slices.length === 0) throw new BuildError('ios needs at least one --slice SDK:ARCH');
  for (const slice of slices) {
    if (!IOS_TRIPLES[slice]) {
      throw new BuildError(`unknown slice ${slice}: one of ${Object.keys(IOS_TRIPLES).join(', ')}`);
    }
  }
  const bySdk = new Map();
  for (const slice of slices) {
    const sdk = slice.split(':')[0];
    bySdk.set(sdk, [...(bySdk.get(sdk) ?? []), slice]);
  }
  const sdks = [...bySdk.keys()].sort();
  if (options.out && sdks.length !== 1) {
    throw new BuildError(`--out takes one SDK's archive, not ${sdks.join(' and ')}`);
  }
  if (!options.out) {
    return sdks.map((sdk) => buildIosSdk(iosSelection(bySdk.get(sdk), options), options, context));
  }
  const installed = path.join(options.out, IOS_ARCHIVE);
  const installedManifest = path.join(options.out, IOS_LINKED_MANIFEST);
  try {
    const built = buildIosSdk(iosSelection(bySdk.get(sdks[0]), options), options, context);
    writeIfChanged(installed, fs.readFileSync(path.join(built, IOS_ARCHIVE)));
    writeIfChanged(installedManifest, fs.readFileSync(path.join(built, MANIFEST)));
  } catch (error) {
    // A failed build leaves nothing in the linked directory to link.
    fs.rmSync(installed, { force: true });
    fs.rmSync(installedManifest, { force: true });
    throw error;
  }
  context.log(`[veloqrs] ${IOS_ARCHIVE} for ${slices.join(' ')} in ${options.out}`);
  return installed;
}

/** The slices an Xcode build phase asks for, from its own environment. */
function slicesFromXcode(env) {
  const sdk = env.PLATFORM_NAME;
  if (sdk !== 'iphoneos' && sdk !== 'iphonesimulator') {
    throw new BuildError(`PLATFORM_NAME is ${sdk || 'unset'}, not iphoneos or iphonesimulator`);
  }
  const archs = String(env.ARCHS ?? '').split(/\s+/).filter(Boolean);
  if (archs.length === 0) throw new BuildError('ARCHS is unset');
  return archs.map((arch) => `${sdk}:${arch}`);
}

function parseArgs(argv, env) {
  const [platform, ...rest] = argv;
  const options = {
    platform,
    abis: [],
    slices: [],
    profile: 'release',
    features: parseFeatures(env.VELOQRS_CARGO_FEATURES),
    api: 24,
  };
  const value = (i, flag) => {
    if (i >= rest.length) throw new BuildError(`${flag} needs a value`);
    return rest[i];
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--abi') options.abis.push(...value(++i, flag).split(','));
    else if (flag === '--slice') options.slices.push(...value(++i, flag).split(','));
    else if (flag === '--profile') options.profile = value(++i, flag);
    else if (flag === '--features') options.features = parseFeatures(value(++i, flag));
    else if (flag === '--ndk') options.ndk = value(++i, flag);
    else if (flag === '--api') options.api = Number(value(++i, flag));
    else if (flag === '--out') options.out = path.resolve(value(++i, flag));
    else if (flag === '--from-xcode') {
      options.slices.push(...slicesFromXcode(env));
      options.fromXcode = true;
    } else if (flag === '--sources-only') options.sourcesOnly = true;
    else throw new BuildError(`unknown argument ${flag}`);
  }
  if (!PROFILES[options.profile]) {
    throw new BuildError(`unknown profile ${options.profile}: one of ${Object.keys(PROFILES).join(', ')}`);
  }
  if (!Number.isInteger(options.api) || options.api <= 0) {
    throw new BuildError('--api needs a positive API level');
  }
  return options;
}

function main(argv, env = process.env, overrides = {}) {
  const options = parseArgs(argv, env);
  const moduleDir = overrides.moduleDir ?? MODULE_DIR;
  const context = {
    env: withoutEmptyCompileSettings(options.fromXcode ? terminalEnvironment(env) : env),
    moduleDir,
    rustDir: overrides.rustDir ?? path.join(moduleDir, 'rust'),
    buildRoot: overrides.buildRoot ?? path.join(moduleDir, 'build', 'rust'),
    log: overrides.log ?? ((line) => console.log(line)),
  };
  if (options.platform === 'android') return buildAndroid(options, context);
  if (options.platform === 'ios') return buildIos(options, context);
  throw new BuildError('usage: build-rust.js android|ios [options]');
}

module.exports = {
  main,
  fingerprint,
  selectionName,
  compileEnvironment,
  terminalEnvironment,
  BuildError,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[veloqrs] ${error instanceof BuildError ? error.message : error.stack}`);
    process.exit(1);
  }
}
