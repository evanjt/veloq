/**
 * Tests that performance-critical components are properly memoized.
 * Validates React.memo wrapping via source code analysis.
 *
 * Tests are added as components are wrapped - see docs/PERFORMANCE_OPTIMIZATION.md
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../');

function readComponent(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf-8');
}

/**
 * Check that a component file exports with React.memo wrapping.
 * Matches patterns like:
 *   export const Foo = memo(function Foo
 *   export const Foo = React.memo(function Foo
 */
function expectMemoExport(source: string, componentName: string): void {
  const memoPattern = new RegExp(
    `export\\s+const\\s+${componentName}\\s*=\\s*(?:React\\.)?memo\\(`
  );
  expect(source).toMatch(memoPattern);
}

describe('Component memoization', () => {
  describe('UI components', () => {
    it('Badge is wrapped in React.memo', () => {
      const source = readComponent('components/ui/Badge.tsx');
      expectMemoExport(source, 'Badge');
    });

    it('Button is wrapped in React.memo', () => {
      const source = readComponent('components/ui/Button.tsx');
      expectMemoExport(source, 'Button');
    });
  });

  describe('Chart components', () => {
    it('MiniFormChart is wrapped in React.memo', () => {
      const source = readComponent('components/home/MiniFormChart.tsx');
      expectMemoExport(source, 'MiniFormChart');
    });

    it('SummaryCardSparkline is wrapped in React.memo', () => {
      const source = readComponent('components/home/SummaryCardSparkline.tsx');
      expectMemoExport(source, 'SummaryCardSparkline');
    });

    it('ActivityDataChart is wrapped in React.memo', () => {
      const source = readComponent('components/activity/ActivityDataChart.tsx');
      expectMemoExport(source, 'ActivityDataChart');
    });

    it('FitnessFormChart is wrapped in React.memo', () => {
      const source = readComponent('components/fitness/FitnessFormChart.tsx');
      expectMemoExport(source, 'FitnessFormChart');
    });
  });

  describe('Already-memoized components (regression)', () => {
    it('StatCard is wrapped in React.memo', () => {
      const source = readComponent('components/activity/stats/StatCard.tsx');
      expectMemoExport(source, 'StatCard');
    });

    it('ActivityCard is wrapped in React.memo', () => {
      const source = readComponent('components/activity/ActivityCard.tsx');
      expectMemoExport(source, 'ActivityCard');
    });
  });
});
