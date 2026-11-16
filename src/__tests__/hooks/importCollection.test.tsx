/**
 * Scenario: the athlete picks files, an archive or a folder and the engine's import job runs.
 * Expected behaviour: one engine call per pick, progress read each second, and every copy the
 * pick made deleted once the job's last progress arrives or the pick is cancelled.
 */
import { act, renderHook } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { FfiImportPhase } from 'veloqrs';

import { useImportCollection } from '@/features/settings/hooks/useImportCollection';
import {
  cancelCollectionImport,
  readImportProgress,
  startCollectionImport,
} from '@/shared/native/collectionImport';

jest.mock('expo-document-picker', () => ({
  ...jest.requireActual('expo-document-picker'),
  getDocumentAsync: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    readDirectoryAsync: jest.fn(),
  },
}));
jest.mock('@/shared/native/collectionImport', () => ({
  startCollectionImport: jest.fn(() => true),
  cancelCollectionImport: jest.fn(),
  readImportProgress: jest.fn(),
}));

const picker = DocumentPicker.getDocumentAsync as jest.Mock;
const start = startCollectionImport as jest.Mock;
const read = readImportProgress as jest.Mock;
const move = FileSystem.moveAsync as jest.Mock;
const del = FileSystem.deleteAsync as jest.Mock;

const empty = {
  seen: 0,
  stored: 0,
  alreadyStored: 0,
  failed: 0,
  otherFormat: 0,
  skipped: 0,
  current: undefined,
  halt: undefined,
  failures: [],
};
const running = { ...empty, phase: FfiImportPhase.Running, seen: 5, current: 'c.fit' };
const done = {
  ...empty,
  phase: FfiImportPhase.Done,
  seen: 5,
  stored: 3,
  alreadyStored: 1,
  failed: 1,
  failures: [{ name: 'd.fit', key: 'k', reason: 'truncated record' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  start.mockReturnValue(true);
  read.mockReturnValue(running);
});
afterEach(() => jest.useRealTimers());

it('hands both picked files to the engine in one call', async () => {
  picker.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///cache/DocumentPicker/a1/a.fit', name: 'a.fit' },
      { uri: 'file:///cache/DocumentPicker/b2/b.fit', name: 'b.fit' },
    ],
  });
  const { result } = await renderHook(() => useImportCollection());
  await act(async () => {
    await result.current.pickFiles();
  });

  expect(picker).toHaveBeenCalledWith(expect.objectContaining({ multiple: true, type: '*/*' }));
  expect(start).toHaveBeenCalledTimes(1);
  const dir = start.mock.calls[0][0] as string;
  expect(move.mock.calls.map(([m]) => m.to)).toEqual([`${dir}/a.fit`, `${dir}/b.fit`]);
});

it('calls nothing when the picker is cancelled', async () => {
  picker.mockResolvedValue({ canceled: true, assets: null });
  const { result } = await renderHook(() => useImportCollection());
  await act(async () => {
    await result.current.pickFiles();
  });
  expect(start).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
  expect(result.current.progress).toBeUndefined();
});

it('shows the counts and the failed file with its reason, then deletes the copies', async () => {
  picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/DocumentPicker/z9/all.zip', name: 'all.zip' }],
  });
  const { result } = await renderHook(() => useImportCollection());
  await act(async () => {
    await result.current.pickArchive();
  });
  expect(start).toHaveBeenCalledWith('file:///cache/DocumentPicker/z9/all.zip');
  expect(result.current.progress?.current).toBe('c.fit');
  expect(del).not.toHaveBeenCalled();

  read.mockReturnValue(done);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });

  expect(result.current.progress).toMatchObject({ stored: 3, alreadyStored: 1, failed: 1 });
  expect(result.current.progress?.failures).toEqual([
    { name: 'd.fit', key: 'k', reason: 'truncated record' },
  ]);
  expect(del).toHaveBeenCalledWith('file:///cache/DocumentPicker/z9/all.zip', {
    idempotent: true,
  });
  read.mockClear();
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(read).not.toHaveBeenCalled();
});

it('cancels the job and still deletes the copies when it settles', async () => {
  picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/DocumentPicker/a1/a.fit', name: 'a.fit' }],
  });
  const { result } = await renderHook(() => useImportCollection());
  await act(async () => {
    await result.current.pickFiles();
  });
  await act(async () => {
    result.current.cancel();
  });
  expect(cancelCollectionImport).toHaveBeenCalledTimes(1);

  read.mockReturnValue({ ...empty, phase: FfiImportPhase.Cancelled });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(del).toHaveBeenCalled();
  expect(result.current.running).toBe(false);
});

it('deletes the copies when the engine refuses to start', async () => {
  start.mockReturnValue(false);
  picker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/DocumentPicker/a1/a.fit', name: 'a.fit' }],
  });
  const { result } = await renderHook(() => useImportCollection());
  await act(async () => {
    await result.current.pickFiles();
  });
  expect(del).toHaveBeenCalled();
  expect(result.current.running).toBe(false);
  expect(result.current.refused).toBe(true);
});
