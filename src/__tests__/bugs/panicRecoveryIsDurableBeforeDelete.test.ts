/**
 * Scenario: the next launch imports the engine's panic log into the crash sink
 * and empties the file. The sink loads lazily from AsyncStorage, and a write can
 * fail.
 *
 * Expected behaviour: every imported line is persisted beside what was already
 * stored, concurrent appends never replace one another, and the file is emptied
 * only after the write succeeded, so a failed write leaves it for the next launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const KEY = 'veloq-crash-log';

type Sink = typeof import('@/shared/debug/crashLog');
type Recovery = typeof import('@/features/settings/lib/databaseSidecars');

/** A fresh module graph, so the sink's in-memory cache starts cold. */
function freshModules(): { sink: Sink; recovery: Recovery } {
  let loaded: { sink: Sink; recovery: Recovery } | undefined;
  jest.isolateModules(() => {
    loaded = {
      sink: require('@/shared/debug/crashLog'),
      recovery: require('@/features/settings/lib/databaseSidecars'),
    };
  });
  return loaded!;
}

async function stored(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return (JSON.parse(raw ?? '[]') as { message: string }[]).map((e) => e.message);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
  fs.writeAsStringAsync.mockResolvedValue(undefined as never);
});

describe('panic recovery durability', () => {
  it('keeps a stored crash and both recovered lines across a fresh load', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify([{ ts: 1, source: 'js-global', message: 'js crash' }])
    );
    fs.readAsStringAsync.mockResolvedValue('panic one\npanic two');
    const { recovery } = freshModules();

    await recovery.recoverPanicLog('/group/routes.db');

    expect(await stored()).toEqual(['js crash', 'panic one', 'panic two']);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps a JavaScript crash recorded while recovery is in flight', async () => {
    fs.readAsStringAsync.mockResolvedValue('panic one\npanic two');
    const { sink, recovery } = freshModules();

    const recovered = recovery.recoverPanicLog('/group/routes.db');
    sink.recordCrash({ source: 'js-global', message: 'js crash' });
    await recovered;
    await flush();
    await sink.getCrashLog();

    expect((await stored()).sort()).toEqual(['js crash', 'panic one', 'panic two']);
  });

  it('keeps the file while the write is pending and when it fails, then recovers on retry', async () => {
    fs.readAsStringAsync.mockResolvedValue('panic one\npanic two');
    const { recovery } = freshModules();

    let release!: () => void;
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          release = () => reject(new Error('disk full'));
        })
    );

    const first = recovery.recoverPanicLog('/group/routes.db');
    await flush();
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
    release();
    await first;
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
    expect(await stored()).toEqual([]);

    await recovery.recoverPanicLog('/group/routes.db');

    expect(await stored()).toEqual(['panic one', 'panic two']);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the file when the stored log cannot be read', async () => {
    fs.readAsStringAsync.mockResolvedValue('panic one');
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));
    const { recovery } = freshModules();

    await expect(recovery.recoverPanicLog('/group/routes.db')).resolves.toBeUndefined();

    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });
});
