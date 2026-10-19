/**
 * Expected behaviour: the guard fails production engine code outside the
 * intervals module that names one of the endpoint module's requests, by a
 * path or an import, naming each by file and line. It leaves the endpoint
 * module's constants, types and parsers alone, and test items, test
 * directories, comments and the intervals module itself.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-intervals-source.mjs');
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

const ENDPOINTS = [
  'pub const LAP_TYPES: &str = "lap";',
  'pub struct LapPage;',
  'pub fn split_laps(bytes: &[u8]) -> Vec<Lap> { todo!() }',
  'pub async fn fetch_laps(t: &Transport, id: &str) -> Result<Vec<u8>, NetError> {',
  '    t.get_bytes(&format!("/activity/{id}/laps"), &[], Lane::Backfill).await',
  '}',
  'pub async fn rename_lap(t: &Transport, id: &str) -> Result<(), NetError> { todo!() }',
].join('\n');

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'intervals-source-'));
  roots.push(root);
  for (const [path, contents] of Object.entries({
    'net/intervals/endpoints.rs': ENDPOINTS,
    ...files,
  })) {
    const full = join(root, SRC, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails a request called by its path from outside the intervals module', () => {
  const root = fixture({
    'objects/ledger.rs': [
      'use crate::net::intervals::endpoints;',
      '',
      'async fn laps(t: &Transport) {',
      '    let _ = endpoints::fetch_laps(t, "a1").await;',
      '    let _ = crate::net::endpoints::rename_lap(t, "a1").await;',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/objects/ledger.rs:4`);
  expect(output).toContain(`${SRC}/objects/ledger.rs:5`);
  expect(output).not.toContain(`${SRC}/objects/ledger.rs:1`);
});

it('fails a request imported by name, inside a group across lines', () => {
  const root = fixture({
    'net/backfill.rs': [
      'use crate::net::intervals::endpoints::{',
      '    LAP_TYPES,',
      '    fetch_laps,',
      '};',
      'use crate::net::intervals::endpoints::rename_lap as rename;',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/net/backfill.rs:3`);
  expect(output).toContain(`${SRC}/net/backfill.rs:5`);
  expect(output).not.toContain(`${SRC}/net/backfill.rs:2`);
});

it('fails a glob import, which brings every request in', () => {
  const root = fixture({
    'net/backfill.rs': 'use crate::net::intervals::endpoints::*;',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/net/backfill.rs:1`);
});

it('passes constants, types and parsers, test code, comments and the intervals module', () => {
  const root = fixture({
    'objects/ledger.rs': [
      'use crate::net::intervals::endpoints::{LAP_TYPES, LapPage, split_laps};',
      '/// Asks `endpoints::fetch_laps` through the session.',
      '// endpoints::rename_lap(t, id)',
      '/* endpoints::fetch_laps */',
      'fn page(b: &[u8]) -> usize { endpoints::split_laps(b).len() + LAP_TYPES.len() }',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    fn mock(t: &Transport) {',
      '        let _ = endpoints::fetch_laps(t, "a1");',
      '    }',
      '}',
    ].join('\n'),
    'objects/tests/ledger.rs': 'fn a(t: &Transport) { let _ = endpoints::fetch_laps(t, "a1"); }',
    'objects/tests.rs': 'fn a(t: &Transport) { let _ = endpoints::fetch_laps(t, "a1"); }',
    'net/intervals/mod.rs': [
      'pub mod endpoints;',
      'impl Source for IntervalsSession {',
      '    async fn laps(&self, id: &str) -> Result<Vec<u8>, NetError> {',
      '        endpoints::fetch_laps(&self.transport, id).await',
      '    }',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(output).toContain('every intervals.icu request goes through the session');
  expect(status).toBe(0);
});

it('refuses to judge a tree with no endpoint module rather than passing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'intervals-source-'));
  roots.push(root);
  mkdirSync(join(root, SRC, 'objects'), { recursive: true });
  writeFileSync(join(root, SRC, 'objects/ledger.rs'), 'fn a() {}');

  const { status } = runGuard(root);

  expect(status).toBe(2);
});

it('fails the intervals.icu session named outside the intervals module and the live source owner', () => {
  const root = fixture({
    'objects/ledger.rs': [
      'use crate::net::LiveSource;',
      '',
      'fn build_session(&self) -> Result<IntervalsSession, E> {',
      '    Ok(live_source(transport, "a1"))',
      '}',
      'fn hold(s: &crate::net::intervals::IntervalsSession) {}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SRC}/objects/ledger.rs:3`);
  expect(output).toContain(`${SRC}/objects/ledger.rs:6`);
  expect(output).not.toContain(`${SRC}/objects/ledger.rs:1`);
  expect(output).not.toContain(`${SRC}/objects/ledger.rs:4`);
});

it('passes the session named in test code, comments, the intervals module and the owner', () => {
  const root = fixture({
    'objects/ledger.rs': [
      '/// Built over the `IntervalsSession` in production.',
      'fn build_session(&self) -> Result<LiveSource, E> { todo!() }',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    fn build_session(&self) -> Result<IntervalsSession, E> { todo!() }',
      '}',
    ].join('\n'),
    'objects/tests/ledger.rs': 'fn a(t: Transport) { let _ = IntervalsSession::new(t, "a1"); }',
    'net/intervals/mod.rs': 'pub struct IntervalsSession;',
    'net/live.rs': 'pub type LiveSource = super::intervals::IntervalsSession;',
  });

  const { status, output } = runGuard(root);

  expect(output).toContain('every intervals.icu request goes through the session');
  expect(status).toBe(0);
});
