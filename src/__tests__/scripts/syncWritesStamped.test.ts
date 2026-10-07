/**
 * Scenario: a sync pass is between its fetch and its write when the athlete
 * restores a backup. A write that takes the engine without the install it was
 * fetched under puts the old library's rows into the restored database.
 *
 * Expected behaviour: the guard fails naming the line of any write in the sync
 * service that takes the engine through an unstamped helper, whichever helper
 * it is. Stamped writes, reads, and the test modules at the foot of the file
 * pass.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const GUARD = path.resolve(__dirname, '../../../scripts/lint-sync-writes-stamped.mjs');
const SYNC = 'modules/veloqrs/rust/veloqrs/src/objects/sync.rs';

function runGuard(source: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-sync-stamped-'));
  try {
    if (source !== null) {
      fs.mkdirSync(path.dirname(path.join(root, SYNC)), { recursive: true });
      fs.writeFileSync(path.join(root, SYNC), source);
    }
    const stdout = execFileSync('node', [GUARD, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const body = (call: string) => `async fn pass(install: u64) {\n    ${call}\n}\n`;

describe('lint-sync-writes-stamped', () => {
  it('passes a write under the stamped helper', () => {
    const result = runGuard(
      body(
        'with_persistent_engine_blocking_for(install, move |engine| engine.upsert_rows(rows)).await;'
      )
    );
    expect(result.status).toBe(0);
  });

  it('passes a read under the unstamped helper', () => {
    const result = runGuard(
      body('with_persistent_engine_blocking(move |engine| engine.load_rows()).await;')
    );
    expect(result.status).toBe(0);
  });

  it.each([
    ['with_persistent_engine_blocking('],
    ['with_persistent_engine('],
    ['with_engine('],
    ['crate::persistence::with_persistent_engine_blocking('],
  ])('fails a write under %s', (helper) => {
    const result = runGuard(body(`${helper}move |engine| engine.upsert_rows(rows)).await;`));
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${SYNC}:2`);
  });

  it('fails a write wrapped onto later lines', () => {
    const result = runGuard(
      body('with_persistent_engine_blocking(move |engine| {\n        engine.mark_done(id)\n    })')
    );
    expect(result.status).toBe(1);
  });

  it('ignores a write inside a test module at the foot of the file', () => {
    const source =
      body('with_persistent_engine_blocking_for(install, |e| e.set_a(1)).await;') +
      '\n#[cfg(test)]\nmod tests {\n    fn seed() { with_persistent_engine(|e| e.upsert_rows(r)); }\n}\n';
    expect(runGuard(source).status).toBe(0);
  });

  it('fails when the sync service is missing rather than passing over nothing', () => {
    expect(runGuard(null).status).toBe(1);
  });
});
