import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-gesture-callbacks.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'gesture-callbacks-'));
  for (const [rel, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), source);
  }
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

it('passes a worklet that hands over a relay', () => {
  const source = [
    'const onSwipe = useGestureCallback(handleSwipe);',
    "const pan = Gesture.Pan().onEnd(() => { 'worklet'; runOnJS(onSwipe)(1); });",
    '',
  ].join('\n');
  expect(check({ 'src/features/Pager.tsx': source }).failed).toBe(false);
});

it.each([
  'runOnJS(handleSwipe)(1);',
  'runOnJS(props.onChange)(1);',
  'runOnJS(() => setOpen(false))();',
  'scheduleOnRN(handleSwipe, 1);',
])('refuses %s and names the file and line', (line) => {
  const result = check({
    'src/features/Pager.tsx': `const onSwipe = useGestureCallback(handleSwipe);\n${line}\n`,
  });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Pager.tsx:2');
});

it('passes a gesture told to run its callbacks on the JS thread, and a test file', () => {
  const result = check({
    'src/app/map.tsx': 'const tap = Gesture.Tap().runOnJS(true);\n',
    'src/__tests__/Pager.test.tsx': 'runOnJS(handleSwipe)(1);\n',
  });
  expect(result.failed).toBe(false);
});
