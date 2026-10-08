// The identities an Android or iOS artifact carries, read out of the file: the
// one its native metadata declares, the one its embedded Expo configuration
// names, and each extension's. `identityProblems` in `build-record.js` judges
// them, and the build records refuse an artifact it finds fault with.
// `selectedIdentityProblems` judges them against the identity a build was
// asked for, which is what CI checks on every artifact it builds or restores.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BuildRecordError, apkFacts, apkIdentity } = require('./build-record.js');
const { appFacts, appIdentity } = require('./build-record-ios.js');

const AAB_MANIFEST = 'base/manifest/AndroidManifest.xml';
const AAB_CONFIG = 'base/assets/app.config';

/** The fields of one protocol buffer message, in order, as `[number, value]`. */
function protoFields(bytes) {
  const fields = [];
  let at = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (at >= bytes.length) throw new BuildRecordError('the bundle manifest is truncated');
      const byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
    }
  };
  while (at < bytes.length) {
    const key = varint();
    const wire = key % 8;
    const number = Math.floor(key / 8);
    if (wire === 0) fields.push([number, varint()]);
    else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else if (wire === 2) {
      const length = varint();
      fields.push([number, bytes.subarray(at, at + length)]);
      at += length;
    } else throw new BuildRecordError(`the bundle manifest has wire type ${wire}`);
  }
  return fields;
}

/**
 * The `package` of an App Bundle's manifest, which aapt2 writes as a
 * protocol buffer `XmlNode` rather than the binary XML an APK carries: the
 * root element (field 1) named `manifest` (3), and among its attributes (4) the
 * one named `package` (2) in no namespace (1), whose value is field 3.
 */
function bundleManifestPackage(bytes) {
  const element = protoFields(bytes).find(([n]) => n === 1)?.[1];
  if (!Buffer.isBuffer(element)) throw new BuildRecordError('the bundle manifest has no element');
  const fields = protoFields(element);
  const text = (list, n) => {
    const value = list.find(([f]) => f === n)?.[1];
    return Buffer.isBuffer(value) ? value.toString('utf8') : '';
  };
  if (text(fields, 3) !== 'manifest') {
    throw new BuildRecordError(`the bundle manifest's root is ${text(fields, 3) || 'unnamed'}`);
  }
  for (const [n, value] of fields) {
    if (n !== 4 || !Buffer.isBuffer(value)) continue;
    const attribute = protoFields(value);
    if (text(attribute, 2) === 'package' && !text(attribute, 1)) return text(attribute, 3) || null;
  }
  return null;
}

/** An App Bundle's base module, read as `apkIdentity` reads an APK. */
function bundleIdentity(aab) {
  if (!fs.existsSync(aab)) throw new BuildRecordError(`no App Bundle at ${aab}`);
  const read = (entry) => {
    try {
      return execFileSync('unzip', ['-p', aab, entry], {
        maxBuffer: 1 << 30,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  };
  const manifest = read(AAB_MANIFEST);
  if (!manifest) throw new BuildRecordError(`${aab} has no ${AAB_MANIFEST}`);
  let config = null;
  try {
    config = JSON.parse(read(AAB_CONFIG)?.toString('utf8') ?? '');
  } catch {
    config = null;
  }
  return {
    native: bundleManifestPackage(manifest),
    embedded: { id: config?.android?.package ?? null, name: config?.name ?? null },
    extensions: {},
  };
}

/**
 * `{ native, embedded, extensions }` for an `.apk`, an `.aab`, an `.app` or an
 * `.ipa`, the last unzipped to a temporary directory and read as the app it holds.
 */
function artifactIdentity(file) {
  if (/\.apk$/i.test(file)) return apkIdentity(apkFacts(file));
  if (/\.aab$/i.test(file)) return bundleIdentity(file);
  if (/\.app\/?$/i.test(file)) return appIdentity(appFacts(file));
  if (!/\.ipa$/i.test(file)) {
    throw new BuildRecordError(`${file} is not an .apk, an .aab, an .app or an .ipa`);
  }
  if (!fs.existsSync(file)) throw new BuildRecordError(`no ipa at ${file}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ipa-'));
  try {
    execFileSync('unzip', ['-q', file, '-d', dir], { stdio: 'ignore' });
    const payload = path.join(dir, 'Payload');
    const apps = fs.existsSync(payload)
      ? fs.readdirSync(payload).filter((entry) => entry.endsWith('.app'))
      : [];
    if (apps.length !== 1) {
      throw new BuildRecordError(`${file} holds ${apps.length} apps under Payload/, not one`);
    }
    return appIdentity(appFacts(path.join(payload, apps[0])));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The reasons an artifact is not wholly the identity `appId`: its native
 * metadata, its embedded Expo configuration, which must be present, and every
 * extension, which must be `<appId>.<target>`.
 */
function selectedIdentityProblems(file, identity, appId) {
  const native = /\.(apk|aab)$/i.test(file) ? 'manifest' : 'app';
  const problems = [];
  if (identity.native !== appId) {
    problems.push(`the ${native} declares ${identity.native ?? 'no identity'}, not ${appId}`);
  }
  const embedded = identity.embedded?.id ?? null;
  if (embedded !== appId) {
    problems.push(
      `the embedded Expo configuration names ${embedded ?? 'no identity'}, not ${appId}`
    );
  }
  for (const [name, id] of Object.entries(identity.extensions ?? {})) {
    const suffix = id?.startsWith(`${appId}.`) ? id.slice(appId.length + 1) : '';
    if (!suffix || suffix.includes('.')) {
      problems.push(`the extension ${name} is ${id ?? 'unidentified'}, not ${appId}.<target>`);
    }
  }
  return problems;
}

module.exports = { artifactIdentity, bundleManifestPackage, selectedIdentityProblems };
