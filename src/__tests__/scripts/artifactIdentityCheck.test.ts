/**
 * Scenario: CI builds or restores an APK, an App Bundle, a simulator app or an
 * IPA for one identity and uploads it. A cache entry, or a step that read the
 * Expo configuration without the variant, can hand it an artifact whose
 * manifest, embedded configuration or extensions carry the other identity.
 *
 * Expected behaviour: `build-record.js identity <artifact> --variant V` judges
 * the file alone, with no record and no checkout state, and exits 1 naming
 * every identity in it that is not the one V selects.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildAab, build as buildApk, checkout } from '../__shared__/apkFixture';
import { buildApp } from '../__shared__/iosAppFixture';

const SCRIPT = path.join(__dirname, '../../../scripts/build-record.js');

function identity(...args: string[]): { status: number; output: string } {
  const env = { ...process.env };
  delete env.APP_VARIANT;
  try {
    const output = execFileSync('node', [SCRIPT, 'identity', ...args], {
      encoding: 'utf8',
      env,
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function ipaOf(app: string): string {
  const parent = path.dirname(app);
  fs.mkdirSync(path.join(parent, 'Payload'));
  fs.renameSync(app, path.join(parent, 'Payload', path.basename(app)));
  const ipa = path.join(parent, 'Veloq.ipa');
  execFileSync('zip', ['-qr', ipa, 'Payload'], { cwd: parent });
  return ipa;
}

let root: string;
const scratch: string[] = [];
beforeEach(() => {
  root = checkout();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const app = (options: Parameters<typeof buildApp>[1]) => {
  const built = buildApp(root, options);
  scratch.push(path.dirname(built));
  return built;
};

describe('an APK', () => {
  it('refuses a production APK whose embedded configuration names the Dev package', () => {
    const apk = buildApk(root, {
      applicationId: 'com.veloq.app',
      configPackage: 'com.veloq.app.dev',
    });

    const { status, output } = identity(apk, '--variant', 'production');

    expect(status).toBe(1);
    expect(output).toContain('com.veloq.app.dev');
    expect(output).toMatch(/embedded Expo configuration/);
    expect(output).not.toContain('manifest declares');
  });

  it('passes a consistent Dev APK checked as Dev', () => {
    const apk = buildApk(root);

    const { status, output } = identity(apk, '--variant', 'dev');

    expect(output).toContain('com.veloq.app.dev');
    expect(status).toBe(0);
  });

  it('refuses a consistent production APK checked as Dev, naming the manifest and the configuration', () => {
    const apk = buildApk(root, { applicationId: 'com.veloq.app' });

    const { status, output } = identity(apk, '--variant', 'dev');

    expect(status).toBe(1);
    expect(output).toMatch(/manifest declares com\.veloq\.app, not com\.veloq\.app\.dev/);
    expect(output).toMatch(
      /embedded Expo configuration names com\.veloq\.app, not com\.veloq\.app\.dev/
    );
  });

  it('refuses an APK whose embedded configuration names no package', () => {
    const apk = buildApk(root, { applicationId: 'com.veloq.app', configPackage: null });

    const { status, output } = identity(apk, '--variant', 'production');

    expect(status).toBe(1);
    expect(output).toMatch(/embedded Expo configuration names no identity/);
  });
});

describe('an App Bundle', () => {
  it('refuses a production bundle whose base module embeds the Dev package', () => {
    const aab = buildAab(root, {
      applicationId: 'com.veloq.app',
      configPackage: 'com.veloq.app.dev',
    });

    const { status, output } = identity(aab, '--variant', 'production');

    expect(status).toBe(1);
    expect(output).toMatch(
      /embedded Expo configuration names com\.veloq\.app\.dev, not com\.veloq\.app\b/
    );
  });

  it('reads the package out of the protocol buffer manifest', () => {
    const aab = buildAab(root, { applicationId: 'com.veloq.app.dev' });

    expect(identity(aab, '--variant', 'dev').status).toBe(0);
    const production = identity(aab, '--variant', 'production');
    expect(production.status).toBe(1);
    expect(production.output).toMatch(
      /manifest declares com\.veloq\.app\.dev, not com\.veloq\.app\b/
    );
  });
});

describe('an iOS app and its IPA', () => {
  it('refuses a production IPA whose push extension carries the Dev identity', () => {
    const ipa = ipaOf(
      app({
        bundleId: 'com.veloq.app',
        platform: 'iphoneos',
        extensions: {
          VeloqWidget: 'com.veloq.app.VeloqWidget',
          VeloqPushExtension: 'com.veloq.app.dev.VeloqPushExtension',
        },
      })
    );

    const { status, output } = identity(ipa, '--variant', 'production');

    expect(status).toBe(1);
    expect(output).toContain('VeloqPushExtension is com.veloq.app.dev.VeloqPushExtension');
    expect(output).not.toContain('VeloqWidget is');
  });

  it('passes a consistent production simulator app and refuses it checked as Dev', () => {
    const built = app({ bundleId: 'com.veloq.app' });

    expect(identity(built, '--variant', 'production').status).toBe(0);
    const dev = identity(built, '--variant', 'dev');
    expect(dev.status).toBe(1);
    expect(dev.output).toMatch(/declares com\.veloq\.app, not com\.veloq\.app\.dev/);
    expect(dev.output).toMatch(
      /VeloqWidget is com\.veloq\.app\.VeloqWidget, not com\.veloq\.app\.dev\.<target>/
    );
  });

  it('refuses an app whose embedded configuration names the other identity', () => {
    const built = app({ bundleId: 'com.veloq.app', embeddedBundleId: 'com.veloq.app.dev' });

    const { status, output } = identity(built, '--variant', 'production');

    expect(status).toBe(1);
    expect(output).toMatch(
      /embedded Expo configuration names com\.veloq\.app\.dev, not com\.veloq\.app\b/
    );
  });
});

describe('the command', () => {
  it('refuses to guess the identity when no variant is given', () => {
    const apk = buildApk(root);

    const { status, output } = identity(apk);

    expect(status).toBe(1);
    expect(output).toContain('--variant');
  });

  it('refuses a variant that names no identity', () => {
    const apk = buildApk(root);

    const { status, output } = identity(apk, '--variant', 'staging');

    expect(status).toBe(1);
    expect(output).toContain('staging');
  });

  it('refuses a missing artifact', () => {
    const { status, output } = identity(path.join(root, 'absent.apk'), '--variant', 'dev');

    expect(status).toBe(1);
    expect(output).toContain('absent.apk');
  });
});
