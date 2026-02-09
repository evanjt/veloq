/**
 * Computation budget tests.
 *
 * Actual timing of pure functions (no native deps) to catch regressions.
 * These run in CI and produce measurable durations for perf-compare.ts.
 */
import { formatDistance, formatDuration, formatPace } from '@/lib/utils/format';

describe('Computation budget', () => {
  describe('formatting throughput', () => {
    it('formatDistance handles 100k calls under 200ms', () => {
      const start = performance.now();
      for (let i = 0; i < 100_000; i++) {
        formatDistance(i * 10, true);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('formatDuration handles 100k calls under 200ms', () => {
      const start = performance.now();
      for (let i = 0; i < 100_000; i++) {
        formatDuration(i);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('formatPace handles 100k calls under 200ms', () => {
      const start = performance.now();
      for (let i = 0; i < 100_000; i++) {
        formatPace(3 + (i % 10), true);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('demo fixtures lazy loading', () => {
    it('fixtures module loads under 200ms', () => {
      // Clear require cache to measure cold load
      const fixturesPath = require.resolve('@/data/demo/fixtures');
      delete require.cache[fixturesPath];

      const start = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fixtures = require('@/data/demo/fixtures');
      const elapsed = performance.now() - start;

      expect(fixtures).toBeDefined();
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('import graph sanity', () => {
    it('src/lib/ has no circular dependencies', () => {
      const fs = require('fs');
      const path = require('path');
      const libRoot = path.resolve(__dirname, '../../lib');

      // Build import graph
      const graph = new Map<string, string[]>();

      function findTsFiles(dir: string): string[] {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules') {
            results.push(...findTsFiles(fullPath));
          } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
            results.push(fullPath);
          }
        }
        return results;
      }

      const files = findTsFiles(libRoot);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const imports: string[] = [];

        // Match relative imports: import ... from './foo' or '../foo'
        const importPattern = /from\s+['"](\.[^'"]+)['"]/g;
        let match;
        while ((match = importPattern.exec(content)) !== null) {
          const resolved = path.resolve(path.dirname(file), match[1]);
          imports.push(resolved);
        }

        graph.set(file, imports);
      }

      // Detect cycles using DFS
      const visited = new Set<string>();
      const inStack = new Set<string>();
      const cycles: string[][] = [];

      function dfs(node: string, pathSoFar: string[]): void {
        if (inStack.has(node)) {
          const cycleStart = pathSoFar.indexOf(node);
          cycles.push(pathSoFar.slice(cycleStart).map((p) => path.relative(libRoot, p)));
          return;
        }
        if (visited.has(node)) return;
        visited.add(node);
        inStack.add(node);

        const deps = graph.get(node) ?? [];
        for (const dep of deps) {
          // Try with extensions
          const candidates = [dep, `${dep}.ts`, `${dep}.tsx`, `${dep}/index.ts`];
          for (const candidate of candidates) {
            if (graph.has(candidate)) {
              dfs(candidate, [...pathSoFar, node]);
              break;
            }
          }
        }

        inStack.delete(node);
      }

      for (const file of files) {
        dfs(file, []);
      }

      expect(cycles).toEqual([]);
    });
  });
});
