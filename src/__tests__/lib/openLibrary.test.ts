/**
 * Scenario: the engine opens the library after launch, on a first sign-in, after
 * an identity wipe and after a snapshot rollback. Each open can create the
 * database or a sidecar, and an unmarked file rides the iOS device backup.
 *
 * Expected behaviour: every open goes through `openLibrary`, which marks the
 * database and both sidecars once the engine reports it opened.
 */
import { excludeExistingFromBackup } from '@/shared/native/backupExclusion';
import { openLibrary } from '@/shared/storage/routeDbLocation';

jest.mock('@/shared/native/backupExclusion', () => ({
  excludeExistingFromBackup: jest.fn(),
}));

const mockCreated: string[] = [];
let mockExisting = new Set<string>();
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockExisting.has(this.uri);
    }
    create() {
      mockCreated.push(this.uri);
      mockExisting.add(this.uri);
    }
  },
}));

const DB = '/var/mobile/Shared/AppGroup/ABC/routes.db';
const mark = excludeExistingFromBackup as jest.Mock;

const PANIC = '/var/mobile/Shared/AppGroup/ABC/veloq_panic.log';

beforeEach(() => {
  mockCreated.length = 0;
  mockExisting = new Set();
  mark.mockReset();
  mark.mockReturnValue(true);
});

describe('openLibrary', () => {
  it('marks the database and both sidecars after the engine opened', () => {
    const order: string[] = [];
    const engine = {
      initWithPath: jest.fn(() => {
        order.push('open');
        return true;
      }),
    };
    mark.mockImplementation(() => {
      order.push('mark');
      return true;
    });

    expect(openLibrary(engine, DB)).toBe(true);

    expect(engine.initWithPath).toHaveBeenCalledWith(DB);
    expect(mark.mock.calls.map(([path]) => path)).toEqual([DB, `${DB}-wal`, `${DB}-shm`, PANIC]);
    expect(order).toEqual(['open', 'mark', 'mark', 'mark', 'mark']);
  });

  it('leaves an empty panic log in place before marking it, so the hook keeps the marked file', () => {
    expect(openLibrary({ initWithPath: () => true }, DB)).toBe(true);

    expect(mockCreated).toEqual([`file://${PANIC}`]);
  });

  it('keeps a panic log already there rather than recreating it', () => {
    mockExisting.add(`file://${PANIC}`);

    expect(openLibrary({ initWithPath: () => true }, DB)).toBe(true);

    expect(mockCreated).toEqual([]);
    expect(mark.mock.calls.map(([path]) => path)).toContain(PANIC);
  });

  it('marks nothing when the engine did not open', () => {
    const engine = { initWithPath: jest.fn(() => false) };

    expect(openLibrary(engine, DB)).toBe(false);

    expect(mark).not.toHaveBeenCalled();
    expect(mockCreated).toEqual([]);
  });

  it('warns on a mark that did not take and still returns the open result', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mark.mockImplementation((path: string) => path !== `${DB}-wal`);

    expect(openLibrary({ initWithPath: () => true }, DB)).toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain(`${DB}-wal`);
    warn.mockRestore();
  });

  it('leaves a file the platform has nothing to mark, without a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mark.mockReturnValue(null);

    expect(openLibrary({ initWithPath: () => true }, DB)).toBe(true);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
