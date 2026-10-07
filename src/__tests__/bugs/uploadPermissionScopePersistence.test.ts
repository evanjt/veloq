import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockSettings.delete(key);
  }),
}));

beforeEach(() => {
  mockSettings.clear();
  useUploadPermissionStore.getState().reset();
});

async function relaunch(): Promise<void> {
  await Promise.resolve();
  useUploadPermissionStore.setState({ grantedScopes: null, isLoaded: false });
  await useUploadPermissionStore.getState().initialize();
}

it('keeps granted scopes after the banner is dismissed and the app relaunches', async () => {
  useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:READ,WELLNESS:READ');
  useUploadPermissionStore.getState().dismissBanner();
  await relaunch();
  expect(useUploadPermissionStore.getState().grantedScopes).toBe('ACTIVITY:READ,WELLNESS:READ');
});

it('keeps granted scopes after an upload loses write permission and the app relaunches', async () => {
  useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:WRITE,WELLNESS:READ');
  useUploadPermissionStore.getState().setHasWritePermission(false);
  await relaunch();
  expect(useUploadPermissionStore.getState().grantedScopes).toBe('ACTIVITY:WRITE,WELLNESS:READ');
});

it('forgets scopes when account permissions reset', () => {
  useUploadPermissionStore.getState().setFromOAuthScope('ACTIVITY:WRITE');
  useUploadPermissionStore.getState().reset();
  expect(useUploadPermissionStore.getState().grantedScopes).toBeNull();
});
