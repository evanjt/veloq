/**
 * Bundle budget tests.
 *
 * File size and import analysis to prevent bundle bloat.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../');

describe('Bundle budget', () => {
  describe('demo fixtures size', () => {
    it('fixtures.ts stays under 500KB', () => {
      const fixturesPath = path.join(SRC_ROOT, 'data/demo/fixtures.ts');
      const stats = fs.statSync(fixturesPath);
      const sizeKB = stats.size / 1024;
      expect(sizeKB).toBeLessThan(500);
    });

    it('wellness.ts stays under 200KB', () => {
      const wellnessPath = path.join(SRC_ROOT, 'data/demo/wellness.ts');
      const stats = fs.statSync(wellnessPath);
      const sizeKB = stats.size / 1024;
      expect(sizeKB).toBeLessThan(200);
    });
  });

  describe('barrel export hygiene', () => {
    it('src/lib/utils/index.ts does not import React', () => {
      const indexPath = path.join(SRC_ROOT, 'lib/utils/index.ts');
      if (!fs.existsSync(indexPath)) return; // Skip if no barrel
      const content = fs.readFileSync(indexPath, 'utf-8');
      expect(content).not.toMatch(/from\s+['"]react['"]/);
    });

    it('src/lib/index.ts does not import React', () => {
      const indexPath = path.join(SRC_ROOT, 'lib/index.ts');
      if (!fs.existsSync(indexPath)) return;
      const content = fs.readFileSync(indexPath, 'utf-8');
      expect(content).not.toMatch(/from\s+['"]react['"]/);
    });

    it('utility modules in src/lib/utils/ do not import React', () => {
      const utilsDir = path.join(SRC_ROOT, 'lib/utils');
      if (!fs.existsSync(utilsDir)) return;
      const files = fs.readdirSync(utilsDir).filter((f) => /\.(ts|tsx)$/.test(f));
      const violations: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(utilsDir, file), 'utf-8');
        // Check for React import (not type-only imports)
        if (/^import\s+(?!type\s).*from\s+['"]react['"]/.test(content)) {
          violations.push(file);
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('renderTimer exports', () => {
    it('renderTimer.ts exports getFFIMetrics and getFFIMetricsSummary', () => {
      const source = fs.readFileSync(path.join(SRC_ROOT, 'lib/debug/renderTimer.ts'), 'utf-8');
      expect(source).toContain('export function getFFIMetrics');
      expect(source).toContain('export function getFFIMetricsSummary');
      expect(source).toContain('export function recordFFIMetric');
      expect(source).toContain('export function clearFFIMetrics');
    });
  });
});
