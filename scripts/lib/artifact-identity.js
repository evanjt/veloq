// The identities an Android or iOS artifact carries, read out of the file: the
// one its native metadata declares, the one its embedded Expo configuration
// names, and each extension's. `identityProblems` in `build-record.js` judges
// them, and the build records refuse an artifact it finds fault with.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BuildRecordError, apkFacts, apkIdentity } = require('./build-record.js');
const { appFacts, appIdentity } = require('./build-record-ios.js');

/**
 * `{ native, embedded, extensions }` for an `.apk`, an `.app` or an `.ipa`,
 * the last unzipped to a temporary directory and read as the app it holds.
 */
function artifactIdentity(file) {
  if (/\.apk$/i.test(file)) return apkIdentity(apkFacts(file));
  if (/\.app\/?$/i.test(file)) return appIdentity(appFacts(file));
  if (!/\.ipa$/i.test(file)) {
    throw new BuildRecordError(`${file} is not an .apk, an .app or an .ipa`);
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

module.exports = { artifactIdentity };
