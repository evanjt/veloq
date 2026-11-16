#!/usr/bin/env node
// Fail unless the app declares that it uses no non-exempt encryption.
//
// The app's TLS, DTLS and authenticated-encryption code are standard protocols from
// open-source libraries, protecting the athlete's own data in transit and at rest, which
// the App Store's export compliance form treats as exempt. So both declarations stay
// `false`, and they change only when a store review asks for it.
//
// The declarations are read from `expo.ios.infoPlist` and `expo.ios.config` in app.json.
// When `ios/` exists, the Info.plist of its app target (the folder holding AppDelegate)
// must carry the same key as `<false/>`, so a prebuild that drops it is caught too.
// `--root <dir>` reads the project at that directory, for the test beside this file.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const KEY = 'ITSAppUsesNonExemptEncryption';
const CONFIG_KEY = 'usesNonExemptEncryption';

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

const show = (value) => (value === undefined ? 'missing' : JSON.stringify(value));

function appTargets(iosDir) {
  return readdirSync(iosDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(iosDir, entry.name))
    .filter(
      (dir) => existsSync(join(dir, 'AppDelegate.swift')) || existsSync(join(dir, 'AppDelegate.mm'))
    );
}

try {
  const root = resolve(flag('--root') ?? process.cwd());
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  const ios = app.expo?.ios ?? {};
  const problems = [];

  const infoPlist = ios.infoPlist?.[KEY];
  if (infoPlist !== false)
    problems.push(
      `app.json expo.ios.infoPlist.${KEY} is ${show(infoPlist)}, it must be the boolean false`
    );

  const config = ios.config?.[CONFIG_KEY];
  if (config !== false)
    problems.push(
      `app.json expo.ios.config.${CONFIG_KEY} is ${show(config)}, it must be the boolean false`
    );

  const iosDir = join(root, 'ios');
  if (existsSync(iosDir)) {
    const targets = appTargets(iosDir);
    if (targets.length === 0)
      problems.push(
        'ios/ exists but holds no app target (a folder with AppDelegate.swift or AppDelegate.mm)'
      );
    for (const target of targets) {
      const file = join(target, 'Info.plist');
      if (!existsSync(file)) {
        problems.push(`${file} is missing`);
        continue;
      }
      const match = readFileSync(file, 'utf8').match(
        new RegExp(`<key>${KEY}</key>\\s*<(true|false)\\s*/>`)
      );
      if (!match) problems.push(`${file} does not declare ${KEY}`);
      else if (match[1] !== 'false')
        problems.push(`${file} declares ${KEY} as <true/>, it must be <false/>`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-export-compliance: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('check-export-compliance: the export compliance declarations are false');
  }
} catch (error) {
  console.error(`check-export-compliance: ${error.message}`);
  process.exitCode = 1;
}
