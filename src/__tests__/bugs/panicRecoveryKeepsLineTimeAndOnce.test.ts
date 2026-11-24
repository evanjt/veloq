/**
 * Scenario: the engine's panic log holds RFC 3339-stamped entries, one of which spans
 * several lines, and recovery can run twice or fail to empty the file.
 *
 * Expected behaviour: each panic is one crash entry carrying the time it was logged,
 * and the same panic is stored once however many times the file is recovered.
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

type Recovery = typeof import('@/features/settings/lib/databaseSidecars');

function freshRecovery(): Recovery {
  let loaded: Recovery | undefined;
  jest.isolateModules(() => {
    loaded = require('@/features/settings/lib/databaseSidecars');
  });
  return loaded!;
}

async function stored(): Promise<{ ts: number; message: string }[]> {
  return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
}

const FIRST = '2026-03-04T05:06:07.123456+00:00 [worker] panic at a.rs:1:2: assertion failed';
const LEFT = '  left: 1';
const RIGHT = ' right: 2';
const SECOND = '2026-03-04T06:00:00+00:00 [main] panic at b.rs:3:4: boom';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  fs.getInfoAsync.mockResolvedValue({ exists: true } as never);
  fs.writeAsStringAsync.mockResolvedValue(undefined as never);
});

describe('panic recovery entries', () => {
  it('stores a multi-line panic as one entry stamped with its logged time', async () => {
    fs.readAsStringAsync.mockResolvedValue([FIRST, LEFT, RIGHT, SECOND].join('\n'));

    await freshRecovery().recoverPanicLog('/group/routes.db');

    const entries = await stored();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      ts: Date.parse('2026-03-04T05:06:07.123456+00:00'),
      message: `${FIRST}\nleft: 1\nright: 2`,
    });
    expect(entries[1]).toMatchObject({ ts: Date.parse(SECOND.split(' ')[0]!), message: SECOND });
  });

  it('stores each panic once when the file could not be emptied', async () => {
    fs.readAsStringAsync.mockResolvedValue([FIRST, LEFT, SECOND].join('\n'));
    fs.writeAsStringAsync.mockRejectedValue(new Error('read-only'));
    const recovery = freshRecovery();

    await recovery.recoverPanicLog('/group/routes.db');
    await recovery.recoverPanicLog('/group/routes.db');

    expect(await stored()).toHaveLength(2);
  });

  it('stores each panic once when two recoveries of one file overlap', async () => {
    fs.readAsStringAsync.mockResolvedValue([FIRST, SECOND].join('\n'));
    const recovery = freshRecovery();

    await Promise.all([
      recovery.recoverPanicLog('/group/routes.db'),
      recovery.recoverPanicLog('/group/routes.db'),
    ]);

    expect(await stored()).toHaveLength(2);
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
  });
});
