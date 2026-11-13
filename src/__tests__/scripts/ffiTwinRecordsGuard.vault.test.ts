/**
 * Scenario: an engine record is declared twice, once as the domain struct and
 * once as an `Ffi` copy with a `From` between them, so a field added to one
 * half never reaches the other and nothing fails to compile.
 *
 * Expected behaviour: the guard fails an `FfiX` beside a struct named `X`
 * anywhere in the crate, passes a domain struct that derives the record under
 * the `Ffi` name, passes a twin the baseline lists with a reason, and fails a
 * baseline entry that is no longer a twin or carries no reason.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-ffi-twin-records.mjs');
const CRATE = 'modules/veloqrs/rust/veloqrs/src';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(
  files: Record<string, string>,
  baseline?: Record<string, string>
): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'ffi-twins-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, CRATE, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  if (baseline) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/ffi-twin-records-baseline.json'), JSON.stringify(baseline));
  }
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

const COPY = [
  '#[derive(uniffi::Record)]',
  'pub struct FfiKiln {',
  '    pub glaze: String,',
  '    pub fired_at: f64,',
  '}',
  '',
].join('\n');
const DOMAIN = [
  'pub struct Kiln {',
  '    pub glaze: String,',
  '    pub fired_at: i64,',
  '}',
  '',
].join('\n');
const DERIVED = [
  '#[derive(uniffi::Record)]',
  '#[uniffi(name = "FfiKiln")]',
  'pub struct Kiln {',
  '    pub glaze: String,',
  '    pub fired_at: WholeNumber,',
  '}',
  '',
].join('\n');

it('fails an Ffi copy beside its domain struct, naming both halves', () => {
  const { status, output } = runGuard({ 'ffi_types.rs': COPY, 'pottery/kiln.rs': DOMAIN });

  expect(status).toBe(1);
  expect(output).toContain(`FfiKiln  ${CRATE}/ffi_types.rs:2`);
  expect(output).toContain(`Kiln  ${CRATE}/pottery/kiln.rs:1`);
});

it('fails a copy declared outside ffi_types.rs too', () => {
  expect(runGuard({ 'objects/pottery.rs': COPY, 'pottery/kiln.rs': DOMAIN }).status).toBe(1);
});

it('fails a crate-visible domain struct', () => {
  const crateOnly = DOMAIN.replace('pub struct', 'pub(crate) struct');
  expect(runGuard({ 'ffi_types.rs': COPY, 'pottery/kiln.rs': crateOnly }).status).toBe(1);
});

it('passes a domain struct that derives the record under the Ffi name', () => {
  const { status, output } = runGuard({ 'pottery/kiln.rs': DERIVED });

  expect(status).toBe(0);
  expect(output).toContain('0 listed');
});

it('passes an Ffi record with no domain struct of the same name', () => {
  expect(runGuard({ 'ffi_types.rs': COPY, 'pottery/kiln.rs': '' }).status).toBe(0);
});

it("leaves a test module's own fixtures alone", () => {
  expect(runGuard({ 'ffi_types.rs': COPY, 'pottery/tests/kiln.rs': DOMAIN }).status).toBe(0);
});

it('passes a twin the baseline lists with a reason', () => {
  const { status } = runGuard(
    { 'ffi_types.rs': COPY, 'pottery/kiln.rs': DOMAIN },
    { FfiKiln: 'the wire body against the screen view' }
  );
  expect(status).toBe(0);
});

it('fails a baseline entry that carries no reason', () => {
  const { status, output } = runGuard(
    { 'ffi_types.rs': COPY, 'pottery/kiln.rs': DOMAIN },
    { FfiKiln: ' ' }
  );
  expect(status).toBe(1);
  expect(output).toContain('no reason');
});

it('fails a baseline entry that is no longer a twin, so the list only shrinks', () => {
  const { status, output } = runGuard(
    { 'pottery/kiln.rs': DERIVED },
    { FfiKiln: 'the wire body against the screen view' }
  );
  expect(status).toBe(1);
  expect(output).toContain('no longer twinned');
  expect(output).toContain('FfiKiln');
});

it('refuses a tree with no crate sources rather than reporting it clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-twins-'));
  roots.push(root);
  let status = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', root], { stdio: 'ignore' });
  } catch (error) {
    status = (error as { status: number }).status;
  }
  expect(status).toBe(1);
});
