import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-apple-crypto.mjs');
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function run(tree: string) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-crypto-'));
  dirs.push(dir);
  const file = join(dir, 'tree.txt');
  writeFileSync(file, tree);
  return spawnSync('node', [GUARD, '--tree', file], { encoding: 'utf8' });
}

describe('Apple build cipher guard', () => {
  it('fails and names every own-cipher crate in an Apple tree', () => {
    const run1 = run(
      'veloqrs v0.1.0\nstr0m v0.25.0\nstr0m-rust-crypto v0.7.0\naws-lc-sys v0.30.0\n'
    );
    expect(run1.status).toBe(1);
    expect(run1.stderr).toContain('str0m-rust-crypto');
    expect(run1.stderr).toContain('aws-lc-sys');
  });

  it('fails an Apple tree that carries the pairing hash and MAC crates of its own', () => {
    const result = run('veloqrs v0.1.0\nhmac v0.13.0\nsha2 v0.11.0\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hmac');
    expect(result.stderr).toContain('sha2');
  });

  it('does not match a crate whose name only starts with a banned one', () => {
    const result = run(
      'veloqrs v0.1.0\nstr0m-apple-crypto v0.7.0\np256k1 v1.0.0\naes-gcm-siv v0.1.0\n'
    );
    expect(result.status).toBe(0);
  });

  it('passes a tree that takes its ciphers from the operating system', () => {
    const result = run(
      'veloqrs v0.1.0\nstr0m v0.25.0\nstr0m-apple-crypto v0.7.0\nswift-rs v1.0.0\n'
    );
    expect(result.status).toBe(0);
  });

  it('fails an empty tree rather than passing it', () => {
    expect(run('').status).toBe(1);
  });
});
