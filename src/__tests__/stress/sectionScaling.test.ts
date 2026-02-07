/**
 * Stress tests for section detail page scalability (GitHub Issue #14).
 *
 * Validates that:
 * 1. Demo fixtures generate 200+ stress test activities
 * 2. Source code uses batch FFI calls instead of per-activity loops
 * 3. Source code uses FlatList virtualization instead of ScrollView + .map()
 * 4. Source code uses on-demand GPS loading instead of eager caching
 * 5. Rust persistence layer handles section_activities in clear()
 * 6. Rust persistence layer wraps save_sections in a transaction
 */

import * as fs from 'fs';
import * as path from 'path';
import { fixtures, type ApiActivity } from '@/data/demo/fixtures';

const SECTION_PAGE_PATH = path.resolve(__dirname, '../../app/section/[id].tsx');
const PERSISTENCE_RS_PATH = path.resolve(
  __dirname,
  '../../../modules/veloqrs/rust/veloqrs/src/persistence.rs'
);
const INDEX_TS_PATH = path.resolve(__dirname, '../../../modules/veloqrs/src/index.ts');
const FIXTURES_PATH = path.resolve(__dirname, '../../data/demo/fixtures.ts');

describe('Section Scaling (Issue #14)', () => {
  describe('Demo stress test fixtures', () => {
    it('should generate 200+ stress test activities', () => {
      const stressActivities = fixtures.activities.filter((a) => a.id.startsWith('demo-stress-'));
      expect(stressActivities.length).toBe(200);
    });

    it('stress activities should all use the same route', () => {
      const stressActivities = fixtures.activities.filter((a) =>
        a.id.startsWith('demo-stress-')
      ) as (ApiActivity & { _routeId?: string })[];
      const routes = new Set(stressActivities.map((a) => a._routeId));
      expect(routes.size).toBe(1);
      expect(routes.has('route-rio-run-1')).toBe(true);
    });

    it('stress activities should have unique IDs', () => {
      const stressIds = fixtures.activities
        .filter((a) => a.id.startsWith('demo-stress-'))
        .map((a) => a.id);
      const unique = new Set(stressIds);
      expect(unique.size).toBe(stressIds.length);
    });
  });

  describe('Batch FFI pattern (Fix 1)', () => {
    let sectionPageSource: string;
    let indexTsSource: string;

    beforeAll(() => {
      sectionPageSource = fs.readFileSync(SECTION_PAGE_PATH, 'utf-8');
      indexTsSource = fs.readFileSync(INDEX_TS_PATH, 'utf-8');
    });

    it('should use extractSectionTracesBatch instead of per-activity extractSectionTrace loop', () => {
      // Should have the batch call
      expect(sectionPageSource).toContain('extractSectionTracesBatch');
      // Should NOT have a loop calling extractSectionTrace individually
      const individualCallPattern = /for\s*\(.*activityId.*\)[\s\S]*?extractSectionTrace\(/;
      expect(sectionPageSource).not.toMatch(individualCallPattern);
    });

    it('should have extractSectionTracesBatch method in FFI wrapper', () => {
      expect(indexTsSource).toContain('extractSectionTracesBatch');
      expect(indexTsSource).toContain('persistentEngineExtractSectionTracesBatch');
    });

    it('should have getActivityMetricsForIds method in FFI wrapper', () => {
      expect(indexTsSource).toContain('getActivityMetricsForIds');
      expect(indexTsSource).toContain('persistentEngineGetActivityMetricsForIds');
    });
  });

  describe('FlatList virtualization (Fix 3)', () => {
    let sectionPageSource: string;

    beforeAll(() => {
      sectionPageSource = fs.readFileSync(SECTION_PAGE_PATH, 'utf-8');
    });

    it('should import FlatList instead of ScrollView', () => {
      expect(sectionPageSource).toContain('FlatList');
      // ScrollView should not be imported from react-native
      const scrollViewImport = /import\s*\{[^}]*ScrollView[^}]*\}\s*from\s*['"]react-native['"]/;
      expect(sectionPageSource).not.toMatch(scrollViewImport);
    });

    it('should use FlatList with renderItem pattern', () => {
      expect(sectionPageSource).toContain('renderItem={renderActivityRow}');
      expect(sectionPageSource).toContain('keyExtractor={keyExtractor}');
    });

    it('should have virtualization props', () => {
      expect(sectionPageSource).toContain('initialNumToRender');
      expect(sectionPageSource).toContain('maxToRenderPerBatch');
      expect(sectionPageSource).toContain('windowSize');
    });

    it('should NOT have sectionActivities.map() in render', () => {
      // The old pattern was: sectionActivities.map((activity, index) => {
      const mapPattern = /sectionActivities\.map\(/;
      expect(sectionPageSource).not.toMatch(mapPattern);
    });
  });

  describe('On-demand GPS loading (Fix 2)', () => {
    let sectionPageSource: string;

    beforeAll(() => {
      sectionPageSource = fs.readFileSync(SECTION_PAGE_PATH, 'utf-8');
    });

    it('should NOT eagerly load all GPS tracks in a loop', () => {
      // Old pattern: for (const activityId of activityIds) { engine.getGpsTrack(activityId) }
      const eagerLoadPattern = /for\s*\(.*activityId.*\)[\s\S]*?getGpsTrack\s*\(\s*activityId\s*\)/;
      expect(sectionPageSource).not.toMatch(eagerLoadPattern);
    });
  });

  describe('Engine metrics instead of API fetch (Fix 4)', () => {
    let sectionPageSource: string;

    beforeAll(() => {
      sectionPageSource = fs.readFileSync(SECTION_PAGE_PATH, 'utf-8');
    });

    it('should use getActivityMetricsForIds instead of useActivities', () => {
      expect(sectionPageSource).toContain('getActivityMetricsForIds');
      // Should not import useActivities
      expect(sectionPageSource).not.toContain('useActivities');
    });
  });

  describe('Rust persistence fixes', () => {
    let persistenceSource: string;

    beforeAll(() => {
      persistenceSource = fs.readFileSync(PERSISTENCE_RS_PATH, 'utf-8');
    });

    it('clear() should delete from section_activities (Fix 6)', () => {
      // Find the clear function and verify it includes section_activities deletion
      const clearMatch = persistenceSource.match(
        /fn\s+clear\s*\([^)]*\)[\s\S]*?(?=\n\s*(?:pub\s+)?fn\s)/
      );
      expect(clearMatch).not.toBeNull();
      expect(clearMatch![0]).toContain('DELETE FROM section_activities');
    });

    it('save_sections() should use a transaction (Fix 7)', () => {
      const saveSectionsMatch = persistenceSource.match(
        /fn\s+save_sections\s*\([^)]*\)[\s\S]*?(?=\n\s*(?:pub\s+)?fn\s)/
      );
      expect(saveSectionsMatch).not.toBeNull();
      expect(saveSectionsMatch![0]).toContain('unchecked_transaction');
      expect(saveSectionsMatch![0]).toContain('tx.commit()');
    });

    it('get_section_by_id() should load full portions (Fix 5)', () => {
      const getSectionMatch = persistenceSource.match(
        /fn\s+get_section_by_id\s*\([^)]*\)[\s\S]*?(?=\n\s*(?:pub\s+)?fn\s)/
      );
      expect(getSectionMatch).not.toBeNull();
      // Should query direction, start_index, end_index from section_activities
      expect(getSectionMatch![0]).toContain('direction');
      expect(getSectionMatch![0]).toContain('start_index');
      expect(getSectionMatch![0]).toContain('end_index');
      expect(getSectionMatch![0]).toContain('distance_meters');
      // Should NOT have activity_portions: vec![]
      expect(getSectionMatch![0]).not.toContain('activity_portions: vec![]');
    });

    it('should have batch trace extraction FFI function (Fix 1)', () => {
      expect(persistenceSource).toContain('persistent_engine_extract_section_traces_batch');
      expect(persistenceSource).toContain('FfiBatchTrace');
    });

    it('should have activity metrics for IDs FFI function (Fix 4)', () => {
      expect(persistenceSource).toContain('persistent_engine_get_activity_metrics_for_ids');
    });
  });
});
