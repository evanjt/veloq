/**
 * Scenario: the generated bindings open with `@ts-nocheck`, so a generator
 * bump that changes a record factory's shape breaks a caller's types and the
 * typecheck still passes.
 *
 * Expected behaviour: the guard refuses a generated TypeScript file that
 * carries `@ts-nocheck`, and passes one that does not.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const GUARD = path.resolve(__dirname, '../../../scripts/lint-generated-typechecked.mjs');

function run(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-generated-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, 'modules/veloqrs/src/generated', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const result = spawnSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
  fs.rmSync(root, { recursive: true, force: true });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('generated bindings are typechecked', () => {
  it('passes files that carry no suppression', () => {
    expect(run({ 'a.ts': 'export const a = 1;\n' }).status).toBe(0);
  });

  it('refuses a file that opts out of the typecheck, naming it', () => {
    const result = run({
      'a.ts': 'export const a = 1;\n',
      'b.ts': '// @ts-nocheck\nexport const b = 2;\n',
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('b.ts');
    expect(result.output).not.toContain('a.ts');
  });

  it('passes a tree with no generated directory at all', () => {
    expect(run({}).status).toBe(0);
  });
});
