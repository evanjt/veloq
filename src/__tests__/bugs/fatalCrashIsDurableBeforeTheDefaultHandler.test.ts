/**
 * Scenario: a fatal JavaScript error reaches the global handler. The default
 * handler it chains to reports the fatal to native, and native ends the
 * process, so anything still queued behind a promise never runs.
 *
 * Expected behaviour: the fatal is on disk before the default handler is
 * called, and the next launch's crash log carries it once. A non-fatal error
 * keeps the asynchronous path, and a write that throws still reaches the
 * default handler.
 */
const mockFiles = new Map<string, string>();
const mockStorage = new Map<string, string>();
const mockOrder: string[] = [];
let mockWriteThrows = false;
let mockDead = false;
let mockSetItemFails = 0;

/** One store every launch reads, as the device's storage outlives a process. */
jest.mock('@react-native-async-storage/async-storage', () => {
  const never = () => new Promise<never>(() => {});
  return {
    getItem: async (key: string) => (mockDead ? never() : (mockStorage.get(key) ?? null)),
    setItem: async (key: string, value: string) => {
      if (mockDead) await never();
      if (mockSetItemFails > 0) {
        mockSetItemFails -= 1;
        throw new Error('storage full');
      }
      mockStorage.set(key, value);
    },
    removeItem: async (key: string) => (mockDead ? never() : void mockStorage.delete(key)),
  };
});

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    write: (content: string, options?: { append?: boolean }) => {
      if (mockWriteThrows) throw new Error('disk full');
      mockOrder.push(`write ${uri}`);
      mockFiles.set(uri, options?.append ? (mockFiles.get(uri) ?? '') + content : content);
    },
  })),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  readAsStringAsync: jest.fn(async (uri: string) => {
    const content = mockFiles.get(uri);
    if (content === undefined) throw new Error('ENOENT');
    return content;
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

type Handler = (error: unknown, isFatal?: boolean) => void;
type CrashLogModule = typeof import('@/shared/debug/crashLog');

const g = global as unknown as {
  __veloqCrashHandlerInstalled?: boolean;
  ErrorUtils?: { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void };
};

/** A fresh module, as a relaunch loads it, with no cache and no queue. */
function launch(): CrashLogModule {
  let mod: CrashLogModule | undefined;
  jest.isolateModules(() => {
    mod = require('@/shared/debug/crashLog');
  });
  return mod!;
}

/** Install the handler over a default that records what was durable when it ran. */
function installOver(defaultHandler: Handler): Handler {
  let installed: Handler = () => {};
  g.__veloqCrashHandlerInstalled = false;
  g.ErrorUtils = {
    getGlobalHandler: () => defaultHandler,
    setGlobalHandler: (h) => {
      installed = h;
    },
  };
  launch().installGlobalCrashHandler();
  return installed;
}

const durable = () => [...mockFiles.values()].join('\n');

/** The process ends: storage work queued before it never completes. */
function die() {
  mockDead = true;
}

/** The next launch, once the dead process has stalled, with storage working again. */
async function relaunch(): Promise<CrashLogModule> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  mockDead = false;
  return launch();
}

beforeEach(() => {
  mockFiles.clear();
  mockStorage.clear();
  mockOrder.length = 0;
  mockWriteThrows = false;
  mockDead = false;
  mockSetItemFails = 0;
});

afterAll(() => {
  delete g.ErrorUtils;
  g.__veloqCrashHandlerInstalled = false;
});

describe('a fatal JavaScript error', () => {
  it('is on disk before the default handler runs, and the next launch shows it', async () => {
    let seenByDefault = '';
    const handler = installOver(() => {
      mockOrder.push('default');
      seenByDefault = durable();
      die();
    });

    handler(new Error('cannot read speed of undefined'), true);

    expect(mockOrder[mockOrder.length - 1]).toBe('default');
    expect(seenByDefault).toContain('cannot read speed of undefined');

    const log = await (await relaunch()).getCrashLog();
    expect(log.map((e) => [e.source, e.message, e.fatal])).toEqual([
      ['js-global', 'cannot read speed of undefined', true],
    ]);

    // The merge is stored, so the file goes and a later launch still has it once.
    expect(mockFiles.size).toBe(0);
    expect((await launch().getCrashLog()).map((e) => e.message)).toEqual([
      'cannot read speed of undefined',
    ]);
  });

  it('appears once when the process survived long enough to store it the slow way', async () => {
    const handler = installOver(() => {});

    handler(new Error('lap counter overflow'), true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await launch().getCrashLog()).map((e) => e.message)).toEqual(['lap counter overflow']);
    expect(mockFiles.size).toBe(0);
  });

  it('keeps the entries already logged when the next launch merges it', async () => {
    mockStorage.set(
      'veloq-crash-log',
      JSON.stringify([{ ts: 1, source: 'react-boundary', message: 'earlier render throw' }])
    );
    const handler = installOver(die);
    handler(new Error('cadence sensor gone'), true);

    expect((await (await relaunch()).getCrashLog()).map((e) => e.message)).toEqual([
      'cadence sensor gone',
      'earlier render throw',
    ]);
  });

  it('keeps the file when the merge cannot be stored, so a later launch tries again', async () => {
    const handler = installOver(die);
    handler(new Error('gear ratio NaN'), true);

    mockSetItemFails = 1;
    expect(await (await relaunch()).getCrashLog()).toEqual([]);
    expect(mockFiles.size).toBe(1);

    expect((await launch().getCrashLog()).map((e) => e.message)).toEqual(['gear ratio NaN']);
    expect(mockFiles.size).toBe(0);
  });

  it('keeps a fatal no launch merged yet when the next process dies too', async () => {
    installOver(die)(new Error('first descent'), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    installOver(die)(new Error('second descent'), true);

    expect((await (await relaunch()).getCrashLog()).map((e) => e.message)).toEqual([
      'second descent',
      'first descent',
    ]);
    expect(mockFiles.size).toBe(0);
  });

  it('skips a line torn by the process ending mid-write and keeps the rest', async () => {
    installOver(die)(new Error('brake fade'), true);
    const [uri] = [...mockFiles.keys()];
    mockFiles.set(uri, `${mockFiles.get(uri)}{"ts":2,"sour`);

    expect((await (await relaunch()).getCrashLog()).map((e) => e.message)).toEqual(['brake fade']);
  });

  it('still reaches the default handler when the write throws', () => {
    mockWriteThrows = true;
    const calls: unknown[] = [];
    const handler = installOver((error, isFatal) => calls.push([error, isFatal]));
    const error = new Error('chain slipped');

    handler(error, true);

    expect(calls).toEqual([[error, true]]);
  });

  it('is gone from disk once the crash log is cleared', async () => {
    const handler = installOver(die);
    handler(new Error('saddle height reset'), true);

    const mod = await relaunch();
    await mod.clearCrashLog();

    expect(mockFiles.size).toBe(0);
    expect(await launch().getCrashLog()).toEqual([]);
  });
});

describe('a non-fatal JavaScript error', () => {
  it('writes no file and is stored the asynchronous way', async () => {
    const handler = installOver(() => {});

    handler(new Error('tyre pressure warning'), false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockOrder).toEqual([]);
    expect((await launch().getCrashLog()).map((e) => [e.message, e.fatal])).toEqual([
      ['tyre pressure warning', false],
    ]);
  });
});
