import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const script = join(root, 'scripts/check-module-version.mjs');

it('the shipped module version matches the app release', () => {
  const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const module = JSON.parse(readFileSync(join(root, 'modules/veloqrs/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  expect(module.version).toBe(app.version);
  expect(lock.packages['modules/veloqrs'].version).toBe(app.version);
});

it('the release audit rejects a module version left behind by a version bump', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'module-version-'));
  try {
    mkdirSync(join(fixture, 'modules/veloqrs'), { recursive: true });
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ version: '0.4.1' }));
    writeFileSync(
      join(fixture, 'modules/veloqrs/package.json'),
      JSON.stringify({ version: '0.4.0' })
    );
    writeFileSync(
      join(fixture, 'package-lock.json'),
      JSON.stringify({ packages: { 'modules/veloqrs': { version: '0.4.0' } } })
    );
    const run = spawnSync('node', [script, fixture], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('veloqrs version');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

it('the release audit rejects a stale locked module version', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'module-version-'));
  try {
    mkdirSync(join(fixture, 'modules/veloqrs'), { recursive: true });
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ version: '0.4.0' }));
    writeFileSync(
      join(fixture, 'modules/veloqrs/package.json'),
      JSON.stringify({ version: '0.4.0' })
    );
    writeFileSync(
      join(fixture, 'package-lock.json'),
      JSON.stringify({ packages: { 'modules/veloqrs': { version: '0.1.0' } } })
    );
    const run = spawnSync('node', [script, fixture], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('lock version 0.1.0');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
