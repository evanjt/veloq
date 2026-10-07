import * as FileSystem from 'expo-file-system/legacy';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { replaceFile } from '@/shared/native/replaceFile';

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}));
const mockRequireNativeModule = jest.mocked(requireOptionalNativeModule);
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  moveAsync: jest.fn(async () => {}),
}));

describe('replaceFile', () => {
  const os = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    mockRequireNativeModule.mockReset();
    jest.mocked(FileSystem.moveAsync).mockClear();
  });

  it('replaces through the native rename on iOS, with plain paths', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const native = { replaceFile: jest.fn() };
    mockRequireNativeModule.mockReturnValue(native);

    await replaceFile('file:///docs/a.json.tmp', 'file:///docs/a.json');

    expect(native.replaceFile).toHaveBeenCalledWith('/docs/a.json.tmp', '/docs/a.json');
    expect(mockRequireNativeModule).toHaveBeenCalledWith('VeloqBackupExclusion');
    expect(FileSystem.moveAsync).not.toHaveBeenCalled();
  });

  it('rejects a failed native replace without falling back to a delete-then-move', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue({
      replaceFile: jest.fn(() => {
        throw new Error('EIO');
      }),
    });

    await expect(replaceFile('/docs/a.json.tmp', '/docs/a.json')).rejects.toThrow('EIO');
    expect(FileSystem.moveAsync).not.toHaveBeenCalled();
  });

  it('moves with the file system API on iOS when the native module is not linked', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue(null);

    await replaceFile('/docs/a.json.tmp', '/docs/a.json');

    expect(FileSystem.moveAsync).toHaveBeenCalledWith({
      from: '/docs/a.json.tmp',
      to: '/docs/a.json',
    });
  });

  it('moves with the file system API on Android, which renames over the destination', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await replaceFile('/docs/a.json.tmp', '/docs/a.json');

    expect(FileSystem.moveAsync).toHaveBeenCalledWith({
      from: '/docs/a.json.tmp',
      to: '/docs/a.json',
    });
    expect(mockRequireNativeModule).not.toHaveBeenCalled();
  });
});
