import { Platform } from 'react-native';

import { excludeFromBackup } from '@/shared/native/backupExclusion';

const mockRequireNativeModule = jest.fn();
jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => mockRequireNativeModule(name),
}));

describe('excludeFromBackup', () => {
  const os = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    mockRequireNativeModule.mockReset();
  });

  it('returns what the native attribute reads back on iOS', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const native = { excludeFromBackup: jest.fn(() => true) };
    mockRequireNativeModule.mockReturnValue(native);

    expect(excludeFromBackup('/data/documents/basemap-tiles')).toBe(true);
    expect(native.excludeFromBackup).toHaveBeenCalledWith('/data/documents/basemap-tiles');
    expect(mockRequireNativeModule).toHaveBeenCalledWith('VeloqBackupExclusion');
  });

  it('reports an attribute that did not take as false', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue({ excludeFromBackup: jest.fn(() => false) });

    expect(excludeFromBackup('/data/documents/basemap-tiles')).toBe(false);
  });

  it('is nothing to do on Android and never resolves the module', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    expect(excludeFromBackup('/data/documents/basemap-tiles')).toBeNull();
    expect(mockRequireNativeModule).not.toHaveBeenCalled();
  });

  it('is nothing to do when the module is not in the build', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue(null);

    expect(excludeFromBackup('/data/documents/basemap-tiles')).toBeNull();
  });

  it('reads a native failure as the attribute not taking', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue({
      excludeFromBackup: jest.fn(() => {
        throw new Error('no such file');
      }),
    });

    expect(excludeFromBackup('/data/documents/missing')).toBe(false);
  });
});
