import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const GUARD = join(REPO, 'scripts/lint-tap-targets.mjs');

function check(source: string, path = 'src/features/example/Chip.tsx') {
  mkdirSync(join(REPO, '.jest-cache'), { recursive: true });
  const root = mkdtempSync(join(REPO, '.jest-cache/tap-target-'));
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(join(root, 'src/theme'), { recursive: true });
  writeFileSync(
    join(root, 'src/theme/spacing.ts'),
    [
      'export const spacing = { xxs: 2, xs: 4, sm: 8 } as const;',
      'export const MIN_TAP_TARGET = { ios: 44, android: 48 };',
    ].join('\n')
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

  it('refuses a literal hit slop, which says nothing about the size it reaches', () => {
    const bare = check(`
      const styles = StyleSheet.create({ chip: { height: 26 } });
      export const Chip = () => <Pressable hitSlop={4} style={pressable(styles.chip)} />;
    `);
    expect(bare.status).toBe(1);
    expect(bare.output).toContain('src/features/example/Chip.tsx:3: literal hitSlop');

    const sides = check(
      '<Pressable onPress={go} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} />'
    );
    expect(sides.status).toBe(1);
    expect(sides.output).toContain('literal hitSlop');

    const constant = check(`
      const SLOP = 10;
      export const Chip = () => <TouchableOpacity hitSlop={SLOP} onPress={go} />;
    `);
    expect(constant.status).toBe(1);
    expect(constant.output).toContain('literal hitSlop');

    const mixed = check('<Pressable hitSlop={{ top: spacing.md, bottom: 4 }} onPress={go} />');
    expect(mixed.status).toBe(1);
  });

  it('accepts a hit slop computed to the floor', () => {
    expect(
      check(`
        const styles = StyleSheet.create({ chip: { height: 16 } });
        export const Chip = () => (
          <Pressable hitSlop={slopToMinTapTarget(16)} style={pressable(styles.chip)} />
        );
      `).status
    ).toBe(0);
    expect(check('<Pressable hitSlop={CHIP_SLOP} onPress={go} />').status).toBe(0);
  });

  it('accepts a large width even when minWidth is lower', () => {
    const result = check('<Pressable style={pressable({ width: 60, minWidth: 20 })} />');
    expect(result.status).toBe(0);
  });

  it('refuses a pressable sized only by thin vertical padding', () => {
    const result = check(`
      const styles = StyleSheet.create({ pill: { paddingVertical: spacing.xs, paddingHorizontal: 12 } });
      export const Pill = () => <Pressable style={pressable(styles.pill)} onPress={go} />;
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain('src/features/example/Chip.tsx:3: padding');
  });

  it('refuses thin padding written as top and bottom or as all-round padding', () => {
    expect(
      check('<Pressable style={pressable({ paddingTop: spacing.xxs, paddingBottom: 4 })} />').status
    ).toBe(1);
    expect(check('<Pressable style={pressable({ padding: spacing.xxs })} />').status).toBe(1);
  });

  it('accepts thin padding that reaches the floor through min height or hit slop', () => {
    expect(
      check(
        '<Pressable style={pressable({ paddingVertical: spacing.xs, minHeight: layout.minTapTarget })} />'
      ).status
    ).toBe(0);
    expect(
      check(
        '<Pressable style={pressable({ paddingVertical: spacing.xs })} hitSlop={slopToMinTapTarget(20)} />'
      ).status
    ).toBe(0);
  });

  it('accepts a pressable whose vertical padding is above the thin rung', () => {
    expect(check('<Pressable style={pressable({ paddingVertical: spacing.sm })} />').status).toBe(
      0
    );
  });

  it('refuses a text that takes a press itself', () => {
    const result = check(`
      export const Note = () => (
        <View>
          <Text onPress={open}>Read more</Text>
        </View>
      );
    `);
    expect(result.status).toBe(1);
    expect(result.output).toContain('src/features/example/Chip.tsx:4: text onPress');
  });

  it('accepts a pressed text inside the shared link component', () => {
    expect(
      check(
        'export const InlineLink = (p) => <Text onPress={p.onPress}>{p.children}</Text>;',
        'src/shared/ui/TextLink.tsx'
      ).status
    ).toBe(0);
  });
});
