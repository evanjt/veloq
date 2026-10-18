/**
 * Scenario: `ffi:unused` counts callers per Rust export, so a client method
 * nothing calls is invisible whenever its export is reached by another name.
 * Five such methods were found by hand for exactly that reason.
 *
 * Expected behaviour: the same count is available per `EngineClient` method,
 * so the next one is found by running the report rather than by reading the
 * class.
 */

import {
  callsIn,
  clientCallRows,
  clientMethodExports,
  clientMethods,
  clientMethodReach,
  clientReachProblems,
  namespaceImports,
  namespaceMethodExports,
} from '../../../scripts/lib/ffiUsage';

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

  it('reads a member declared with method syntax, and skips what no caller can name', () => {
    const source = `
export class EngineClient {
  private constructor() {}

  static getInstance(): EngineClient {
    return instance;
  }

  get ready(): boolean {
    return true;
  }

  set handle(value: Handle | null) {
    this.inner = value;
  }

  private ensureOpen(): boolean {
    return true;
  }

  async runWipe(): Promise<void> {
    await wipe(this);
  }

  timed<T>(name: string, fn: () => T): T {
    return fn();
  }

  clearOrchards(): void {
    if (!this.ready) return;
  }

  getHarvests = (): Harvest[] => harvestDelegates.getHarvests(this);
}
`;

    expect(clientMethods(source)).toEqual([
      'getInstance',
      'runWipe',
      'timed',
      'clearOrchards',
      'getHarvests',
    ]);
  });
});

describe('the EngineClient reach check', () => {
  const reach = new Map([
    ['getOrchards', 2],
    ['getHarvests', 0],
    ['getPruning', 0],
  ]);

  it('passes when every unreached method is listed with a reason', () => {
    expect(clientReachProblems(reach, { getHarvests: 'why', getPruning: 'why' })).toEqual({
      unlisted: [],
      stale: [],
    });
  });

  it('names an unreached method the list does not hold', () => {
    expect(clientReachProblems(reach, { getHarvests: 'why' })).toEqual({
      unlisted: ['getPruning'],
      stale: [],
    });
  });

  it('names a listed method that a caller now reaches, or that the class no longer declares', () => {
    expect(
      clientReachProblems(reach, {
        getHarvests: 'why',
        getPruning: 'why',
        getOrchards: 'why',
        getGrafts: 'why',
      })
    ).toEqual({ unlisted: [], stale: ['getOrchards', 'getGrafts'] });
  });
});

describe('the EngineClient export reach', () => {
  const CLIENT = `
import * as orchard from './delegates/orchard';

export class EngineClient {
  pickPears = () => orchard.pickPears(this);

  searchPears = (term: string) => orchard.searchPears(this, term);
}
`;
  const KEYS = [
    { key: 'OrchardManager.getPears', object: 'OrchardManager', camelName: 'getPears' },
  ];
  const LOCAL = { orchard: 'OrchardManager' };

  const HELPER = `
function readPears(host) {
  return host.engine.orchard().getPears();
}
`;
  const EXPORTS = `
export function pickPears(host) {
  return readPears(host);
}

export function searchPears(host, term) {
  return readPears(host).filter((pear) => pear.name.includes(term));
}
`;

  const rowsFor = (delegate: string) =>
    clientMethodExports(
      CLIENT,
      new Map([['modules/veloqrs/src/delegates/orchard.ts', delegate]]),
      KEYS,
      LOCAL
    );

  it('follows an unexported helper declared after the exports into both callers', () => {
    const rows = rowsFor(EXPORTS + HELPER);

    expect(rows.get('pickPears')).toEqual(['OrchardManager.getPears']);
    expect(rows.get('searchPears')).toEqual(['OrchardManager.getPears']);
  });

  it('follows an unexported helper declared before the exports into both callers', () => {
    const rows = rowsFor(HELPER + EXPORTS);

    expect(rows.get('pickPears')).toEqual(['OrchardManager.getPears']);
    expect(rows.get('searchPears')).toEqual(['OrchardManager.getPears']);
  });
});

describe('the bound namespace export reach', () => {
  const BARREL = `
import { bindDelegates } from './delegates/bind';
import * as orchardDelegates from './delegates/orchard';

export const engine = EngineClient.getInstance();
export const orchard = bindDelegates(engine, orchardDelegates);
`;
  const KEYS = [
    { key: 'OrchardManager.getPears', object: 'OrchardManager', camelName: 'getPears' },
  ];
  const LOCAL = { orchard: 'OrchardManager' };
  const DELEGATE = `
export function pickPears(host) {
  return host.engine.orchard().getPears();
}
`;
  const rows = namespaceMethodExports(
    BARREL,
    new Map([['modules/veloqrs/src/delegates/orchard.ts', DELEGATE]]),
    KEYS,
    LOCAL
  );
  const rowsOf = (caller: string) => {
    const imported = namespaceImports(caller, new Set(rows.keys()));
    return callsIn(caller).flatMap((call) => clientCallRows(call, new Map(), {}, rows, imported));
  };

  it('reaches the export a namespace function forwards to', () => {
    expect(rows.get('orchard')?.get('pickPears')).toEqual(['OrchardManager.getPears']);
  });

  it('attributes a call on a namespace imported from the module, under an alias too', () => {
    expect(rowsOf("import { orchard } from 'veloqrs';\norchard.pickPears();")).toEqual([
      'OrchardManager.getPears',
    ]);
    expect(rowsOf("import { orchard as trees } from 'veloqrs';\ntrees.pickPears();")).toEqual([
      'OrchardManager.getPears',
    ]);
  });

  it('leaves a local of the same name and a type-only import alone', () => {
    expect(rowsOf('const orchard = { pickPears() {} };\norchard.pickPears();')).toEqual([]);
    expect(rowsOf("import type { orchard } from 'veloqrs';\norchard.pickPears();")).toEqual([]);
  });
});
