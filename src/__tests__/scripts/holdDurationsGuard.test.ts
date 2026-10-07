import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-hold-durations.mjs');

function check(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'hold-durations-'));
  const file = join(root, 'src/Press.tsx');
  mkdirSync(join(root, 'src'));
  writeFileSync(file, source);
  try {
    execFileSync('node', [script, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: false, output: '' };
  } catch (error) {
    const failure = error as { stderr?: Buffer };
    return { failed: true, output: failure.stderr?.toString() ?? '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it.each([
  '<Pressable delayLongPress={350} />',
  'Gesture.LongPress().minDuration(200)',
  'Gesture.Pan().activateAfterLongPress(500)',
])('refuses a local numeric hold in %s', (source) => {
  const result = check(source);
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/Press.tsx:1');
});

it('accepts the named hold classes', () => {
  const result = check(`
    <Pressable delayLongPress={DELIBERATE_HOLD_MS} />;
    Gesture.LongPress().minDuration(PREVIEW_HOLD_MS);
    Gesture.Pan().activateAfterLongPress(CONFIRM_HOLD_MS);
  `);
  expect(result.failed).toBe(false);
});
