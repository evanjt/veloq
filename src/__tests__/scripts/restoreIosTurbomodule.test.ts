/**
 * Scenario: every `generate:*` script ran an unconditional `git checkout --` over
 * `ios/Veloqrs.h` and `ios/Veloqrs.mm`, with its errors suppressed, so a hand
 * edit to either was discarded on the next generate and nothing said so.
 *
 * Expected behaviour: only a file the generator actually overwrote is put back.
 * The generated pair declares `NativeVeloqrsSpec`; the canonical pair does not.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const script = path.join(__dirname, '../../../modules/veloqrs/scripts/restore-ios-turbomodule.sh');

const CANONICAL = '// Custom iOS TurboModule header for veloqrs\n@interface Veloqrs : NSObject\n';
const GENERATED = '@protocol NativeVeloqrsSpec <RCTBridgeModule>\n@end\n';

/** A scratch repo holding the canonical pair, committed. */
function repoWithCanonicalPair(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ios-'));
  const moduleDir = path.join(dir, 'modules/veloqrs');
  fs.mkdirSync(path.join(moduleDir, 'ios'), { recursive: true });
  for (const name of ['Veloqrs.h', 'Veloqrs.mm']) {
    fs.writeFileSync(path.join(moduleDir, 'ios', name), CANONICAL);
  }
  const git = (...args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'canonical');
  return moduleDir;
}

const run = (moduleDir: string) =>
  spawnSync(script, [moduleDir], { encoding: 'utf8', timeout: 15_000 });

describe('restoring the iOS TurboModule pair', () => {
  it('leaves a hand edit alone', () => {
    const moduleDir = repoWithCanonicalPair();
    const header = path.join(moduleDir, 'ios/Veloqrs.h');
    fs.writeFileSync(header, `${CANONICAL}// a hand edit\n`);

    expect(run(moduleDir).status).toBe(0);
    expect(fs.readFileSync(header, 'utf8')).toContain('a hand edit');
  });

  it('puts back a file the generator overwrote, and says which', () => {
    const moduleDir = repoWithCanonicalPair();
    const header = path.join(moduleDir, 'ios/Veloqrs.h');
    fs.writeFileSync(header, GENERATED);

    const ran = run(moduleDir);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain('ios/Veloqrs.h');
    expect(fs.readFileSync(header, 'utf8')).toBe(CANONICAL);
  });

  it('restores only the file that was taken', () => {
    const moduleDir = repoWithCanonicalPair();
    const header = path.join(moduleDir, 'ios/Veloqrs.h');
    const impl = path.join(moduleDir, 'ios/Veloqrs.mm');
    fs.writeFileSync(header, GENERATED);
    fs.writeFileSync(impl, `${CANONICAL}// a hand edit\n`);

    expect(run(moduleDir).status).toBe(0);
    expect(fs.readFileSync(header, 'utf8')).toBe(CANONICAL);
    expect(fs.readFileSync(impl, 'utf8')).toContain('a hand edit');
  });

  it('does nothing outside a repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-norepo-'));
    fs.mkdirSync(path.join(dir, 'ios'));
    fs.writeFileSync(path.join(dir, 'ios/Veloqrs.h'), GENERATED);
    expect(run(dir).status).toBe(0);
  });
});
