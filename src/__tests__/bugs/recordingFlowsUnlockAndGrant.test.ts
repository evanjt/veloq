/**
 * Scenario: the unlock swipe was placed at a fixed fraction of screen height,
 * which on a taller handset lands on the system bar above the track, so the
 * recording stays locked and every later recording flow fails. The demo setup
 * also granted notifications through `${...}`, which Maestro never evaluates
 * inside `permissions`, so the prompt stayed up over the resume dialog.
 * Expected behaviour: the unlock swipe has one owner, anchored to the handle's
 * test ID so it starts on the track whatever the screen, and every permission
 * value a flow passes is a literal Maestro reads.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';

const MAESTRO_DIR = path.resolve(__dirname, '../../../.maestro');
const UNLOCK_HELPER = 'helpers/unlock-recording.yaml';

/** Every flow file under `.maestro`, helpers included, by relative path. */
function flowFiles(dir = MAESTRO_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return flowFiles(full);
    return entry.name.endsWith('.yaml') ? [path.relative(MAESTRO_DIR, full)] : [];
  });
}

/** The commands of a flow, which sit after its config document. */
function commandsOf(file: string): unknown {
  const body = fs.readFileSync(path.join(MAESTRO_DIR, file), 'utf8');
  if (!/^---$/m.test(body)) return [];
  const steps = body.split(/^---$/m).slice(1).join('---');
  return parseDocument(steps).toJS() ?? [];
}

/** Every `{command: value}` pair in a flow, at any depth. */
function steps(node: unknown): { kind: string; body: unknown }[] {
  if (Array.isArray(node)) return node.flatMap(steps);
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([kind, body]) => [
    { kind, body },
    ...steps(body),
  ]);
}

/** A swipe that names a screen point rather than an element. */
function isCoordinateSwipe(body: unknown): boolean {
  return !!body && typeof body === 'object' && 'start' in body;
}

const files = flowFiles().sort();

describe('the unlock swipe', () => {
  it('is anchored to the handle by test ID', () => {
    const swipes = steps(commandsOf(UNLOCK_HELPER)).filter(({ kind }) => kind === 'swipe');

    expect(swipes.length).toBeGreaterThan(0);
    for (const { body } of swipes) {
      expect(body).toMatchObject({ from: { id: 'unlock-track-handle' }, direction: 'RIGHT' });
    }
  });

  it.each(files.filter((f) => f !== UNLOCK_HELPER))(
    '%s unlocks through the helper rather than a swipe of its own',
    (file) => {
      const ownUnlock = steps(commandsOf(file)).filter(({ kind, body }) => {
        if (kind !== 'runFlow' || !body || typeof body !== 'object') return false;
        const block = body as Record<string, unknown>;
        const when = (block.when ?? {}) as Record<string, unknown>;
        const visible = when.visible as Record<string, unknown> | undefined;
        if (visible?.id !== 'unlock-track') return false;
        return steps(block.commands).some((s) => s.kind === 'swipe' && isCoordinateSwipe(s.body));
      });

      expect(ownUnlock).toEqual([]);
    }
  );
});

describe('launch permissions', () => {
  it.each(files)('%s passes every permission as a literal', (file) => {
    const scripted = steps(commandsOf(file))
      .filter(({ kind }) => kind === 'launchApp')
      .flatMap(({ body }) => {
        const permissions = ((body ?? {}) as Record<string, unknown>).permissions ?? {};
        return Object.entries(permissions as Record<string, unknown>);
      })
      .filter(([, value]) => typeof value !== 'string' || value.includes('${'));

    expect(scripted).toEqual([]);
  });
});
