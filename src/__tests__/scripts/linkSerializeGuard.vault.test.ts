/**
 * Scenario: a method of the remote link returns an engine record, which
 * serde writes as JSON. A record that cannot be serialised stops that method
 * at compile time, and a byte field written by default becomes an array of
 * numbers three to four times the size of its base64 string.
 *
 * Expected behaviour: the guard fails a uniffi record or enum that does not
 * derive Serialize, and a byte field that does not name the base64 module. It
 * leaves a record that does both alone, however its derive is wrapped.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-link-serialize.mjs');
const SOURCES = 'modules/veloqrs/rust/veloqrs/src';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(rust: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'link-serialize-'));
  roots.push(root);
  mkdirSync(join(root, SOURCES), { recursive: true });
  writeFileSync(join(root, SOURCES, 'ffi_types.rs'), rust);
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

it('fails a record that derives uniffi but not Serialize', () => {
  const { status, output } = runGuard(
    ['#[derive(Debug, Clone, uniffi::Record)]', 'pub struct Lap {', '    pub secs: f64,', '}'].join(
      '\n'
    )
  );
  expect(status).toBe(1);
  expect(output).toContain('ffi_types.rs:1  Lap derives uniffi but not serde::Serialize');
});

it('fails an enum that derives uniffi but not Serialize', () => {
  expect(
    runGuard('#[derive(Clone, Copy, uniffi::Enum)]\npub enum Gear {\n    Low,\n}\n').status
  ).toBe(1);
});

it('fails a byte field written as an array of numbers, optional or not', () => {
  const rust = [
    '#[derive(Debug, serde::Serialize, uniffi::Record)]',
    'pub struct Trace {',
    '    /// Encoded points.',
    '    pub points: Vec<u8>,',
    '    pub spare: Option<Vec<u8>>,',
    '}',
  ].join('\n');
  const { status, output } = runGuard(rust);
  expect(status).toBe(1);
  expect(output).toContain('Trace.pub points: Vec<u8>');
  expect(output).toContain('Trace.pub spare: Option<Vec<u8>>');
});

it('passes a record whose derive is wrapped and whose bytes name the base64 module', () => {
  const rust = [
    '#[derive(',
    '    Debug, Clone, serde::Serialize, uniffi::Record,',
    ')]',
    '#[serde(rename_all = "camelCase")]',
    'pub struct Trace {',
    '    /// Encoded points.',
    '    #[serde(with = "crate::remote::bytes")]',
    '    pub points: Vec<u8>,',
    '    #[serde(with = "crate::remote::bytes::option")]',
    '    pub spare: Option<Vec<u8>>,',
    '    pub shade: u8,',
    '}',
    '',
    '#[derive(Debug, serde::Serialize, uniffi::Enum)]',
    'pub enum Gear {',
    '    Low,',
    '}',
  ].join('\n');
  expect(runGuard(rust).status).toBe(0);
});

it('ignores a type that is not exported over uniffi', () => {
  expect(runGuard('#[derive(Debug)]\npub struct Inner {\n    pub raw: Vec<u8>,\n}\n').status).toBe(
    0
  );
});

it('reads an empty record as having no fields, so a later plain struct is not its body', () => {
  const rust = [
    '#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]',
    'pub struct Ask {}',
    '',
    '#[derive(Debug, Clone)]',
    'pub struct Message {',
    '    pub bytes: Vec<u8>,',
    '}',
  ].join('\n');
  expect(runGuard(rust)).toMatchObject({ status: 0 });
});

it('still reads the fields of a record whose brace opens on the next line', () => {
  const rust = [
    '#[derive(Debug, serde::Serialize, uniffi::Record)]',
    'pub struct Trace',
    '{',
    '    pub points: Vec<u8>,',
    '}',
  ].join('\n');
  const { status, output } = runGuard(rust);
  expect(status).toBe(1);
  expect(output).toContain('Trace.pub points: Vec<u8>');
});
