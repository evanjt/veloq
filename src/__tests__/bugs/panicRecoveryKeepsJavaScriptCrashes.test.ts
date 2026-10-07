/**
 * Scenario: the crash log holds a JavaScript global crash and a React boundary
 * crash, then a launch recovers a panic file with more lines than the log keeps.
 *
 * Expected behaviour: both JavaScript entries and the newest panic lines stay
 * shareable, also after the module cache is reset and storage is reloaded, and a
 * second batch cannot consume the JavaScript retention either.
 */
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function panicFile(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i} panic`).join('\n');
}

async function load() {
  jest.resetModules();
  const crash = require('@/shared/debug/crashLog') as typeof import('@/shared/debug/crashLog');
  const sidecars =
    require('@/features/settings/lib/databaseSidecars') as typeof import('@/features/settings/lib/databaseSidecars');
  const fs = require('expo-file-system/legacy') as jest.Mocked<
    typeof import('expo-file-system/legacy')
  >;
  fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
  return { ...crash, ...sidecars, fs };
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('panic recovery against the real crash log', () => {
  it('keeps JavaScript crashes through repeated bulk recoveries and a reload', async () => {
    const m = await load();
    m.recordCrash({ source: 'js-global', message: 'global crash', fatal: true });
    await flush();
    m.recordCrash({ source: 'react-boundary', message: 'boundary crash' });
    await m.getCrashLog();
    await flush();

    m.fs.readAsStringAsync.mockResolvedValue(panicFile('first', 25));
    await m.recoverPanicLog('/group/routes.db');
    await flush();
    m.fs.readAsStringAsync.mockResolvedValue(panicFile('second', 25));
    await m.recoverPanicLog('/group/routes.db');
    await flush();

    const reloaded = await load();
    const log = await reloaded.getCrashLog();
    const messages = log.map((e) => e.message);
    expect(messages).toContain('global crash');
    expect(messages).toContain('boundary crash');
    expect(log.length).toBeLessThanOrEqual(20);
    const panics = log.filter((e) => e.source === 'rust-panic');
    expect(panics.length).toBeGreaterThan(0);
    expect(panics[0]!.message).toBe('second-24 panic');
    expect(reloaded.formatCrashLog(log)).toContain('global crash');
  });

  it('still drops the oldest entries when only one source is present', async () => {
    const m = await load();
    await m.getCrashLog();
    for (let i = 0; i < 25; i++) m.recordCrash({ source: 'js-global', message: `js-${i}` });
    await flush();
    const log = await m.getCrashLog();
    expect(log).toHaveLength(20);
    expect(log[0]!.message).toBe('js-24');
    expect(log[19]!.message).toBe('js-5');
  });
});
