/**
 * Scenario: auto-pause engages after three seconds under 2 km/h, which a phone
 * on a desk always is, so the control bar shows Resume rather than Pause. Four
 * flows waited for `control-pause` after the unlock swipe and failed on it.
 * Expected behaviour: a recording flow proves the bar came back with
 * `control-stop`, which both bars render, and taps Pause only when the bar is
 * actually showing it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';

const MAESTRO_DIR = path.resolve(__dirname, '../../../.maestro');

const recordingFlows = fs
  .readdirSync(MAESTRO_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .filter((f) => fs.readFileSync(path.join(MAESTRO_DIR, f), 'utf8').includes('pack-recording'))
  .sort();

/** The commands of a flow, which sit in the second YAML document. */
function commandsOf(file: string): unknown[] {
  const body = fs.readFileSync(path.join(MAESTRO_DIR, file), 'utf8');
  const steps = body.split(/^---$/m).slice(1).join('---');
  return (parseDocument(steps).toJS() ?? []) as unknown[];
}

/** Every `{command: value}` pair in a flow, nested `runFlow` blocks included. */
function steps(
  node: unknown,
  guard: string | null = null
): { kind: string; body: unknown; guard: string | null }[] {
  if (Array.isArray(node)) return node.flatMap((child) => steps(child, guard));
  if (!node || typeof node !== 'object') return [];

  const entries = Object.entries(node as Record<string, unknown>);
  return entries.flatMap(([kind, body]) => {
    if (kind !== 'runFlow') return [{ kind, body, guard }];

    const block = (body ?? {}) as Record<string, unknown>;
    const when = (block.when ?? {}) as Record<string, unknown>;
    const visible = when.visible as Record<string, unknown> | string | undefined;
    const inner =
      typeof visible === 'string' ? visible : ((visible?.id as string | undefined) ?? guard);
    return steps(block.commands, inner ?? guard);
  });
}

function idOf(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const held = body as Record<string, unknown>;
    const visible = held.visible as Record<string, unknown> | undefined;
    return (held.id ?? visible?.id) as string | undefined;
  }
  return undefined;
}

describe('the recording flows survive auto-pause', () => {
  it('has recording flows to guard', () => {
    expect(recordingFlows.length).toBeGreaterThan(0);
  });

  it.each(recordingFlows)('%s never waits for Pause, which the bar may not show', (file) => {
    const waits = steps(commandsOf(file))
      .filter(({ kind }) => kind === 'extendedWaitUntil' || kind === 'assertVisible')
      .map(({ body }) => idOf(body));

    expect(waits).not.toContain('control-pause');
  });

  it.each(recordingFlows)('%s taps Pause only where Pause is on screen', (file) => {
    const unguarded = steps(commandsOf(file))
      .filter(({ kind, body }) => kind === 'tapOn' && idOf(body) === 'control-pause')
      .filter(({ guard }) => guard !== 'control-pause');

    expect(unguarded).toEqual([]);
  });
});
