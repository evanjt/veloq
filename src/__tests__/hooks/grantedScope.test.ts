import { recordGrantedScope } from '@/features/auth/lib/grantedScope';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useUploadPermissionStore.getState().reset();
});

describe('recordGrantedScope', () => {
  it('records a write grant and reports it', () => {
    expect(recordGrantedScope('ACTIVITY:READ,ACTIVITY:WRITE')).toBe(true);
    const state = useUploadPermissionStore.getState();
    expect(state.hasWritePermission).toBe(true);
    expect(state.needsUpgrade).toBe(false);
    expect(state.grantedScopes).toBe('ACTIVITY:READ,ACTIVITY:WRITE');
  });

  it('records a read-only grant as denied', () => {
    expect(recordGrantedScope('ACTIVITY:READ,WELLNESS:READ')).toBe(false);
    const state = useUploadPermissionStore.getState();
    expect(state.hasWritePermission).toBe(false);
    expect(state.needsUpgrade).toBe(true);
  });

  it('treats a missing scope string as not granted', () => {
    useUploadPermissionStore.getState().setHasWritePermission(true);
    expect(recordGrantedScope(undefined)).toBe(false);
    expect(useUploadPermissionStore.getState().hasWritePermission).toBe(false);
  });
});
