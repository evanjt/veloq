import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const SOURCE = `import { useMemo } from 'react';
export function Probe({ ready }: { ready: boolean }) {
  if (!ready) return null;
  const value = useMemo(() => 1, []);
  return value;
}
`;
const BRACED_SOURCE = SOURCE.replace('if (!ready) return null;', 'if (!ready) { return null; }');

function result(
  command: string,
  args: string[],
  input?: string
): { status: number; output: string } {
  try {
    const output = execFileSync(command, args, {
      cwd: ROOT,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status: number; stdout?: string; stderr?: string };
    return { status: failure.status, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

it('leaves hook order to ESLint while the crash sweep checks other patterns', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'hooks-guard-'));
  mkdirSync(join(fixtureRoot, 'scripts'));
  mkdirSync(join(fixtureRoot, 'src'));
  mkdirSync(join(fixtureRoot, 'scripts/lib'));
  for (const script of ['crash-guard-sweep.mjs', 'lib/indexedSources.mjs']) {
    copyFileSync(join(ROOT, 'scripts', script), join(fixtureRoot, 'scripts', script));
  }
  writeFileSync(join(fixtureRoot, 'src/probe.tsx'), SOURCE);
  try {
    expect(
      result('node', [join(fixtureRoot, 'scripts/crash-guard-sweep.mjs'), 'src/probe.tsx']).status
    ).toBe(0);
    for (const source of [SOURCE, BRACED_SOURCE]) {
      const lint = result(
        'npx',
        ['eslint', '--stdin', '--stdin-filename', 'src/hooks-fixture.tsx'],
        source
      );
      expect(lint.status).toBe(1);
      expect(lint.output).toContain('react-hooks/rules-of-hooks');
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
