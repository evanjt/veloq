#!/usr/bin/env node
// Header and search result assets for the App Store listing, through the App
// Store Connect API, which fastlane does not cover.
//
//   node scripts/store/app-store-assets.mjs refdata
//       writes the API's asset specs to scripts/store/app-store-asset-specs.json
//   node scripts/store/app-store-assets.mjs upload <version> [--still] [--apply]
//       plans every store locale's header and search asset for the version and
//       prints the plan. Nothing is uploaded without --apply. Videos are
//       the default and --still places the png instead.
//
// The key is read from the environment and never written anywhere:
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8 file)
//   ASC_APP_ID, the app's numeric id, for `upload`
//
// Assets live under config/fastlane/store-assets/<folder>/{header,search}.{png,mp4}.
// Stills are tracked. Videos are built by a command and ignored by git.

import { createHash, createPrivateKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { planAssets } = require('../lib/app-store-asset-plan.js');

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const ASSETS = join(ROOT, 'config/fastlane/store-assets');
const LOCALES = join(ROOT, 'config/fastlane/metadata/ios');
const SPECS = join(here, 'app-store-asset-specs.json');
const API = 'https://api.appstoreconnect.apple.com';

const b64 = (value) => Buffer.from(value).toString('base64url');

function token() {
  const ASC_KEY_ID = process.env.ASC_KEY_ID;
  const ASC_ISSUER_ID = process.env.ASC_ISSUER_ID;
  const ASC_KEY_PATH = process.env.ASC_KEY_PATH;
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) {
    throw new Error('set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH');
  }
  const header = b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64(
    JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' })
  );
  const key = createPrivateKey(readFileSync(ASC_KEY_PATH));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${b64(signature)}`;
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function pngSize(path) {
  const head = readFileSync(path).subarray(0, 24);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function videoSize(path) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      path,
    ],
    { encoding: 'utf8' }
  );
  const [width, height] = out.trim().split(',').map(Number);
  return { width, height };
}

function readFolders() {
  const folders = {};
  for (const folder of readdirSync(ASSETS)) {
    const dir = join(ASSETS, folder);
    if (!statSync(dir).isDirectory()) continue;
    folders[folder] = [];
    for (const file of readdirSync(dir)) {
      const match = /^(header|search)\.(png|mp4)$/.exec(file);
      if (!match) continue;
      const medium = match[2] === 'png' ? 'still' : 'video';
      const size = medium === 'still' ? pngSize(join(dir, file)) : videoSize(join(dir, file));
      folders[folder].push({ file, kind: match[1], medium, ...size });
    }
  }
  return folders;
}

const storeLocales = () =>
  readdirSync(LOCALES).filter(
    (name) => statSync(join(LOCALES, name)).isDirectory() && name !== 'review_information'
  );

/**
 * The asset endpoints below follow the reserve, upload, commit, place order the
 * listing needs. `refdata` records what the API reports so a change in its
 * resource names shows in the committed JSON before an upload relies on them.
 */
async function refdata() {
  const reference = await api('GET', '/v1/appStoreVersionLocalizations?limit=1');
  const sample = reference.data?.[0]?.relationships ?? {};
  const specs = {
    header: { width: 3840, height: 1646 },
    search: { width: 3840, height: 2560 },
    relationships: Object.keys(sample).sort(),
  };
  writeFileSync(SPECS, `${JSON.stringify(specs, null, 2)}\n`);
  console.log(`wrote ${SPECS}`);
}

async function uploadFile(operations, path) {
  const dir = mkdtempSync(join(tmpdir(), 'asc-parts-'));
  try {
    for (const operation of operations) {
      const headers = Object.fromEntries(operation.requestHeaders.map((h) => [h.name, h.value]));
      const headersPath = join(dir, 'headers.json');
      writeFileSync(headersPath, JSON.stringify(headers));
      execFileSync(
        'python3',
        [
          '-I',
          join(here, 'put-part.py'),
          operation.url,
          path,
          String(operation.offset),
          String(operation.length),
          headersPath,
        ],
        { stdio: 'inherit' }
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function place(entry, versionId) {
  const path = join(ASSETS, entry.folder, entry.file);
  const bytes = readFileSync(path);
  const localization = await api(
    'GET',
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?filter[locale]=${entry.locale}`
  );
  const localizationId = localization.data?.[0]?.id;
  if (!localizationId) throw new Error(`version has no ${entry.locale} localization`);
  const resource = entry.kind === 'header' ? 'appHeaderAssets' : 'appSearchResultAssets';
  const reserved = await api('POST', `/v1/${resource}`, {
    data: {
      type: resource,
      attributes: { fileName: entry.file, fileSize: bytes.length, medium: entry.medium },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: localizationId },
        },
      },
    },
  });
  const { id, attributes } = reserved.data;
  await uploadFile(attributes.uploadOperations, path);
  const md5 = createHash('md5').update(bytes).digest('hex');
  await api('PATCH', `/v1/${resource}/${id}`, {
    data: { type: resource, id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
  });
}

async function upload(version, flags) {
  const specs = JSON.parse(readFileSync(SPECS, 'utf8'));
  const medium = flags.includes('--still') ? 'still' : 'video';
  const plan = planAssets({ storeLocales: storeLocales(), folders: readFolders(), specs, medium });
  if (plan.errors.length > 0) {
    console.error(plan.errors.join('\n'));
    process.exit(1);
  }
  for (const entry of plan.entries) {
    console.log(
      `${flags.includes('--apply') ? 'place' : 'would place'} ${entry.locale} ${entry.kind} ${entry.medium} ${entry.folder}/${entry.file}`
    );
  }
  if (!flags.includes('--apply')) {
    console.log('dry run: nothing uploaded. Pass --apply to upload.');
    return;
  }
  const appId = process.env.ASC_APP_ID;
  if (!appId) throw new Error('set ASC_APP_ID');
  const versions = await api(
    'GET',
    `/v1/apps/${appId}/appStoreVersions?filter[versionString]=${encodeURIComponent(version)}&filter[platform]=IOS`
  );
  const versionId = versions.data?.[0]?.id;
  if (!versionId) throw new Error(`no iOS version ${version}`);
  for (const entry of plan.entries) await place(entry, versionId);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'refdata') await refdata();
  else if (command === 'upload' && rest[0] && !rest[0].startsWith('--'))
    await upload(rest[0], rest.slice(1));
  else {
    console.error('usage: app-store-assets.mjs refdata | upload <version> [--still] [--apply]');
    process.exit(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
