import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const roots: string[] = [];

function runFormatCheck(moduleSource: string, generatedSource: string): number {
  const root = mkdtempSync(join(tmpdir(), 'module-format-'));
  roots.push(root);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'modules/veloqrs/src/generated'), { recursive: true });
  writeFileSync(join(root, 'package.json'), readFileSync(join(ROOT, 'package.json')));
  writeFileSync(join(root, 'config/.prettierrc'), readFileSync(join(ROOT, 'config/.prettierrc')));
  writeFileSync(
    join(root, 'config/.prettierignore'),
    readFileSync(join(ROOT, 'config/.prettierignore'))
  );
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'modules/veloqrs/src/a.ts'), moduleSource);
  writeFileSync(join(root, 'modules/veloqrs/src/generated/a.ts'), generatedSource);
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  try {
    execFileSync('npm', ['run', 'format:check'], { cwd: root, stdio: 'ignore' });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

it('checks handwritten module TypeScript and skips generated bindings', () => {
  expect(runFormatCheck('export  const a=1\n', 'export  const g=1\n')).toBe(1);
  expect(runFormatCheck('export const a = 1;\n', 'export  const g=1\n')).toBe(0);
});
