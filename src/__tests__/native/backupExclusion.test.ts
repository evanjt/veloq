import { Platform } from 'react-native';

import { excludeExistingFromBackup, excludeFromBackup } from '@/shared/native/backupExclusion';

const mockRequireNativeModule = jest.fn();
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
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

  it('hands the native call a plain path when given a file URI', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const native = { excludeFromBackup: jest.fn(() => true) };
    mockRequireNativeModule.mockReturnValue(native);

    expect(excludeFromBackup('file:///data/documents/backups/')).toBe(true);
    expect(native.excludeFromBackup).toHaveBeenCalledWith('/data/documents/backups/');
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

describe('excludeExistingFromBackup', () => {
  const os = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    mockRequireNativeModule.mockReset();
  });

  it('marks a file through the call that never creates a directory', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const native = {
      excludeFromBackup: jest.fn(() => true),
      excludeExistingFromBackup: jest.fn(() => true),
    };
    mockRequireNativeModule.mockReturnValue(native);

    expect(excludeExistingFromBackup('file:///group/routes.db.corrupt-1')).toBe(true);
    expect(native.excludeExistingFromBackup).toHaveBeenCalledWith('/group/routes.db.corrupt-1');
    expect(native.excludeFromBackup).not.toHaveBeenCalled();
  });

  it('is nothing to do when the file has gone', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue({ excludeExistingFromBackup: jest.fn(() => null) });

    expect(excludeExistingFromBackup('/group/routes.db.corrupt-1')).toBeNull();
  });

  it('reads a native build without the call as the attribute not taking', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockRequireNativeModule.mockReturnValue({ excludeFromBackup: jest.fn(() => true) });

    expect(excludeExistingFromBackup('/group/routes.db.corrupt-1')).toBe(false);
  });

  it('is nothing to do on Android', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    expect(excludeExistingFromBackup('/group/routes.db.corrupt-1')).toBeNull();
    expect(mockRequireNativeModule).not.toHaveBeenCalled();
  });
});
