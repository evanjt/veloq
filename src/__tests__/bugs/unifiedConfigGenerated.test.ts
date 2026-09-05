/**
 * Scenario: the five numbers the detector is validated at were written twice,
 * once as a TypeScript literal and once as `SectionConfig::default()` in
 * Rust, each with a comment pointing at the other and nothing checking that
 * they agree. Once the flip resets the engine to the Rust copy, a drift means
 * the settings screen advertises numbers the detector is not using.
 *
 * Expected behaviour: the TypeScript side is generated from the Rust source,
 * and a change to either without the other fails here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { UNIFIED_CONFIG } from '@/shared/native/engine';
import { readRustSectionDefaults, renderUnifiedConfig } from '../../../scripts/lib/unifiedConfig';

const GENERATED = resolve('src/shared/native/unifiedConfig.generated.ts');
const RUST = resolve('modules/veloqrs/rust/tracematch/src/sections/mod.rs');

describe('the validated detector configuration', () => {
  it('is what the Rust default says it is', () => {
    expect(UNIFIED_CONFIG).toEqual(readRustSectionDefaults(readFileSync(RUST, 'utf-8')));
  });

  it('has a generated file no edit to Rust can leave behind', () => {
    expect(readFileSync(GENERATED, 'utf-8')).toBe(
      renderUnifiedConfig(readRustSectionDefaults(readFileSync(RUST, 'utf-8')))
    );
  });

  it('resolves a field whose default is a helper function, not a literal', () => {
    const source = `
fn default_divergence_threshold() -> f64 {
    0.42
}

impl Default for SectionConfig {
    fn default() -> Self {
        Self {
            proximity_threshold: 200.0,
            min_section_length: 150.0,
            max_section_length: 200_000.0,
            min_activities: 2,
            divergence_threshold: default_divergence_threshold(),
            pool_sports: true,
        }
    }
}
`;

    expect(readRustSectionDefaults(source).divergenceThreshold).toBe(0.42);
  });

  it('refuses a source whose default block it cannot read', () => {
    expect(() => readRustSectionDefaults('impl Default for SectionConfig {}')).toThrow(
      /SectionConfig/
    );
  });

  it('refuses a field the block does not name', () => {
    const source = `
impl Default for SectionConfig {
    fn default() -> Self {
        Self {
            proximity_threshold: 200.0,
        }
    }
}
`;

    expect(() => readRustSectionDefaults(source)).toThrow(/minSectionLength/);
  });
});
