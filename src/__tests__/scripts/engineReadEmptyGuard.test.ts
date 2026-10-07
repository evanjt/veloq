/**
 * Scenario: an engine client read catches the `VeloqError` and answers `[]`,
 * `{}`, `''`, `0`, `null` or `undefined`, so its caller reads a failure as
 * nothing there: a 0 B store, an empty list, nothing left to fetch.
 *
 * Expected behaviour: the guard fails each of those answers in a `catch` and in
 * a promise's `.catch`, in the client and in every delegate, and passes a
 * rethrow, a write's `false`, a nested function's own return and a site whose
 * marker gives a reason.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-engine-read-empty.mjs');
const CLIENT = 'modules/veloqrs/src/EngineClient.ts';
const HOOK = 'src/features/orchards/hooks/usePears.ts';
const DELEGATE = 'modules/veloqrs/src/delegates/sections/orchards.ts';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(
  files: Record<string, string>,
  baseline: Record<string, number> = {}
): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'engine-read-empty-'));
  roots.push(root);
  for (const [path, contents] of Object.entries({ [CLIENT]: 'export {};\n', ...files })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  try {
    const baselineFile = join(root, 'baseline.json');
    writeFileSync(baselineFile, JSON.stringify(baseline));
    const output = execFileSync('node', [SCRIPT, '--root', root, '--baseline', baselineFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const readWith = (answer: string) =>
  [
    'export function countPears(host: Host): number {',
    '  try {',
    '    return host.engine.orchards().countPears();',
    '  } catch (e) {',
    "    console.error('countPears failed', e);",
    `    return ${answer};`,
    '  }',
    '}',
  ].join('\n');

it.each(['[]', '{}', "''", '""', '0', 'null', 'undefined', '[] as string[]'])(
  'fails a delegate catch answering %s',
  (answer) => {
    const { status, output } = runGuard({ [DELEGATE]: readWith(answer) });

    expect(status).toBe(1);
    expect(output).toContain(`orchards.ts:6`);
  }
);

it('fails the same catch in the client itself', () => {
  const client = [
    'export class EngineClient {',
    '  listPlots(): string[] {',
    '    try {',
    '      return this.engine.listPlots();',
    '    } catch {',
    '      return [];',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const { status, output } = runGuard({ [CLIENT]: client });

  expect(status).toBe(1);
  expect(output).toContain('EngineClient.ts:6');
});

it("fails a promise's .catch that answers an empty value", () => {
  const source = [
    'export function plotNames(host: Host): Promise<string[]> {',
    '  return host.engine.plotNames().catch(() => []);',
    '}',
  ].join('\n');

  expect(runGuard({ [DELEGATE]: source }).status).toBe(1);
});

it('passes a read that lets the error through', () => {
  const source = [
    'export function countPears(host: Host): number {',
    '  if (!host.ready) return 0;',
    '  return host.engine.orchards().countPears();',
    '}',
  ].join('\n');

  expect(runGuard({ [DELEGATE]: source }).status).toBe(0);
});

it('passes a write that answers false', () => {
  expect(runGuard({ [DELEGATE]: readWith('false') }).status).toBe(0);
});

it('passes a catch that rethrows after logging', () => {
  const source = [
    'export function countPears(host: Host): number {',
    '  try {',
    '    return host.engine.orchards().countPears();',
    '  } catch (e) {',
    "    console.error('countPears failed', e);",
    '    throw e;',
    '  }',
    '}',
  ].join('\n');

  expect(runGuard({ [DELEGATE]: source }).status).toBe(0);
});

it("leaves a nested function's own return alone", () => {
  const source = [
    'export function countPears(host: Host): () => number[] {',
    '  try {',
    '    return host.engine.orchards().countPears();',
    '  } catch (e) {',
    '    const later = () => [];',
    '    throw Object.assign(e as Error, { later });',
    '  }',
    '}',
  ].join('\n');

  expect(runGuard({ [DELEGATE]: source }).status).toBe(0);
});

it('passes a site whose marker gives a reason', () => {
  const source = readWith('null').replace(
    '  } catch (e) {',
    '  } catch (e) {\n    // empty-on-error: a write; null is its failure and a record its outcome.'
  );

  expect(runGuard({ [DELEGATE]: source }).status).toBe(0);
});

it('fails a marker that gives no reason', () => {
  const source = readWith('null').replace(
    '  } catch (e) {',
    '  } catch (e) {\n    // empty-on-error:'
  );

  const { status, output } = runGuard({ [DELEGATE]: source });
  expect(status).toBe(1);
  expect(output).toContain('gives no reason');
});

it('refuses a tree with no client, rather than reporting it clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-read-empty-'));
  roots.push(root);

  let status = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', root], { stdio: 'ignore' });
  } catch (error) {
    status = (error as { status: number }).status;
  }
  expect(status).toBe(1);
});

describe('feature hooks', () => {
  it('fails a hook catch answering an empty value', () => {
    const { status, output } = runGuard({ [HOOK]: readWith('[]') });

    expect(status).toBe(1);
    expect(output).toContain('usePears.ts:6');
  });

  it('fails a hook written as a component file', () => {
    const { status } = runGuard({
      'src/features/orchards/hooks/usePears.tsx': readWith('null'),
    });

    expect(status).toBe(1);
  });

  it('leaves a file that is not a hook alone', () => {
    const { status } = runGuard({ 'src/features/orchards/components/pears.ts': readWith('[]') });

    expect(status).toBe(0);
  });

  it('fails a lib file that reaches the engine and answers empty', () => {
    const lib = `import { getEngine } from '@/shared/native/engine';\n${readWith('[]')}`;
    const { status, output } = runGuard({ 'src/features/orchards/lib/pears.ts': lib });

    expect(status).toBe(1);
    expect(output).toContain('pears.ts:7');
  });

  it('leaves a lib file that never reaches the engine alone', () => {
    const { status } = runGuard({ 'src/features/orchards/lib/pears.ts': readWith('[]') });

    expect(status).toBe(0);
  });

  it('passes a hook whose marker gives a reason', () => {
    const source = readWith('null').replace(
      '  } catch (e) {',
      '  } catch (e) {\n    // empty-on-error: an optional overlay the screen draws without.'
    );

    expect(runGuard({ [HOOK]: source }).status).toBe(0);
  });

  it('passes a hook the baseline still carries, and fails one more than it allows', () => {
    expect(runGuard({ [HOOK]: readWith('[]') }, { [HOOK]: 1 }).status).toBe(0);

    const two = `${readWith('[]')}\n${readWith('null').replace('countPears', 'countPlums')}`;
    expect(runGuard({ [HOOK]: two }, { [HOOK]: 1 }).status).toBe(1);
  });

  it('fails a baseline entry the hook has since beaten, so the ground stays taken', () => {
    const { status, output } = runGuard({ [HOOK]: 'export {};\n' }, { [HOOK]: 1 });

    expect(status).toBe(1);
    expect(output).toContain('baseline');
  });
});

describe('a query hook that drops its error', () => {
  const hookWith = (body: string) =>
    [
      "import { useQuery } from '@tanstack/react-query';",
      'export function usePears() {',
      '  const query = useQuery({ queryKey: [1], queryFn: () => readPears() });',
      body,
      '}',
    ].join('\n');

  it('fails a hook returning data ?? [] without the error', () => {
    const { status, output } = runGuard({
      [HOOK]: hookWith('  return query.data ?? [];'),
    });
    expect(status).toBe(1);
    expect(output).toContain('usePears.ts');
  });

  it('fails the same shape when data is destructured', () => {
    const { status } = runGuard({
      [HOOK]: [
        "import { useQuery } from '@tanstack/react-query';",
        'export function usePears() {',
        '  const { data } = useQuery({ queryKey: [1], queryFn: () => readPears() });',
        '  return data ?? [];',
        '}',
      ].join('\n'),
    });
    expect(status).toBe(1);
  });

  it('passes a hook that hands the error back', () => {
    const { status } = runGuard({
      [HOOK]: [
        "import { useQuery } from '@tanstack/react-query';",
        'export function usePears() {',
        '  const { data, error } = useQuery({ queryKey: [1], queryFn: () => readPears() });',
        '  return { pears: data ?? [], error };',
        '}',
      ].join('\n'),
    });
    expect(status).toBe(0);
  });

  it('passes a reasoned marker', () => {
    const { status } = runGuard({
      [HOOK]: hookWith(
        '  // empty-on-error: a best-effort label with nothing to show\n  return query.data ?? [];'
      ),
    });
    expect(status).toBe(0);
  });
});
