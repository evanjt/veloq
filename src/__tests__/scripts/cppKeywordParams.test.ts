/**
 * Scenario: a UniFFI export takes an argument named after a C++ keyword. The
 * Rust compiles, `ffi:check` passes and the TypeScript type checks, then the
 * Android build fails inside CMake because the C++ codegen copies argument
 * names verbatim.
 *
 * Expected behaviour: the export surface gate refuses the name and says which
 * export and which argument, so the failure costs a lint rather than a full
 * Android build.
 */
import { CPP_KEYWORDS, isCppKeyword, findCppKeywordParams } from '../../../scripts/lib/cppKeywords';

describe('C++ keyword parameter names', () => {
  it('names the export and the argument that will not compile', () => {
    const offenders = findCppKeywordParams([
      {
        name: 'set_source_template',
        object: 'BasemapStore',
        file: 'basemap/store.rs',
        line: 42,
        params: ['source', 'template'],
      },
    ]);

    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain('BasemapStore::set_source_template');
    expect(offenders[0]).toContain('template');
  });

  it('passes an export whose arguments are all safe', () => {
    expect(
      findCppKeywordParams([
        { name: 'set_source', file: 'basemap/store.rs', line: 42, params: ['source', 'url'] },
      ])
    ).toEqual([]);
  });

  it('reports every offending argument of one export', () => {
    const offenders = findCppKeywordParams([
      { name: 'render', file: 'a.rs', line: 1, params: ['class', 'ok', 'delete'] },
    ]);
    expect(offenders).toHaveLength(2);
  });

  it('covers the keywords the codegen actually trips on', () => {
    for (const keyword of [
      'template',
      'class',
      'new',
      'delete',
      'operator',
      'namespace',
      'this',
      'private',
      'public',
      'export',
      'union',
      'register',
      'typename',
    ]) {
      expect(isCppKeyword(keyword)).toBe(true);
    }
  });

  it('leaves ordinary Rust argument names alone', () => {
    for (const name of ['source', 'activity_id', 'zoom', 'bounds', 'path', 'template_id']) {
      expect(isCppKeyword(name)).toBe(false);
    }
  });

  it('reads a name through `mut` and whitespace', () => {
    expect(
      findCppKeywordParams([{ name: 'f', file: 'a.rs', line: 1, params: ['mut  template'] }])
    ).toHaveLength(1);
  });

  it('has no empty entry in the keyword list', () => {
    expect(CPP_KEYWORDS.size).toBeGreaterThan(60);
    for (const keyword of CPP_KEYWORDS) expect(keyword.trim()).toBe(keyword);
  });

  it('is empty for an export with no arguments', () => {
    expect(findCppKeywordParams([{ name: 'f', file: 'a.rs', line: 1, params: [] }])).toEqual([]);
  });
});
