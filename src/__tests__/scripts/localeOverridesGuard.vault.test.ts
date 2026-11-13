import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/lint-locale-overrides.mjs');

function check(variant: object): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'locale-overrides-'));
  try {
    const dir = join(root, 'src/i18n/locales');
    mkdirSync(dir, { recursive: true });
    for (const name of ['en-GB', 'es']) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ panel: { title: 'Base title' } }));
    }
    for (const name of ['en-AU', 'en-US', 'es-419', 'es-ES']) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(name === 'en-US' ? variant : {}));
    }
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('regional locale overrides', () => {
  it('rejects a nested value copied from its base', () => {
    const result = check({ panel: { title: 'Base title' } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('en-US: panel.title repeats en-GB');
  });

  it('accepts a differing value and inherited missing keys', () => {
    expect(check({ panel: { title: 'Regional title' } }).status).toBe(0);
  });
});
