/**
 * Scenario: two checkouts each have an Xcode DerivedData directory holding the
 * engine xcframework intermediates, and one of them rebuilds.
 *
 * Expected behaviour: the clean step removes the rebuilding checkout's
 * intermediates and leaves every other checkout's untouched.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.join(__dirname, '../../..');
const cleanScript = path.join(projectRoot, 'modules/veloqrs/scripts/clean.sh');

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-clean-'));
  dirs.push(dir);
  return dir;
}

/** A checkout holding a copy of the production clean script. */
function checkout(parent: string, name: string): string {
  const root = path.join(parent, name);
  const scripts = path.join(root, 'modules', 'veloqrs', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(cleanScript, path.join(scripts, 'clean.sh'));
  fs.mkdirSync(path.join(root, 'ios'), { recursive: true });
  return root;
}

/** The DerivedData directory Xcode keeps for `root`'s workspace. */
function derivedData(home: string, hash: string, root: string): string {
  const dir = path.join(home, 'Library/Developer/Xcode/DerivedData', `VeloqDev-${hash}`);
  fs.mkdirSync(
    path.join(dir, 'Build/Products/Debug-iphonesimulator/XCFrameworkIntermediates/Veloqrs'),
    {
      recursive: true,
    }
  );
  fs.writeFileSync(
    path.join(dir, 'Build/Products/Debug-iphonesimulator/XCFrameworkIntermediates/Veloqrs/marker'),
    hash
  );
  fs.writeFileSync(
    path.join(dir, 'info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>WorkspacePath</key>
<string>${path.join(root, 'ios', 'VeloqDev.xcworkspace')}</string>
</dict></plist>
`
  );
  return path.join(dir, 'Build/Products/Debug-iphonesimulator/XCFrameworkIntermediates/Veloqrs');
}

/** Runs one checkout's clean script on a Darwin-reporting machine. */
function clean(root: string, home: string) {
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho Darwin\n', { mode: 0o755 });
  return spawnSync('bash', [path.join(root, 'modules/veloqrs/scripts/clean.sh')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
}

describe('the engine clean step on iOS', () => {
  it('removes only the rebuilding checkout intermediates', () => {
    const parent = scratch();
    const home = path.join(parent, 'home');
    const a = checkout(parent, 'alpha');
    const b = checkout(parent, 'beta');
    const aOutput = derivedData(home, 'aaaa', a);
    const bOutput = derivedData(home, 'bbbb', b);

    const result = clean(a, home);

    expect(result.status).toBe(0);
    expect(fs.existsSync(aOutput)).toBe(false);
    expect(fs.readFileSync(path.join(bOutput, 'marker'), 'utf8')).toBe('bbbb');
  });

  it('leaves every intermediate alone when no DerivedData names the checkout', () => {
    const parent = scratch();
    const home = path.join(parent, 'home');
    const a = checkout(parent, 'alpha');
    const b = checkout(parent, 'beta');
    const bOutput = derivedData(home, 'bbbb', b);

    const result = clean(a, home);

    expect(result.status).toBe(0);
    expect(fs.existsSync(bOutput)).toBe(true);
  });

  it('survives a DerivedData directory with no info.plist', () => {
    const parent = scratch();
    const home = path.join(parent, 'home');
    const a = checkout(parent, 'alpha');
    const orphan = path.join(home, 'Library/Developer/Xcode/DerivedData/VeloqDev-cccc');
    fs.mkdirSync(orphan, { recursive: true });
    const aOutput = derivedData(home, 'aaaa', a);

    const result = clean(a, home);

    expect(result.status).toBe(0);
    expect(fs.existsSync(aOutput)).toBe(false);
    expect(fs.existsSync(orphan)).toBe(true);
  });
});

describe('the iOS clean command', () => {
  it('runs the scoped clean', () => {
    expect(packageJson.scripts['clean:rust']).toBe('npm run clean --prefix modules/veloqrs');
  });
});
