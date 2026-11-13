/**
 * Scenario: React Native `Animated` and `LayoutAnimation` read neither iOS
 * Reduce Motion nor, for springs and layout changes, Android Remove
 * animations, so a call made straight to them moves for an athlete who asked
 * for no motion.
 *
 * Expected behaviour: a timing, spring, loop or layout animation under `src`
 * outside the shared reduce-motion primitives fails and names the file and the
 * primitive to use. The primitives' own file and the test tree pass, and so
 * does a composition such as `Animated.sequence` of primitives.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-reduce-motion.mjs');
const OWNER = 'src/shared/ui/reduceMotion.tsx';

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-motion-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string) {
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const FILE = 'src/features/garden/Sprinkler.tsx';

describe('the reduce-motion guard', () => {
  it('refuses a layout animation, naming the file and the shared primitives', () => {
    const root = treeWith({
      [FILE]:
        'const open = () => {\n  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);\n};\n',
    });
    const run = runGuard(root);

    expect(run.status).toBe(1);
    expect(run.output).toContain(`${FILE}:2`);
    expect(run.output).toContain(OWNER);
  });

  it.each([
    ['a timing', 'Animated.timing(value, { toValue: 1, duration: 300 }).start();'],
    ['a spring', 'Animated.spring(value, { toValue: 0 }).start();'],
    ['a loop', 'Animated.loop(pulse).start();'],
    ['a call split across lines', 'Animated\n  .timing(value, { toValue: 1 })\n  .start();'],
  ])('refuses %s straight on Animated', (_, body) => {
    const root = treeWith({ [FILE]: `${body}\n` });

    expect(runGuard(root).status).toBe(1);
  });

  it('passes the primitives and a composition of them', () => {
    const root = treeWith({
      [FILE]:
        'Animated.sequence([motionTiming(v, { toValue: 1, duration: 150 }), motionSpring(v, { toValue: 0 })]).start();\n',
    });

    expect(runGuard(root).status).toBe(0);
  });

  it('passes the primitives in their own file and anything under the test tree', () => {
    const root = treeWith({
      [OWNER]: 'export const motionLoop = (a, c) => Animated.loop(a, c);\n',
      'src/__tests__/a.test.ts': 'Animated.timing(value, { toValue: 1 }).start();\n',
    });

    expect(runGuard(root).status).toBe(0);
  });

  it('does not read a comment that names the call', () => {
    const root = treeWith({
      [FILE]:
        '// Replaces LayoutAnimation.configureNext, which ignored the setting.\nexport const a = 1;\n',
    });

    expect(runGuard(root).status).toBe(0);
  });
});
