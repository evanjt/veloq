import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

it('rejects a new direct dependency without a shipped licence entry', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'license-coverage-'));
  try {
    const files = [
      'package.json',
      'src/app/licenses.tsx',
      'THIRD_PARTY_LICENSES.md',
      'modules/veloqrs/rust/veloqrs/Cargo.toml',
    ];
    for (const file of files) {
      mkdirSync(join(fixture, file, '..'), { recursive: true });
      copyFileSync(join(root, file), join(fixture, file));
    }
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'));
    const app = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
    app.dependencies['missing-licence-package'] = '1.0.0';
    writeFileSync(join(fixture, 'package.json'), JSON.stringify(app));
    const run = spawnSync('node', ['scripts/check-license-coverage.mjs', fixture], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing-licence-package: screen licence or repository');
    expect(run.stderr).toContain('missing-licence-package: notice');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
