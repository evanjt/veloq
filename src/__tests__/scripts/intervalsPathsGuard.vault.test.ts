/**
 * Expected behaviour: the guard fails an intervals.icu path literal or a
 * transport request call in production engine code outside the endpoint
 * module, naming each by file and line, and leaves test items, test
 * directories, comments and the endpoint module alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-intervals-paths.mjs');
const SRC = 'modules/veloqrs/rust/veloqrs/src';

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'intervals-paths-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, SRC, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const lapsPath = '    let path = format!("/activity/{}/laps", id);';

it('fails a path built and a request sent from production code', () => {
  const root = fixture({
    'objects/ledger.rs': [
      'pub async fn laps(t: &Transport, id: &str) -> Vec<u8> {',
      lapsPath,
      '    t',
      '        .get_bytes(&path, &[], Lane::Backfill)',
      '        .await',
      '        .unwrap()',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/objects/ledger.rs:2`);
  expect(output).toContain(`${SRC}/objects/ledger.rs:4`);
});

it('fails a typed request call and an athlete path', () => {
  const root = fixture({
    'objects/ledger.rs': [
      'async fn rows(t: &Transport) {',
      '    let _: Vec<Row> = t.get_json::<Vec<Row>>("/athlete/me", &[], Lane::Backfill).await;',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/objects/ledger.rs:2`);
});

it('reads the line a refusal sits on past a test module above it', () => {
  const root = fixture({
    'objects/ledger.rs': [
      '#[cfg(test)]',
      'mod tests {',
      '    fn a() {}',
      '}',
      '',
      'fn laps(id: &str) -> String {',
      lapsPath,
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/objects/ledger.rs:7`);
});

it('passes the same literal in test code, a comment and the endpoint module', () => {
  const root = fixture({
    'objects/ledger.rs': [
      '/// Fetches `"/activity/{id}/laps"` through the endpoint module.',
      '// t.get_bytes("/activity/x", &[], lane)',
      '/* "/athlete/me" */',
      'pub fn url() -> &\'static str { "https://example.test/activity" }',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    fn mock(id: &str) {',
      lapsPath,
      '        t.get_bytes(&path, &[], Lane::Backfill);',
      '    }',
      '}',
    ].join('\n'),
    'objects/tests/ledger.rs': lapsPath,
    'objects/tests.rs': lapsPath,
    'net/intervals/endpoints.rs': [
      'pub async fn laps(t: &Transport, id: &str) -> Vec<u8> {',
      lapsPath,
      '    t.get_bytes(&path, &[], Lane::Backfill).await.unwrap()',
      '}',
    ].join('\n'),
    'net/transport.rs': [
      'pub async fn get_json<T>(&self) -> T {',
      '    let body = self.get_bytes(path, query, dispatch).await?;',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(output).toContain('every request is built in the endpoint module');
  expect(status).toBe(0);
});

it('fails a path literal in the transport, which owns the calls and not the paths', () => {
  const root = fixture({
    'net/transport.rs': `fn probe() -> &'static str { "/athlete/me" }`,
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/net/transport.rs:1`);
});

it('fails a Garmin service path built outside the Garmin endpoint module and passes it inside', () => {
  const stray = fixture({
    'objects/ledger.rs': 'const LIST: &str = "/activitylist-service/activities/search/activities";',
  });
  const strayRun = runGuard(stray);
  expect(strayRun.status).toBe(1);
  expect(strayRun.output).toContain(`${SRC}/objects/ledger.rs:1`);

  const owned = fixture({
    'net/garmin/endpoints.rs': [
      'const LIST: &str = "/activitylist-service/activities/search/activities";',
      'async fn page(t: &Transport) { t.get_json::<Vec<u8>>(LIST, &[], Lane::Garmin).await; }',
    ].join('\n'),
  });
  expect(runGuard(owned).status).toBe(0);
});
