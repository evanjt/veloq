/**
 * Scenario: two branches each lower a ratcheted count and the merged tree sits below a baseline
 * neither could have written.
 *
 * Expected behaviour: a count above its baseline fails under every guard set. A count below it
 * fails at commit, where the author can write the lower figure, and passes at the land gate while
 * naming the entry to lower and the command that writes it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ratchet-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(script: string, root: string, baseline: object, set: string | undefined) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline));
  const env = { ...process.env };
  delete env.VELOQ_GUARD_SET;
  if (set) env.VELOQ_GUARD_SET = set;
  try {
    const stdout = execFileSync(
      'node',
      [path.join(REPO, 'scripts', script), '--root', root, '--baseline', baselineFile],
      { encoding: 'utf8', env }
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const RUST = 'modules/veloqrs/rust/veloqrs/src/zone.rs';
const TWO_TAKES = 'fn a() { with_engine(|e| 1); with_engine(|e| 2); }\n';
const TWO_TITLES = `
const styles = StyleSheet.create({
  title: { ...typography.sectionTitle },
  heading: { fontSize: typography.cardTitle.fontSize },
});
`;
const TSX = 'src/features/a/A.tsx';

const CASES = [
  {
    name: 'the engine write-lock ratchet',
    script: 'lint-engine-write-lock.mjs',
    tree: () => treeWith({ [RUST]: TWO_TAKES }),
    file: RUST,
    at: 2,
  },
  {
    name: 'a style ratchet',
    script: 'lint-heading-tokens.mjs',
    tree: () => treeWith({ [TSX]: TWO_TITLES }),
    file: TSX,
    at: 2,
  },
];

describe.each(CASES)('$name at the land gate', ({ script, tree, file, at }) => {
  it('passes a tree below its baseline and names the entry and the write command', () => {
    const run = runGuard(script, tree(), { [file]: at + 1 }, 'land');

    expect(run.status).toBe(0);
    expect(run.output).toContain(file);
    expect(run.output).toContain('--write');
  });

  it('refuses a tree below its baseline at commit, and when no set is named', () => {
    expect(runGuard(script, tree(), { [file]: at + 1 }, 'commit').status).toBe(1);
    expect(runGuard(script, tree(), { [file]: at + 1 }, undefined).status).toBe(1);
  });

  it('refuses a tree above its baseline under every set', () => {
    for (const set of ['land', 'commit', undefined]) {
      expect(runGuard(script, tree(), { [file]: at - 1 }, set).status).toBe(1);
    }
  });

  it('passes a tree on its baseline under every set', () => {
    for (const set of ['land', 'commit', undefined]) {
      expect(runGuard(script, tree(), { [file]: at }, set).status).toBe(0);
    }
  });

  it('refuses a tree above one baseline entry even when another entry is below', () => {
    const root = tree();
    const run = runGuard(script, root, { [file]: at - 1, 'src/gone.ts': 1 }, 'land');

    expect(run.status).toBe(1);
  });
});
