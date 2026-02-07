/**
 * Render budget regression guard.
 *
 * Source-code analysis tests that verify:
 * - Chart components are React.memo wrapped
 * - Tab screens have logScreenRender instrumentation
 * - No inline padding/domain objects in chart files (already extracted)
 * - Zustand stores accessed via individual selectors
 * - FlatList used for large dynamic lists
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../');

function readComponent(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf-8');
}

function expectMemoExport(source: string, componentName: string): void {
  const memoPattern = new RegExp(
    `export\\s+const\\s+${componentName}\\s*=\\s*(?:React\\.)?memo\\(`
  );
  expect(source).toMatch(memoPattern);
}

describe('Render budget', () => {
  describe('chart component memoization', () => {
    const chartComponents = [
      { file: 'components/activity/ActivityDataChart.tsx', name: 'ActivityDataChart' },
      { file: 'components/fitness/FitnessFormChart.tsx', name: 'FitnessFormChart' },
      { file: 'components/home/MiniFormChart.tsx', name: 'MiniFormChart' },
      { file: 'components/home/SummaryCardSparkline.tsx', name: 'SummaryCardSparkline' },
    ];

    for (const { file, name } of chartComponents) {
      it(`${name} is wrapped in React.memo`, () => {
        const source = readComponent(file);
        expectMemoExport(source, name);
      });
    }
  });

  describe('tab screen instrumentation', () => {
    const tabScreens = [
      { file: 'app/(tabs)/index.tsx', name: 'FeedScreen' },
      { file: 'app/(tabs)/map.tsx', name: 'MapScreen' },
      { file: 'app/(tabs)/routes.tsx', name: 'RoutesScreen' },
      { file: 'app/(tabs)/training.tsx', name: 'TrainingScreen' },
      { file: 'app/(tabs)/fitness.tsx', name: 'FitnessScreen' },
    ];

    for (const { file, name } of tabScreens) {
      it(`${name} uses logScreenRender`, () => {
        const source = readComponent(file);
        expect(source).toContain('logScreenRender');
      });
    }
  });

  describe('chart constant extraction (no inline allocations)', () => {
    // These files had inline padding={{ }} extracted to module-level constants
    // in the performance-improvements branch (T1.8)
    const chartFilesWithExtractedPadding = [
      'components/activity/ActivityDataChart.tsx',
      'components/activity/SingularPlot.tsx',
      'components/activity/CombinedPlot.tsx',
      'components/fitness/FitnessChart.tsx',
      'components/fitness/FormZoneChart.tsx',
      'components/stats/PowerCurveChart.tsx',
      'components/stats/PaceCurveChart.tsx',
      'components/routes/performance/UnifiedPerformanceChart.tsx',
      'components/home/MiniFormChart.tsx',
    ];

    for (const file of chartFilesWithExtractedPadding) {
      it(`${path.basename(file)} has CHART_PADDING constant`, () => {
        const source = readComponent(file);
        expect(source).toMatch(/const\s+CHART_PADDING\s*=/);
      });
    }

    it('FitnessFormChart.tsx has extracted padding constants', () => {
      const source = readComponent('components/fitness/FitnessFormChart.tsx');
      // Uses separate constants for fitness vs form sub-charts
      expect(source).toMatch(/const\s+\w+_CHART_PADDING\s*=/);
    });
  });

  describe('Zustand selector patterns', () => {
    it('AuthGate uses individual AuthStore selectors', () => {
      const source = readComponent('app/_layout.tsx');
      expect(source).toMatch(/useAuthStore\(\(s\)\s*=>\s*s\.isAuthenticated\)/);
      expect(source).toMatch(/useAuthStore\(\(s\)\s*=>\s*s\.isLoading\)/);
    });

    it('settings.tsx uses individual store selectors', () => {
      const source = readComponent('app/settings.tsx');
      // Should not destructure entire stores
      expect(source).not.toMatch(/const\s+\{[^}]+\}\s*=\s*useSportPreference\(\)/);
      expect(source).not.toMatch(/const\s+\{[^}]+\}\s*=\s*useLanguageStore\(\)/);
      expect(source).not.toMatch(/const\s+\{[^}]+\}\s*=\s*useUnitPreference\(\)/);
    });

    it('map.tsx uses individual route settings selector', () => {
      const source = readComponent('app/(tabs)/map.tsx');
      expect(source).not.toMatch(/const\s+\{[^}]+\}\s*=\s*useRouteSettings\(\)/);
    });
  });

  describe('list virtualization', () => {
    it('section detail uses FlatList for activity list', () => {
      const source = readComponent('app/section/[id].tsx');
      expect(source).toContain('FlatList');
      // Should NOT have .map() rendering full activity cards in a ScrollView
      // The FlatList is the primary list renderer
    });

    it('section detail does not render all activities eagerly with .map()', () => {
      const source = readComponent('app/section/[id].tsx');
      // Look for patterns like `activities.map(` or `traversals.map(` that render full cards
      // The FlatList renderItem should handle this instead
      const lines = source.split('\n');
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip if inside FlatList renderItem or data transform
        if (line.includes('renderItem') || line.includes('keyExtractor')) continue;
        // Check for .map() rendering components that should be in FlatList
        if (/\.(map|forEach)\(\s*\([^)]*\)\s*=>\s*\(?\s*<(ActivityRow|Pressable|Card)/.test(line)) {
          violations.push(`Line ${i + 1}: ${line.trim()}`);
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
