/**
 * Scenario: the render-time engine read lint runs in `npm run audit`.
 *
 * Expected behaviour: an engine call in a hook or component body fails, one
 * behind a deferring boundary passes, one inside useMemo or a lazy useState
 * initialiser is reported but passes, and a loop variable that happens to be
 * called `engine` is not a read. A clean checkout exits 0, or the gate costs
 * every commit a `--no-verify`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-render-engine-reads.mjs');

function runLint(root?: string, ...flags: string[]): { status: number; output: string } {
  const args = root ? [SCRIPT, '--root', root, ...flags] : [SCRIPT, ...flags];
  try {
    const output = execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const IMPORTS =
  "import { useEffect, useMemo, useState, useCallback } from 'react';\nimport { useQuery } from '@tanstack/react-query';\nimport { getEngine } from '@/shared/native/engine';\n";

describe('render-time engine read lint', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const withHook = (body: string, path = 'src/features/x/hooks/useThing.ts') => {
    const root = mkdtempSync(join(tmpdir(), 'render-reads-'));
    roots.push(root);
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, `${IMPORTS}${body}`);
    return root;
  };

  it('exits 0 on this repo, so the audit gate stays usable', () => {
    expect(runLint().status).toBe(0);
  });

  it('fails a read in the hook body', () => {
    const root = withHook('export function useThing() {\n  return getEngine()?.getStats();\n}\n');
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('useThing.ts:5  useThing  engine.getStats');
  });

  it('fails a read through a const bound to the engine', () => {
    const root = withHook(
      'export function useThing() {\n  const engine = getEngine();\n  const n = engine?.getActivityCount() ?? 0;\n  return n;\n}\n'
    );
    expect(runLint(root).status).toBe(1);
  });

  it('fails a read in a component, and one reached through a local helper', () => {
    const root = withHook(
      'function readCount() {\n  const engine = getEngine();\n  return engine ? engine.getActivityCount() : 0;\n}\nexport function Thing() {\n  const count = readCount();\n  return count;\n}\n',
      'src/features/x/components/Thing.tsx'
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Thing.tsx:9  Thing  engine.getActivityCount  via readCount:6');
  });

  it('fails a bare engine argument to a hook, which is evaluated every render', () => {
    const root = withHook(
      'export function useThing() {\n  const [n] = useState(getEngine()?.getActivityCount() ?? 0);\n  return n;\n}\n'
    );
    expect(runLint(root).status).toBe(1);
  });

  it('passes a read inside a queryFn, a useEffect, a useCallback and an event handler', () => {
    const root = withHook(
      [
        'export function useThing(id: string) {',
        '  const [n, setN] = useState(0);',
        '  useEffect(() => { setN(getEngine()?.getActivityCount() ?? 0); }, []);',
        '  const refresh = useCallback(() => getEngine()?.getStats(), []);',
        '  const onPress = () => { const engine = getEngine(); engine?.triggerRefresh("activities"); };',
        '  useQuery({ queryKey: ["x", id], queryFn: () => getEngine()?.getIntervalBody(id) ?? null });',
        '  return { n, refresh, onPress };',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root);
    expect(status).toBe(0);
    expect(output).toContain('render-time reads: 0');
  });

  it('reports a useMemo read and a lazy initialiser without failing', () => {
    const root = withHook(
      [
        'export function useThing(trigger: number) {',
        '  const [first] = useState(() => getEngine()?.getActivityCount() ?? 0);',
        '  const stats = useMemo(() => getEngine()?.getStats(), [trigger]);',
        '  return { first, stats };',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root, '--verbose');
    expect(status).toBe(0);
    expect(output).toContain('useThing.ts:6  useThing  engine.getStats  deps [trigger]');
    expect(output).toContain('useThing.ts:5  useThing  engine.getActivityCount');
    expect(output).toContain('memo reads: 1, initialiser reads: 1');
  });

  it('ignores a loop variable or field that is merely called engine', () => {
    const root = withHook(
      [
        'export function useThing(engines: { id: string }[]) {',
        '  return useMemo(() => {',
        '    const out: string[] = [];',
        '    for (const engine of engines) out.push(engine.id.toUpperCase());',
        '    return out;',
        '  }, [engines]);',
        '}',
        'export function Plain() {',
        '  const ids: string[] = [];',
        '  for (const engine of [{ id: "a" }]) ids.push(engine.id.trim());',
        '  return ids;',
        '}',
        '',
      ].join('\n')
    );
    const { status, output } = runLint(root, '--verbose');
    expect(status).toBe(0);
    expect(output).toContain('memo reads: 0');
  });

  it('ignores a plain function that is neither a hook nor a component', () => {
    const root = withHook(
      'export function readCount() {\n  return getEngine()?.getActivityCount() ?? 0;\n}\n',
      'src/features/x/lib/read.ts'
    );
    expect(runLint(root).status).toBe(0);
  });

  it('fails on a stale allowlist entry so the list never outlives the debt', () => {
    // A file the real allowlist names, present but without the read it excuses.
    const root = withHook(
      'export function useThing() {\n  return 1;\n}\n',
      'src/features/stats/hooks/usePowerCurve.ts'
    );
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('Stale ALLOWLIST');
  });
});
