/**
 * Scenario: two branches each add a link method, so each changes the same
 * lines of the method table, the page schema and the bindings, and a text merge
 * of them is a conflict whose right answer is the generator's output.
 *
 * Expected behaviour: with the drivers installed, the merge completes with no
 * conflict in any of the three files.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const REPO = resolve(__dirname, '../../..');
const INSTALL = join(REPO, 'scripts/install-merge-drivers.mjs');
const GENERATED = [
  'web/connect/methods.json',
  'web/connect/schema.d.ts',
  'modules/veloqrs/src/generated/veloqrs.ts',
];

const boxes: string[] = [];
afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

function table(...methods: string[]): string {
  return `${['// head', ...methods, '// tail'].join('\n')}\n`;
}

function writeAll(root: string, text: string) {
  for (const file of GENERATED) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

describe('two branches that each add a link method', () => {
  vaultIt('merge with no conflict in the method table, the page schema or the bindings', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'regenerated-merge-')));
    boxes.push(root);
    const git = (...args: string[]) => runGit(args, root);
    runGit(['init', '-q', '-b', 'main'], root);
    writeFileSync(join(root, '.gitattributes'), readFileSync(join(REPO, '.gitattributes')));
    writeAll(root, table('alpha'));
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-q', '-b', 'other');
    writeAll(root, table('alpha', 'beta'));
    git('commit', '-qam', 'adds beta');
    git('checkout', '-q', 'main');
    writeAll(root, table('alpha', 'gamma'));
    git('commit', '-qam', 'adds gamma');

    const installed = spawnSync('node', [INSTALL], {
      cwd: root,
      env: gitFreeEnv(),
      encoding: 'utf8',
    });
    expect(installed.status).toBe(0);
    const merged = spawnSync('git', ['merge', '-q', '--no-edit', 'other'], {
      cwd: root,
      env: gitFreeEnv(),
      encoding: 'utf8',
    });

    expect(merged.status).toBe(0);
    for (const file of GENERATED) {
      expect(readFileSync(join(root, file), 'utf8')).not.toContain('<<<<<<<');
    }
  });
});

describe('regenerating the link files at a landing', () => {
  const LIB = join(REPO, 'scripts/lib/regenerate-link-files.sh');

  it('commits the generator output when the merged files equal the base', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'regenerated-landing-')));
    boxes.push(root);
    const git = (...args: string[]) => runGit(args, root);
    runGit(['init', '-q', '-b', 'main'], root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(
      join(root, 'scripts/regenerate-link-files.mjs'),
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "for (const f of ['web/connect/methods.json', 'web/connect/schema.d.ts', 'modules/veloqrs/src/generated/veloqrs.ts']) {",
        "  mkdirSync(f.slice(0, f.lastIndexOf('/')), { recursive: true });",
        "  writeFileSync(f, 'alpha\\nbeta\\n');",
        '}',
        '',
      ].join('\n')
    );
    writeAll(root, table('alpha'));
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    const landed = spawnSync(
      'bash',
      ['-c', `. "${LIB}"; LANDING="${root}"; TARGET=main; regenerate_link_files "${base}"`],
      { cwd: root, env: gitFreeEnv(), encoding: 'utf8' }
    );

    expect(landed.status).toBe(0);
    expect(git('rev-parse', 'HEAD').trim()).not.toBe(base);
    expect(readFileSync(join(root, 'web/connect/methods.json'), 'utf8')).toContain('beta');
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  vaultIt('leaves the history alone when the generator changes nothing', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'regenerated-landing-')));
    boxes.push(root);
    const git = (...args: string[]) => runGit(args, root);
    runGit(['init', '-q', '-b', 'main'], root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/regenerate-link-files.mjs'), '');
    writeAll(root, table('alpha'));
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD').trim();

    const landed = spawnSync(
      'bash',
      ['-c', `. "${LIB}"; LANDING="${root}"; TARGET=main; regenerate_link_files "${base}"`],
      { cwd: root, env: gitFreeEnv(), encoding: 'utf8' }
    );

    expect(landed.status).toBe(0);
    expect(git('rev-parse', 'HEAD').trim()).toBe(base);
  });
});
