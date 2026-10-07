import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const script = join(__dirname, '../../../scripts/lint-unused-styles.mjs');

it('reports an unread key while accepting local, imported and computed sheet readers', () => {
  const root = mkdtempSync(join(tmpdir(), 'unused-styles-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src/sheets.ts'),
      `import { StyleSheet } from 'react-native';
export const shared = StyleSheet.create({ imported: {}, abandoned: {} });
export const indexed = StyleSheet.create({ first: {}, second: {} });
const local = StyleSheet.create({ used: {}, dead: {} });
export const view = local.used;
export const dynamic = indexed[Math.random() ? 'first' : 'second'];
`
    );
    writeFileSync(
      join(root, 'src/reader.ts'),
      `import { shared } from './sheets'; export const style = shared.imported;`
    );
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    const run = spawnSync('node', [script, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('sheets.ts');
    expect(`${run.stdout}${run.stderr}`).toMatch(/abandoned/);
    expect(`${run.stdout}${run.stderr}`).toMatch(/dead/);
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/(?:shared\.imported|indexed\.|local\.used)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
