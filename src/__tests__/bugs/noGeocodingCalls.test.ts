/**
 * Static regression: no production code may reverse geocode. The Nominatim
 * helpers were disabled for ToS compliance in 0.3.0 and the module itself is
 * gone, so this guards against a reintroduction rather than a stray call.
 * Reviving it needs a caching proxy first.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const EXPORT_NAMES = ['reverseGeocode', 'generateRouteName'] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === '.expo') continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('US-GEO1: no Nominatim geocoding calls in production code', () => {
  it('reverseGeocode / generateRouteName are not imported from production code', () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const name of EXPORT_NAMES) {
        const importRegex = new RegExp(
          `import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+['"][^'"]*geocoding['"]`
        );
        if (importRegex.test(src)) {
          violations.push(`${file}: imports ${name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
