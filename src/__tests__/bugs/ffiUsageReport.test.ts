/**
 * Scenario: `npm run ffi:unused` is how an unreachable FFI export is meant to
 * be found. It printed "0 functions are exported from Rust but not used",
 * which reads as a clean bill of health and was really a parse that matched
 * nothing: the manifest is Prettier-formatted to single quotes and the regex
 * looked for double.
 *
 * Expected behaviour: the report reads every export the manifest declares, and
 * counts a caller only where a caller would actually be, so a zero is a
 * finding rather than the default.
 *
 * The counting was wrong twice more. It matched a bare identifier, so `current`
 * scored 1,198 callers off `ref.current` and `new` scored 603 off the keyword,
 * and it keyed rows by camel name, which twenty-two exports share, `new` by
 * twelve. A count that cannot name which export it belongs to answers nothing.
 */

import { FFI_EXPORTS } from '../bindings/ffi-exports.generated';
import {
  OWNED_ELSEWHERE,
  type Call,
  callIsAttributed,
  callsIn,
  exportedKeys,
  exportedNames,
  isCallerFile,
  isDelegateFile,
  keyOf,
  reachOf,
  resolveCall,
  exportNameOf,
  standaloneCallsIn,
  typeBindings,
} from '../../../scripts/lib/ffiUsage';

/** The calls, without the offsets, so an expectation reads as the source does. */
function calls(text: string): { receiver: string; method: string }[] {
  return callsIn(text).map(({ receiver, method }) => ({ receiver, method }));
}

function call(receiver: string, method: string): Call {
  return { receiver, method, index: 0 };
}

describe('the FFI usage report', () => {
  it('reads every export the manifest declares', () => {
    expect(exportedNames()).toHaveLength(FFI_EXPORTS.length);
    expect(exportedNames().length).toBeGreaterThan(200);
  });

  it('reads the names themselves, not a subset that happened to match', () => {
    expect(exportedNames()).toEqual(FFI_EXPORTS.map((e) => e.camelName));
  });

  describe('what counts as a caller', () => {
    it.each([
      'src/features/routes/hooks/useSectionRescan.ts',
      'src/app/(tabs)/index.tsx',
      'src/shared/native/engine.ts',
    ])('counts %s', (file) => {
      expect(isCallerFile(file)).toBe(true);
    });

    it.each([
      // The delegate layer forwards every export by name, so counting it
      // scores a delegated-and-never-called export as used. That is the
      // second reason this report under-reported.
      'modules/veloqrs/src/delegates/routes.ts',
      'modules/veloqrs/src/generated/veloqrs.ts',
      'src/__tests__/bindings/ffi-exports.generated.ts',
      'src/__tests__/hooks/useSectionRescan.test.ts',
    ])('does not count %s', (file) => {
      expect(isCallerFile(file)).toBe(false);
    });

    it('tells the delegate layer apart from the rest', () => {
      expect(isDelegateFile('modules/veloqrs/src/delegates/routes.ts')).toBe(true);
      expect(isDelegateFile('modules/veloqrs/src/generated/veloqrs.ts')).toBe(false);
      expect(isDelegateFile('src/features/routes/hooks/useSectionRescan.ts')).toBe(false);
    });
  });

  describe('how far an export reaches', () => {
    it('is called when the app names it', () => {
      expect(reachOf(3, 1)).toBe('called');
    });

    it('is delegated when only the forwarding layer names it', () => {
      // Not the same as used: the delegate renames as it forwards, so this is
      // an export whose screen, if it has one, calls it by another name.
      expect(reachOf(0, 2)).toBe('delegated');
    });

    it('is unreachable when nothing names it at all', () => {
      expect(reachOf(0, 0)).toBe('unreachable');
    });
  });

  it('allowlists only exports that still exist, so the list cannot rot', () => {
    const declared = new Set(exportedKeys().map((k) => k.key));
    for (const key of Object.keys(OWNED_ELSEWHERE)) {
      expect(declared.has(key)).toBe(true);
    }
  });

  it('names a reason for every allowlisted export', () => {
    expect(Object.keys(OWNED_ELSEWHERE).length).toBeGreaterThan(0);
    for (const reason of Object.values(OWNED_ELSEWHERE)) {
      expect(reason).toMatch(/\S/);
    }
  });

  describe('what counts as a call', () => {
    it('ignores a bare identifier that is not a call', () => {
      expect(calls('const node = ref.current;')).toEqual([]);
      expect(calls('const { sections } = props;')).toEqual([]);
    });

    it('reads the receiver and the method of a real call', () => {
      expect(calls('const rows = routeManager.getAll();')).toEqual([
        { receiver: 'routeManager', method: 'getAll' },
      ]);
    });

    it('reads every call on one line, chained ones included', () => {
      // `getAll.concat` is what a chain looks like read left to right, and
      // `concat` is not an export, so it resolves to nothing.
      expect(calls('a.getAll().concat(b.getById(id))')).toEqual([
        { receiver: 'a', method: 'getAll' },
        { receiver: 'getAll', method: 'concat' },
        { receiver: 'b', method: 'getById' },
      ]);
    });

    it('allows the whitespace a formatter leaves', () => {
      expect(calls('engine.getProgress ()')).toEqual([
        { receiver: 'engine', method: 'getProgress' },
      ]);
    });

    it('does not read an optional chain as nothing', () => {
      expect(calls('engine?.getProgress()')).toEqual([
        { receiver: 'engine', method: 'getProgress' },
      ]);
    });
  });

  describe('which export a call belongs to', () => {
    const keys = exportedKeys();

    it('keys a method by the object that owns it', () => {
      expect(keyOf({ object: 'RouteManager', camelName: 'getAll' })).toBe('RouteManager.getAll');
      expect(keyOf({ camelName: 'getDownloadProgress' })).toBe('getDownloadProgress');
    });

    it('gives every manifest entry its own row', () => {
      expect(new Set(keys.map((k) => k.key)).size).toBe(keys.length);
    });

    it('keeps two objects sharing a method name apart', () => {
      const shared = keys.filter((k) => k.camelName === 'getDetailData');
      expect(shared.length).toBeGreaterThan(1);
      expect(new Set(shared.map((k) => k.key)).size).toBe(shared.length);
    });

    it('attributes an unshared name without needing the receiver', () => {
      expect(resolveCall(call('anything', 'getDownloadProgress'), keys)).toEqual([
        'getDownloadProgress',
      ]);
    });

    it('uses the receiver to pick between exports sharing a name', () => {
      const resolved = resolveCall(call('routeManager', 'getDetailData'), keys);
      expect(resolved).toEqual(['RouteManager.getDetailData']);
    });

    it('follows the engine accessor the delegates reach an object through', () => {
      // `host.engine.routes().getAll()`: the receiver is the accessor, and the
      // generated bindings declare what it returns.
      expect(resolveCall(call('routes', 'getDetailData'), keys)).toEqual([
        'RouteManager.getDetailData',
      ]);
      expect(resolveCall(call('sections', 'getDetailData'), keys)).toEqual([
        'SectionManager.getDetailData',
      ]);
    });

    it('reports a shared name it cannot place against every candidate', () => {
      const resolved = resolveCall(call('client', 'getDetailData'), keys);
      expect(resolved.length).toBeGreaterThan(1);
      expect(resolved.every((k) => k.endsWith('.getDetailData'))).toBe(true);
    });

    it('resolves nothing for a method no export declares', () => {
      expect(resolveCall(call('x', 'notAnExport'), keys)).toEqual([]);
    });

    it('counts a placed call and refuses to count one it could not place', () => {
      expect(callIsAttributed(call('routes', 'getDetailData'), keys)).toBe(true);
      // `StyleSheet.create` was 338 of the 341 calls the report gave
      // `VeloqEngine.create`, and gave `SectionManager.create` as well.
      expect(callIsAttributed(call('StyleSheet', 'create'), keys)).toBe(false);
    });

    it('needs a receiver for a method however few exports share the name', () => {
      // `setObserver` is one export's name and still needs placing: letting an
      // unshared name through on its own put `Set.delete`, `String.trim` and
      // `Set.clear` back on the report as 32, 23 and 22 calls to three managers.
      expect(callIsAttributed(call('anything', 'setObserver'), keys)).toBe(false);
      expect(callIsAttributed(call('engine', 'setObserver'), keys, { engine: 'VeloqEngine' })).toBe(
        true
      );
    });

    it('needs no receiver for a standalone export, which has no object', () => {
      expect(callIsAttributed(call('', 'getDownloadProgress'), keys)).toBe(true);
    });
  });

  describe('the shapes the real tree calls through', () => {
    const keys = exportedKeys();

    it('reads a chain a formatter wrapped across lines', () => {
      // `routes.ts` and `maps.ts` both call `.getScreenData(` on a line of its
      // own. Reading line by line found no receiver and dropped the call, so
      // two live exports read as named by nothing.
      const source =
        'return host.engine.routes()\n        .getScreenData(\n          groupId\n        );';
      expect(calls(source)).toEqual([
        { receiver: 'engine', method: 'routes' },
        { receiver: 'routes', method: 'getScreenData' },
      ]);
    });

    it('follows a handle the file declares the type of', () => {
      // `SectionPreview` has no engine accessor: the delegate keeps its own.
      const source =
        'function previewObj(): SectionPreviewLike { return o; }\npreviewObj().centres(5);';
      const local = typeBindings(source);
      expect(local.previewObj).toBe('SectionPreview');
      expect(resolveCall(call('previewObj', 'centres'), keys, local)).toEqual([
        'SectionPreview.centres',
      ]);
    });

    it('reads a constructor, which UniFFI names `new` and the bindings spell `new Thing()`', () => {
      expect(calls('const p = new SectionPreview();')).toEqual([
        { receiver: 'SectionPreview', method: 'new' },
      ]);
    });

    it('counts a standalone export called bare, which has no receiver to require', () => {
      const standalone = new Set(keys.filter((k) => !k.object).map((k) => k.camelName));
      expect(standalone.has('takeFetchAndStoreResult')).toBe(true);
      const found = standaloneCallsIn('const r = takeFetchAndStoreResult();', standalone);
      expect(found.map((c) => c.method)).toEqual(['takeFetchAndStoreResult']);
    });

    it('does not read a standalone name off a receiver as a bare call', () => {
      const standalone = new Set(['setNetworkOnline']);
      expect(standaloneCallsIn('engine.setNetworkOnline(true);', standalone)).toEqual([]);
    });
  });

  describe('the names the bindings change on the way out', () => {
    const keys = exportedKeys();
    const declared = new Set(keys.map((k) => k.camelName));

    it('reads a keyword the bindings escaped with a trailing underscore', () => {
      // `sections().delete_()` is the export the manifest names `delete`.
      expect(exportNameOf('delete_', declared)).toBe('delete');
      expect(resolveCall(call('sections', 'delete_'), keys)).toEqual(['SectionManager.delete']);
    });

    it('leaves a name the manifest declares alone', () => {
      expect(exportNameOf('getAll', declared)).toBe('getAll');
    });

    it('leaves a name nothing declares alone, underscore or not', () => {
      expect(exportNameOf('somethingElse_', declared)).toBe('somethingElse_');
    });

    it('follows an alias to the handle it stands for', () => {
      // `type EngineHandle = VeloqEngineLike` in host.ts, then
      // `readonly engine: EngineHandle` is how every delegate holds it.
      const source =
        'type EngineHandle = VeloqEngineLike;\ninterface H { readonly engine: EngineHandle }';
      expect(typeBindings(source).engine).toBe('VeloqEngine');
    });
  });

  it('accounts for every export with no placed call', () => {
    // The gate only means something if its list is empty for a reason. Each of
    // these carries the reason it has no caller here.
    for (const [key, reason] of Object.entries(OWNED_ELSEWHERE)) {
      expect(reason).toMatch(/\S/);
      expect(key).toMatch(/^[A-Za-z]/);
    }
  });
});
