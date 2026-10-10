/**
 * Scenario: the log holds a JavaScript crash, then a map renderer dies again
 * and again, and every map surface it carried records each death.
 *
 * Expected behaviour: the JavaScript crash stays shareable, and the renderer
 * deaths keep only their newest few.
 */
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

beforeEach(() => mockStore.clear());

describe('renderer deaths in the crash log', () => {
  it('never displace a JavaScript crash', async () => {
    const log = require('@/shared/debug/crashLog') as typeof import('@/shared/debug/crashLog');
    log.recordCrash({ source: 'js-global', message: 'global crash', fatal: true });
    await flush();
    for (let i = 0; i < 30; i++) {
      log.recordCrash({ source: 'webview-renderer', message: `death ${i}`, fatal: false });
    }
    await flush();

    const entries = await log.getCrashLog();
    const messages = entries.map((e) => e.message);
    expect(messages).toContain('global crash');
    expect(messages).toContain('death 29');
    expect(messages).not.toContain('death 0');
    const deaths = entries.filter((e) => e.source === 'webview-renderer');
    expect(deaths.length).toBeLessThan(10);
  });
});
