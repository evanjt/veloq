/**
 * A checkout and the APK an Android build packages from it, for the suites
 * that judge an APK by its build record: the bundle and its record, the Rust
 * selection the builder publishes, and an APK holding a compiled manifest and
 * stripped libraries, as Gradle writes them.
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { gitFreeEnv, initFixtureRepo, runGit } from './gitFixture';

const record = require('../../../scripts/lib/build-record.js');
const { sourceIdentity, buildStamp } = require('../../../scripts/lib/build-stamp.js');
const { hashRustInputs } = require('../../../modules/veloqrs/scripts/rust-inputs.js');

export const APK = 'android/app/build/outputs/apk/debug/app-debug.apk';
export const RELEASE_APK = 'android/app/build/outputs/apk/release/app-release.apk';
const MACHINES: Record<string, number> = { 'arm64-v8a': 183, x86_64: 62 };

export function write(root: string, file: string, contents: string | Buffer) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), contents);
}

export function sha256(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * A 64-bit little-endian shared object with one loadable segment holding
 * `code`, followed by a symbol table and section headers that a strip removes.
 * The stripped form keeps the segment and rewrites the section header fields.
 */
export function elf(abi: string, code: string, stripped = false): Buffer {
  const body = Buffer.from(`uniffi_veloqrs_fn_init ${code}`);
  const header = Buffer.alloc(64 + 56);
  header.write('\x7fELF', 0, 'latin1');
  header[4] = 2;
  header[5] = 1;
  header.writeUInt16LE(MACHINES[abi], 18);
  header.writeBigUInt64LE(64n, 32);
  header.writeUInt16LE(56, 54);
  header.writeUInt16LE(1, 56);
  const loadable = header.length + body.length;
  const symbols = Buffer.from(stripped ? '' : '.symtab veloqrs::engine::init .strtab');
  header.writeBigUInt64LE(BigInt(loadable + symbols.length), 40);
  header.writeUInt16LE(64, 58);
  header.writeUInt16LE(stripped ? 2 : 5, 60);
  header.writeUInt16LE(stripped ? 1 : 4, 62);
  header.writeUInt32LE(1, 64);
  header.writeUInt32LE(5, 68);
  header.writeBigUInt64LE(0n, 72);
  header.writeBigUInt64LE(0n, 80);
  header.writeBigUInt64LE(BigInt(loadable), 96);
  header.writeBigUInt64LE(BigInt(loadable), 104);
  const sections = Buffer.alloc((stripped ? 2 : 5) * 64, stripped ? 1 : 2);
  return Buffer.concat([header, body, symbols, sections]);
}

/**
 * A compiled manifest: a UTF-8 string pool, then the `manifest` element with
 * its `package` attribute naming `id`, the shape aapt2 writes.
 */
export function compiledManifest(id: string): Buffer {
  const strings = ['versionCode', 'package', 'manifest', id, 'android'];
  const encoded = strings.map((s) => {
    const bytes = Buffer.from(s, 'utf8');
    return Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
  });
  let data = Buffer.concat(encoded);
  data = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const offsets = Buffer.alloc(strings.length * 4);
  let at = 0;
  encoded.forEach((e, i) => {
    offsets.writeUInt32LE(at, i * 4);
    at += e.length;
  });
  const poolHeader = Buffer.alloc(28);
  poolHeader.writeUInt16LE(0x0001, 0);
  poolHeader.writeUInt16LE(28, 2);
  poolHeader.writeUInt32LE(28 + offsets.length + data.length, 4);
  poolHeader.writeUInt32LE(strings.length, 8);
  poolHeader.writeUInt32LE(0x100, 16);
  poolHeader.writeUInt32LE(28 + offsets.length, 20);
  const pool = Buffer.concat([poolHeader, offsets, data]);

  const attribute = (name: number, value: number) => {
    const a = Buffer.alloc(20);
    a.writeInt32LE(-1, 0);
    a.writeUInt32LE(name, 4);
    a.writeUInt32LE(value, 8);
    a.writeUInt16LE(8, 12);
    a[15] = 0x03;
    a.writeUInt32LE(value, 16);
    return a;
  };
  const attributes = [attribute(0, 4), attribute(1, 3)];
  const element = Buffer.alloc(36);
  element.writeUInt16LE(0x0102, 0);
  element.writeUInt16LE(16, 2);
  element.writeUInt32LE(36 + attributes.length * 20, 4);
  element.writeInt32LE(-1, 12);
  element.writeInt32LE(-1, 16);
  element.writeUInt32LE(2, 20);
  element.writeUInt16LE(20, 24);
  element.writeUInt16LE(20, 26);
  element.writeUInt16LE(attributes.length, 28);
  const start = Buffer.concat([element, ...attributes]);

  const file = Buffer.alloc(8);
  file.writeUInt16LE(0x0003, 0);
  file.writeUInt16LE(8, 2);
  file.writeUInt32LE(8 + pool.length + start.length, 4);
  return Buffer.concat([file, pool, start]);
}

const REPO = path.resolve(__dirname, '../../..');

/**
 * A checkout with JavaScript, a Rust tree and a submodule, all committed,
 * holding a copy of each repository file in `copy`.
 */
export function checkout(copy: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-record-'));
  for (const file of copy) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(root, file));
  }
  write(
    root,
    '.gitignore',
    'android/\nmodules/veloqrs/build/\nmodules/veloqrs/ios/Frameworks/\nbin/\nadb.log\n'
  );
  write(root, 'src/app.ts', 'export const greeting = "hello";\n');
  write(root, 'modules/veloqrs/rust/Cargo.toml', '[workspace]\nmembers = ["veloqrs"]\n');
  write(root, 'modules/veloqrs/rust/veloqrs/src/lib.rs', 'pub fn init() {}\n');
  initFixtureRepo(root);
  const sub = path.join(root, 'modules/veloqrs/rust/matcher');
  write(sub, 'src/lib.rs', 'pub fn matches() -> bool { true }\n');
  initFixtureRepo(sub);
  runGit(['commit', '-qm', 'matcher'], sub);
  const head = runGit(['rev-parse', 'HEAD'], sub).trim();
  runGit(
    ['update-index', '--add', '--cacheinfo', `160000,${head},modules/veloqrs/rust/matcher`],
    root
  );
  runGit(['commit', '-qm', 'fixture'], root);
  return root;
}

export interface BuildOptions {
  abis?: string[];
  features?: string[];
  profile?: string;
  applicationId?: string;
  rustCode?: string;
  bundle?: string;
  packagedBundle?: string;
  packagedRust?: string;
  /** Gradle bundles the JavaScript itself, so no bundle record is written. */
  gradleBundle?: boolean;
}

/**
 * What `npm run android:debug` leaves behind: the embedded bundle and its
 * record, the Rust selection the builder published, and the APK Gradle
 * packaged from them, with every library stripped as the packager strips it.
 */
export function build(root: string, options: BuildOptions = {}) {
  const abis = options.abis ?? ['arm64-v8a'];
  const features = options.features ?? [];
  const profile = options.profile ?? 'release';
  const rustCode = options.rustCode ?? 'engine';
  const bundle = options.bundle ?? 'var app = "hello";';

  if (!options.gradleBundle) {
    const before = sourceIdentity(root);
    write(root, record.BUNDLE, bundle);
    record.recordBundle(root, before);
  }

  const name = [profile, abis.join('_'), ...(features.length ? [features.join('_')] : [])].join(
    '-'
  );
  const selection = path.join(root, 'modules/veloqrs/build/rust/android', name);
  const files: Record<string, string> = {};
  for (const abi of abis) {
    const rel = `jniLibs/${abi}/libveloqrs.so`;
    const bytes = elf(abi, rustCode);
    write(selection, rel, bytes);
    files[rel] = sha256(bytes);
  }
  write(
    selection,
    'manifest.json',
    JSON.stringify({
      fingerprint: 'f'.repeat(64),
      sources: hashRustInputs(path.join(root, 'modules/veloqrs/rust')),
      platform: 'android',
      targets: abis,
      profile,
      features,
      files,
    })
  );

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-apk-'));
  write(
    staging,
    'AndroidManifest.xml',
    compiledManifest(options.applicationId ?? 'com.veloq.app.dev')
  );
  write(staging, 'assets/app.config', JSON.stringify({ extra: { buildCommit: buildStamp(root) } }));
  write(staging, 'assets/index.android.bundle', options.packagedBundle ?? bundle);
  for (const abi of abis) {
    write(staging, `lib/${abi}/libveloqrs.so`, elf(abi, options.packagedRust ?? rustCode, true));
    write(staging, `lib/${abi}/libveloqrs_jni.so`, elf(abi, 'bridge', true));
  }
  const target = path.join(root, options.gradleBundle ? RELEASE_APK : APK);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  const zipped = spawnSync('zip', ['-q', '-r', target, '.'], { cwd: staging, env: gitFreeEnv() });
  expect(zipped.status).toBe(0);
  return target;
}
