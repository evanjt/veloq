/**
 * Tests that Zustand stores are accessed via individual selectors
 * rather than destructuring the entire store (which causes unnecessary re-renders).
 *
 * Uses source code analysis to verify selector patterns.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), 'utf-8');
}

/**
 * Check that a file uses individual Zustand selectors for a store.
 * Should NOT match: const { foo, bar } = useStore()
 * Should match: const foo = useStore((s) => s.foo)
 */
function expectSelectorPattern(source: string, hookName: string): void {
  // Check no full-store destructuring
  const destructurePattern = new RegExp(`const\\s+\\{[^}]+\\}\\s*=\\s*${hookName}\\(\\)`);
  expect(source).not.toMatch(destructurePattern);
}

describe('Zustand selector patterns', () => {
  it('AuthGate uses individual AuthStore selectors', () => {
    const source = readFile('app/_layout.tsx');
    // Should use useAuthStore((s) => s.isAuthenticated) pattern
    expect(source).toMatch(/useAuthStore\(\(s\)\s*=>\s*s\.isAuthenticated\)/);
    expect(source).toMatch(/useAuthStore\(\(s\)\s*=>\s*s\.isLoading\)/);
  });
});
