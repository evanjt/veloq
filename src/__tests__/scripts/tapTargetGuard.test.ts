import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const GUARD = join(REPO, 'scripts/lint-tap-targets.mjs');

function check(source: string) {
  mkdirSync(join(REPO, '.jest-cache'), { recursive: true });
  const root = mkdtempSync(join(REPO, '.jest-cache/tap-target-'));
  const file = join(root, 'src/features/example/Chip.tsx');
  mkdirSync(join(root, 'src/features/example'), { recursive: true });
  mkdirSync(join(root, 'src/theme'), { recursive: true });
  writeFileSync(
    join(root, 'src/theme/spacing.ts'),
    'export const MIN_TAP_TARGET = { ios: 44, android: 48 };'
  );
  writeFileSync(file, source);
  try {
    const invocation = `process.argv = ['node', ${JSON.stringify(GUARD)}, '--root', ${JSON.stringify(root)}]; await import(${JSON.stringify(GUARD)});`;
    const result = spawnSync('node', ['--input-type=module', '-e', invocation], {
      cwd: root,
      encoding: 'utf8',
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('tap target guard', () => {
  it('refuses a short pressable style without hit slop', () => {
    const result = check(`
      const styles = StyleSheet.create({ chip: { width: 32, height: 26 } });
      export const Chip = () => <Pressable style={pressable(styles.chip)} onPress={go} />;
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain('src/features/example/Chip.tsx');
    expect(result.output).toContain('width');
    expect(result.output).toContain('height');
  });

  it('accepts hit slop or a full sized style', () => {
    expect(
      check(`
        const styles = StyleSheet.create({ chip: { width: 32, height: 26 } });
        export const Chip = () => <Pressable style={pressable(styles.chip)} hitSlop={slop} />;
      `).status
    ).toBe(0);
    expect(check('<Pressable style={pressable({ minWidth: 48, minHeight: 48 })} />').status).toBe(
      0
    );
  });

  it('refuses a short dimension held in a local constant', () => {
    const result = check(`
      const CHIP_SIZE = 32;
      const styles = StyleSheet.create({ chip: { width: CHIP_SIZE, height: CHIP_SIZE } });
      export const Chip = () => <Pressable style={pressable(styles.chip)} />;
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain('width, height');
  });

  it('accepts a large width even when minWidth is lower', () => {
    const result = check('<Pressable style={pressable({ width: 60, minWidth: 20 })} />');
    expect(result.status).toBe(0);
  });
});
