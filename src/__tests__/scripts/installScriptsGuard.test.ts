/**
 * An installed dependency with an unreviewed install script must stop the
 * guard before a native build can consume its incomplete package tree.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');

it('rejects a dependency install script missing from allowScripts', () => {
  const fixture = mkdtempSync(join(root, 'node_modules', '.install-scripts-test-'));
  try {
    const dependency = join(fixture, 'node_modules', 'example-install');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({
        name: 'script-fixture',
        version: '1.0.0',
        dependencies: { 'example-install': '1.0.0' },
      })
    );
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: 'example-install',
        version: '1.0.0',
        scripts: { install: 'node install.js' },
      })
    );
    const guards = join(fixture, 'guards.json');
    writeFileSync(
      guards,
      JSON.stringify([
        {
          name: 'check:install-scripts',
          kind: 'correctness',
          cmd: [process.execPath, join(root, 'scripts', 'check-install-scripts.mjs')],
          catches: 'an unreviewed dependency install script leaves binaries absent',
        },
      ])
    );

    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'run-guards.mjs'), '--set', 'commit', '--guards', guards],
      {
        cwd: fixture,
        encoding: 'utf8',
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('example-install@1.0.0');

    const approval = spawnSync('npm', ['install-scripts', 'approve', 'example-install'], {
      cwd: fixture,
      encoding: 'utf8',
    });
    expect(approval.status).toBe(0);
    const approved = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'run-guards.mjs'), '--set', 'commit', '--guards', guards],
      {
        cwd: fixture,
        encoding: 'utf8',
      }
    );
    expect(approved.status).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
