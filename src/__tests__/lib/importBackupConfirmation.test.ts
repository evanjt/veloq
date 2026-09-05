/**
 * Scenario: a backup file replaces the live database, from the settings
 * screen or from the login screen of a fresh install.
 *
 * Expected behaviour: a library that already holds activities is never
 * traded for a picked file without the athlete accepting the trade, and the
 * question names both sides. The rollback copy is deleted on success, so a
 * mis-picked older snapshot has no way back. A device with nothing to lose
 * is not asked.
 */

import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { restoreDatabaseBackup } from '@/features/settings/lib/backup';

const mockEngine = {
  destroyEngine: jest.fn(),
  getActivityCount: jest.fn().mockReturnValue(120),
  getStats: jest.fn().mockReturnValue({ activityCount: 120, newestDate: 1_760_000_000 }),
  notifyAll: jest.fn(),
  getSetting: jest.fn().mockReturnValue(null),
  setSetting: jest.fn(),
};

const mockNativeModule = {
  validateBackupDatabase: jest.fn(),
  engine: { initWithPath: jest.fn().mockReturnValue(true) },
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/veloq.db',
  getNativeModule: () => mockNativeModule,
  isEngineReady: () => true,
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/shared/query/QueryProvider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: { getState: () => ({ athleteId: 'athlete-1' }) },
}));

jest.mock('@/features/routes/lib/elevationBackfillTrigger', () => ({
  startElevationBackfillAfterUpdate: jest.fn().mockResolvedValue(false),
  clearElevationBackfillStamp: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/routes/lib/cutoverTrigger', () => ({
  startDetectorCutoverAfterUpdate: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/i18n', () => ({
  i18n: {
    t: (key: string, opts?: Record<string, unknown>) => {
      const vars = opts
        ? Object.entries(opts)
            .filter(([name]) => name !== 'defaultValue')
            .map(([, value]) => String(value))
            .join(' ')
        : '';
      return vars ? `${key} ${vars}` : key;
    },
  },
}));

const BACKUP_META = JSON.stringify({
  schema_version: '12',
  athlete_id: 'athlete-1',
  activity_count: 40,
  newest_activity: 1_700_000_000,
});

const LIVE_META = JSON.stringify({
  schema_version: '12',
  athlete_id: 'athlete-1',
  activity_count: 120,
});

function press(label: 'cancel' | 'destructive') {
  (Alert.alert as jest.Mock).mockImplementation((_title, _body, buttons) => {
    const button = buttons?.find((b: { style?: string }) =>
      label === 'cancel' ? b.style === 'cancel' : b.style === 'destructive'
    );
    button?.onPress?.();
  });
}

/** Every copy the restore makes over the live database. */
function overwrites(): unknown[] {
  return (FileSystem.copyAsync as jest.Mock).mock.calls.filter(
    ([args]) => args.to === 'file:///data/veloq.db'
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockEngine.getActivityCount.mockReturnValue(120);
  mockEngine.getStats.mockReturnValue({ activityCount: 120, newestDate: 1_760_000_000 });
  mockNativeModule.engine.initWithPath.mockReturnValue(true);
  mockNativeModule.validateBackupDatabase.mockImplementation((path: string) =>
    path.includes('veloq.db') ? LIVE_META : BACKUP_META
  );
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1024 });
  (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([]);
});

describe('a restore over a library that holds activities', () => {
  it('destroys nothing while the question is unanswered', async () => {
    press('cancel');

    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');

    expect(Alert.alert).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(overwrites()).toHaveLength(0);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });

  it('names both libraries in the question', async () => {
    press('cancel');

    await restoreDatabaseBackup('file:///in/backup.veloqdb');

    const [, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(body).toContain('40');
    expect(body).toContain('120');
  });

  it('goes ahead once the athlete accepts', async () => {
    press('destructive');

    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');

    expect(result.success).toBe(true);
    expect(overwrites()).toHaveLength(1);
  });

  it('asks before a backup that is refused is ever opened', async () => {
    press('cancel');
    mockNativeModule.validateBackupDatabase.mockImplementation((path: string) =>
      path.includes('veloq.db')
        ? LIVE_META
        : JSON.stringify({ schema_version: '12', athlete_id: 'athlete-1', activity_count: 0 })
    );

    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');

    expect(result.success).toBe(false);
    // The refusal is the one that stands, and it is not the question's answer.
    expect(result.error).toMatch(/empty or corrupt/i);
    expect(overwrites()).toHaveLength(0);
  });
});

describe('a restore onto a device with nothing to lose', () => {
  it('asks nothing when the live library is empty', async () => {
    mockEngine.getActivityCount.mockReturnValue(0);
    mockEngine.getStats.mockReturnValue({ activityCount: 0, newestDate: null });

    const result = await restoreDatabaseBackup('file:///in/backup.veloqdb');

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(overwrites()).toHaveLength(1);
  });
});
