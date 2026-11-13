/**
 * Scenario: a translator writes a bottom tab label that is wider than one tab, a fifth of the
 * narrowest phone, at the largest text scale the app allows. The tab ends it in an ellipsis and
 * the athlete reads half a destination name.
 *
 * Expected behaviour: the guard estimates every locale's label for each key the tab bar draws and
 * refuses one over the budget, naming the locale, key and value. Full-width glyphs count a whole
 * em. A long value under a key the tab bar does not draw passes, and a tab bar with no keys the
 * guard can read refuses rather than reporting a clean tree.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/lint-tab-label-budget.mjs');

const TAB_BAR = `const MENU_ITEMS = [
  { key: 'feed', icon: 'home-outline', route: '/' },
  { key: 'insights', icon: 'lightbulb-outline', route: '/insights' },
] as const;
`;

function check(
  locales: Record<string, object>,
  tabBar = TAB_BAR
): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'tab-label-budget-'));
  try {
    mkdirSync(join(root, 'src/shared/ui'), { recursive: true });
    writeFileSync(join(root, 'src/shared/ui/BottomTabBar.tsx'), tabBar);
    const dir = join(root, 'src/i18n/locales');
    mkdirSync(dir, { recursive: true });
    for (const [name, bundle] of Object.entries(locales)) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(bundle));
    }
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('bottom tab label budget', () => {
  it('accepts short labels in every locale', () => {
    const result = check({
      'en-GB': { navigation: { feed: 'Feed', insights: 'Insights' } },
      xx: { navigation: { feed: 'Kondition', insights: 'Einblicke' } },
    });
    expect(result.output).toBe('Every bottom tab label fits its tab.\n');
    expect(result.status).toBe(0);
  });

  it('refuses a label that truncates even at the default text size', () => {
    const result = check({ xx: { navigation: { feed: 'Feed', insights: 'Approfondimenti' } } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('xx: navigation.insights "Approfondimenti"');
  });

  it('refuses a label that fits at the default size and truncates at the largest', () => {
    const result = check({ xx: { navigation: { feed: 'Gesundheit', insights: 'Analizy' } } });
    expect(result.status).toBe(1);
    expect(result.output).toContain('xx: navigation.feed "Gesundheit"');
    expect(result.output).not.toContain('Analizy');
  });

  it('counts a full-width glyph as a whole em', () => {
    const wide = check({ xx: { navigation: { feed: 'フィットネス', insights: '分析' } } });
    expect(wide.status).toBe(1);
    expect(wide.output).toContain('xx: navigation.feed "フィットネス"');
    expect(wide.output).not.toContain('分析');
  });

  it('judges only the keys the tab bar draws', () => {
    const result = check({
      xx: { navigation: { feed: 'Feed', insights: 'Insights', settings: 'Configuraciones' } },
    });
    expect(result.status).toBe(0);
  });

  it('refuses a tab bar it reads no keys from', () => {
    const result = check({ xx: { navigation: { feed: 'Feed' } } }, 'export const MENU = [];\n');
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/read no tab keys/);
  });

  it('refuses a tree with no locale bundles', () => {
    const result = check({});
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/read nothing/);
  });
});
