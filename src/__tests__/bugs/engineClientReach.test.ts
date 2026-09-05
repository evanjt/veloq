/**
 * Scenario: `ffi:unused` counts callers per Rust export, so a client method
 * nothing calls is invisible whenever its export is reached by another name.
 * Five were found by hand under `I32` for exactly that reason.
 *
 * Expected behaviour: the same count is available per `EngineClient` method,
 * so the next one is found by running the report rather than by reading the
 * class.
 */

import { clientMethods, clientMethodReach } from '../../../scripts/lib/ffiUsage';

const CLASS = `
export class EngineClient {
  private engine!: VeloqEngine;

  getSections = (): FfiSection[] => sectionDelegates.getSections(this);

  getSectionById = (id: string): FfiSection | null =>
    sectionDelegates.getSectionById(this, id);

  /** A comment naming getSections() is not a call. */
  getGroupSummaries = () => routeDelegates.getGroupSummaries(this);
}
`;

describe('the EngineClient method report', () => {
  it('reads every method the class declares', () => {
    expect(clientMethods(CLASS)).toEqual(['getSections', 'getSectionById', 'getGroupSummaries']);
  });

  it('counts a screen calling the method through the engine handle', () => {
    const reach = clientMethodReach(CLASS, [
      { file: 'src/features/routes/useSections.ts', source: 'engine.getSectionById(id);' },
    ]);

    expect(reach.get('getSectionById')).toBe(1);
    expect(reach.get('getSections')).toBe(0);
  });

  it('does not count the class defining the method as a caller of it', () => {
    const reach = clientMethodReach(CLASS, [
      { file: 'modules/veloqrs/src/EngineClient.ts', source: CLASS },
    ]);

    expect(reach.get('getSections')).toBe(0);
  });

  it('does not count the delegate the method forwards to', () => {
    const reach = clientMethodReach(CLASS, [
      {
        file: 'modules/veloqrs/src/delegates/sections/queries.ts',
        source: 'export function getSections(host) { return host.engine.sections().getAll(); }',
      },
    ]);

    expect(reach.get('getSections')).toBe(0);
  });

  it('does not count a test or a mock as a caller', () => {
    const reach = clientMethodReach(CLASS, [
      { file: 'src/__tests__/hooks/useSections.test.ts', source: 'engine.getSections();' },
      { file: 'src/__mocks__/engine.ts', source: 'engine.getSections();' },
    ]);

    expect(reach.get('getSections')).toBe(0);
  });

  it('does not count a mention inside a comment', () => {
    const reach = clientMethodReach(CLASS, [
      {
        file: 'src/features/activity/useHighlights.ts',
        source: '// indicators come from getSections()\nconst x = 1;',
      },
    ]);

    expect(reach.get('getSections')).toBe(0);
  });

  it('counts a method called through an optional call', () => {
    const reach = clientMethodReach(CLASS, [
      {
        file: 'src/shared/app/GlobalDataSync.tsx',
        source: 'const s = engine.getSections?.() ?? [];',
      },
    ]);

    expect(reach.get('getSections')).toBe(1);
  });
});
