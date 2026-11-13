/**
 * Scenario: a store writes a new key through setSetting.
 *
 * Expected behaviour: the guard fails unless the settings migration lists the
 * key or the guard names it as engine-only, so an upgrade never drops it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-setting-keys.mjs');

function run(root?: string): { status: number; output: string } {
  const args = root ? [SCRIPT, '--root', root] : [SCRIPT];
  try {
    const output = execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const MIGRATION = `const REPAIR_KEYS = ['repair-key'] as const;
export const PREFERENCE_KEYS = ['listed-key', ...REPAIR_KEYS] as const;
`;

describe('setSetting key coverage guard', () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  const withWriter = (body: string) => {
    const root = mkdtempSync(join(tmpdir(), 'setting-keys-'));
    roots.push(root);
    const files: Record<string, string> = {
      'src/shared/storage/migrateSettingsToSqlite.ts': MIGRATION,
      'src/features/x/store.ts': `import { setSetting } from '@/shared/storage';\n${body}`,
    };
    for (const [path, text] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, text);
    }
    return root;
  };

  it('fails on a literal key the migration does not list', () => {
    const result = run(withWriter(`setSetting('new-key', 'v');\n`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('new-key');
  });

  it('fails on an unlisted key held in a const', () => {
    const result = run(withWriter(`const K = 'held-key';\nsetSetting(K, 'v');\n`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('held-key');
  });

  it('passes on keys listed directly, through a spread, or named engine-only', () => {
    const body = `setSetting('listed-key', 'v');\nsetSetting('repair-key', 'v');\nsetSetting('__athlete_id', 'v');\n`;
    expect(run(withWriter(body)).status).toBe(0);
  });

  it('fails on a key it cannot resolve to a literal', () => {
    const result = run(withWriter(`export const write = (key: string) => setSetting(key, 'v');\n`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('unresolved key');
  });
});
