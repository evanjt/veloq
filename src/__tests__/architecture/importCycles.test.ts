/**
 * `src/shared/` is the layer every feature imports, so a cycle inside it is a
 * module-initialisation order bug waiting for the one import that trips it.
 *
 * This was part of the computation-budget file until the wall-clock assertions
 * there left the ordinary suite. It carries no timing and belongs in every run.
 */

describe('the shared layer', () => {
  describe('import graph sanity', () => {
    it('src/shared/ has no circular dependencies', () => {
      const fs = require('fs');
      const path = require('path');
      const libRoot = path.resolve(__dirname, '../../shared');

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
