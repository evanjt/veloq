/**
 * Scenario: a worktree holds one symlink per entry of the main checkout's
 * `node_modules`, and the main checkout gains a package afterwards. Nothing
 * refreshed the set, so the entry was simply absent and seven suites failed
 * naming the importer: `Cannot find module '@ubjs/core'`.
 *
 * Expected behaviour: the link step is re-runnable, adds only what is missing,
 * never moves `veloqrs`, whose target is the caller's business, and does
 * nothing at all in the main checkout.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/link-worktree-modules.mjs');

/** A main checkout holding `packages`, and a worktree linked to some of them. */
function trees(packages: string[], linked: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-links-'));
  const main = path.join(dir, 'main');
  const tree = path.join(dir, 'tree');
  fs.mkdirSync(path.join(main, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(tree, 'node_modules'), { recursive: true });
  for (const name of packages) {
    fs.mkdirSync(path.join(main, 'node_modules', name), { recursive: true });
  }
  for (const name of linked) {
    fs.symlinkSync(path.join(main, 'node_modules', name), path.join(tree, 'node_modules', name));
  }
  return { dir, main, tree };
}

function run(tree: string, main: string) {
  return spawnSync('node', [script, '--root', tree, '--main', main], { encoding: 'utf8' });
}

describe('the worktree module links', () => {
  it('adds the entry the main checkout gained and leaves the rest alone', () => {
    const { main, tree } = trees(['react', '@ubjs'], ['react']);

    const result = run(tree, main);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('@ubjs');
    expect(fs.realpathSync(path.join(tree, 'node_modules', '@ubjs'))).toBe(
      fs.realpathSync(path.join(main, 'node_modules', '@ubjs'))
    );
  });

  it('is re-runnable, so a second pass links nothing', () => {
    const { main, tree } = trees(['react', '@ubjs'], ['react']);

    run(tree, main);
    const second = run(tree, main);

    expect(second.status).toBe(0);
    expect(second.stdout).toContain('level with the main checkout');
  });

  it('never points veloqrs anywhere, since which tree it reads is the build’s business', () => {
    const { main, tree } = trees(['react', 'veloqrs'], ['react']);
    fs.mkdirSync(path.join(tree, 'modules', 'veloqrs'), { recursive: true });
    fs.symlinkSync(
      path.join(tree, 'modules', 'veloqrs'),
      path.join(tree, 'node_modules', 'veloqrs')
    );

    run(tree, main);

    expect(fs.realpathSync(path.join(tree, 'node_modules', 'veloqrs'))).toBe(
      fs.realpathSync(path.join(tree, 'modules', 'veloqrs'))
    );
  });

  it('leaves a veloqrs the worktree never linked unlinked', () => {
    const { main, tree } = trees(['react', 'veloqrs'], ['react']);

    run(tree, main);

    expect(fs.existsSync(path.join(tree, 'node_modules', 'veloqrs'))).toBe(false);
  });

  it('does nothing in the main checkout, where node_modules is the install', () => {
    const { main } = trees(['react'], []);

    const result = run(main, main);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('main checkout');
  });

  it('leaves the whole-directory symlink form alone', () => {
    const { dir, main } = trees(['react', '@ubjs'], []);
    const tree = path.join(dir, 'linked-tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.symlinkSync(path.join(main, 'node_modules'), path.join(tree, 'node_modules'));

    const result = run(tree, main);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no per-entry set');
  });

  it('leaves an installation of its own alone, so a native build tree stays self-contained', () => {
    const { main, tree } = trees(['react', '@ubjs'], []);
    fs.mkdirSync(path.join(tree, 'node_modules', 'react'));
    fs.writeFileSync(path.join(tree, 'node_modules', '.package-lock.json'), '{}');

    const result = run(tree, main);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('installation of its own');
    expect(fs.existsSync(path.join(tree, 'node_modules', '@ubjs'))).toBe(false);
  });

  it('still levels a per-entry set, whose lockfile record is a link like the rest', () => {
    const { main, tree } = trees(['react', '@ubjs'], ['react']);
    fs.writeFileSync(path.join(main, 'node_modules', '.package-lock.json'), '{}');
    fs.symlinkSync(
      path.join(main, 'node_modules', '.package-lock.json'),
      path.join(tree, 'node_modules', '.package-lock.json')
    );

    const result = run(tree, main);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('@ubjs');
  });

  it('runs before the gates rather than once at worktree creation', () => {
    const gates = fs.readFileSync(path.join(projectRoot, 'scripts/run-gates.sh'), 'utf8');

    expect(gates).toContain('link-worktree-modules.mjs');
  });
});
