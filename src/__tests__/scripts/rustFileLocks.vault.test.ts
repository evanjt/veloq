import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-rust-file-locks.mjs');

function checkFixture(files: Record<string, string>): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rust-file-locks-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), source);
    }
    const result = spawnSync('node', [GUARD, '--root', dir], { cwd: ROOT, encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('rejects std File locking on a file handle, which Android refuses at runtime', () => {
  const result = checkFixture({
    'persistence/mod.rs': `fn init() {
    let init_file = std::fs::File::create("x").unwrap();
    if let Err(e) = init_file.lock() { return; }
}`,
  });
  expect(result.status).toBe(1);
  expect(result.output).toContain('persistence/mod.rs:3');
});

it('rejects the path form and the try and shared variants', () => {
  const result = checkFixture({
    'a.rs': 'fn a(f: &File) { File::try_lock(f).ok(); }',
    'b.rs': 'fn b(lock_file: &File) { lock_file.lock_shared().ok(); }',
  });
  expect(result.status).toBe(1);
  expect(result.output).toContain('a.rs:1');
  expect(result.output).toContain('b.rs:1');
});

it('accepts mutex locks, comments and the file_lock owner', () => {
  const result = checkFixture({
    'engine.rs': `fn e() {
    let guard = state.lock().unwrap();
    // init_file.lock() returned Unsupported here once
}`,
    'persistence/file_lock.rs': 'fn owner(file: &File) { file.lock().ok(); }',
  });
  expect(result.status).toBe(0);
});
