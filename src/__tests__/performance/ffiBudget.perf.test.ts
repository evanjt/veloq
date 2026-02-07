/**
 * FFI instrumentation regression guard.
 *
 * Ensures every RouteEngineClient method calling FFI is wrapped with this.timed(),
 * and no direct persistentEngine* calls leak into src/ outside the wrapper.
 */
import * as fs from 'fs';
import * as path from 'path';

const MODULE_ROOT = path.resolve(__dirname, '../../../modules/veloqrs/src');
const SRC_ROOT = path.resolve(__dirname, '../../');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('FFI budget', () => {
  const indexSource = readFile(path.join(MODULE_ROOT, 'index.ts'));

  describe('RouteEngineClient instrumentation', () => {
    // Extract the class body
    const classStart = indexSource.indexOf('class RouteEngineClient');
    const classBody = indexSource.slice(classStart);

    it('has a timed() helper method', () => {
      expect(classBody).toContain('private timed<T>(name: string, fn: () => T): T');
    });

    it('every persistentEngine* call inside the class uses this.timed()', () => {
      // Find all lines calling persistentEngine* that are NOT inside this.timed()
      const lines = classBody.split('\n');
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip imports, comments, type declarations
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import')) continue;
        // Skip the dynamic require pattern (getSectionDetectionProgress)
        if (line.includes('typeof generated.')) continue;

        // Match direct persistentEngine* calls not wrapped in timed()
        // Exclude persistentEngineIsInitialized — trivial boolean check, no FFI overhead
        if (
          /persistentEngine\w+\(/.test(line) &&
          !line.includes('this.timed(') &&
          !line.includes('persistentEngineIsInitialized')
        ) {
          // Check if the previous line has this.timed(
          const prevLine = i > 0 ? lines[i - 1].trim() : '';
          const prevPrevLine = i > 1 ? lines[i - 2].trim() : '';
          if (!prevLine.includes('this.timed(') && !prevPrevLine.includes('this.timed(')) {
            violations.push(`Line ${i + 1}: ${line}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it('every ffi* call inside the class uses this.timed()', () => {
      const lines = classBody.split('\n');
      const violations: string[] = [];

      // FFI functions imported with aliases: ffiCreateSection, ffiDeleteSection,
      // ffiGetSectionsForActivity, ffiGetSections, ffiGetDownloadProgress
      const ffiAliases = [
        'ffiCreateSection',
        'ffiDeleteSection',
        'ffiGetSectionsForActivity',
        'ffiGetSections',
      ];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import')) continue;

        for (const alias of ffiAliases) {
          if (line.includes(`${alias}(`) && !line.includes('this.timed(')) {
            const prevLine = i > 0 ? lines[i - 1].trim() : '';
            const prevPrevLine = i > 1 ? lines[i - 2].trim() : '';
            if (!prevLine.includes('this.timed(') && !prevPrevLine.includes('this.timed(')) {
              violations.push(`Line ${i + 1}: ${line} (${alias})`);
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it('dynamic require methods (medoid) use this.timed()', () => {
      // These methods use require('./generated/veloqrs') and call generated.*
      const medoidMethods = [
        'setSectionReference',
        'resetSectionReference',
        'getSectionReference',
        'isSectionReferenceUserDefined',
      ];

      for (const method of medoidMethods) {
        // Find the method body
        const methodPattern = new RegExp(`${method}\\([^)]*\\)[^{]*\\{`);
        const match = classBody.match(methodPattern);
        expect(match).not.toBeNull();

        // Find the timed call for this method
        const timedPattern = new RegExp(`this\\.timed\\('${method}'`);
        expect(classBody).toMatch(timedPattern);
      }
    });
  });

  describe('no untracked FFI calls in src/', () => {
    function findTsFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '__tests__') {
          results.push(...findTsFiles(fullPath));
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
      return results;
    }

    it('no file in src/ imports persistentEngine* directly', () => {
      const srcFiles = findTsFiles(SRC_ROOT);
      const violations: string[] = [];

      for (const file of srcFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        // Look for imports of persistentEngine* from veloqrs
        if (/import\s+\{[^}]*persistentEngine/.test(content)) {
          violations.push(path.relative(SRC_ROOT, file));
        }
      }

      expect(violations).toEqual([]);
    });

    it('no file in src/ calls persistentEngine* directly', () => {
      const srcFiles = findTsFiles(SRC_ROOT);
      const violations: string[] = [];

      for (const file of srcFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comments and test files
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
          // Match direct persistentEngine* function calls
          if (/persistentEngine\w+\(/.test(line)) {
            violations.push(`${path.relative(SRC_ROOT, file)}:${i + 1}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('known-slow FFI methods are documented', () => {
    it('getSections is known slow (250-570ms)', () => {
      // Verify the timed wrapper exists for this bottleneck
      expect(indexSource).toContain("this.timed('getSections'");
    });

    it('getSectionSummaries is known slow (277-325ms)', () => {
      expect(indexSource).toContain("this.timed('getSectionSummaries'");
    });

    it('extractSectionTracesBatch is known slow for large batches', () => {
      expect(indexSource).toContain("this.timed('extractSectionTracesBatch'");
    });
  });
});
