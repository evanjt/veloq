/**
 * Scenario: an export, a backup or a recording's FIT file leaves the app.
 *
 * Expected behaviour: on Android the athlete chooses between saving it to the
 * device through the system's create-document screen, with the file's own name
 * and type and the held backup folder as the starting place, and the share
 * chooser. On iOS the share sheet already carries a save target, so it opens
 * straight away.
 */

import { Alert, type AlertButton, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import { shareExistingFile } from '@/features/settings/lib/shareFile';
import { initialiseI18n } from '@/i18n';

const mockSaveDocument = jest.fn();
const mockGetSetting = jest.fn();

jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: (name: string) =>
    name === 'VeloqBackupExclusion' ? { saveDocument: mockSaveDocument } : null,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getSetting: mockGetSetting }),
}));

const ZIP = 'file:///data/cache/exports/veloq-records-2026-03-14.zip';
const HELD_FOLDER = 'content://com.android.externalstorage.documents/tree/primary%3ATrailLogs';

const originalOS = Platform.OS;
let alert: jest.SpyInstance;

function buttons(): AlertButton[] {
  expect(alert).toHaveBeenCalledTimes(1);
  return alert.mock.calls[0][2] as AlertButton[];
}

function press(label: string): void {
  const button = buttons().find((b) => b.text === label);
  if (!button) throw new Error(`no ${label} button among ${buttons().map((b) => b.text)}`);
  button.onPress?.();
}

/** Let the share call reach its dialog before a button is pressed. */
async function untilAsked(): Promise<void> {
  for (let i = 0; i < 10 && alert.mock.calls.length === 0; i++) await Promise.resolve();
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSaveDocument.mockResolvedValue(true);
  mockGetSetting.mockImplementation((key: string) =>
    key === '__backup_folder' ? HELD_FOLDER : null
  );
});

afterEach(() => {
  alert.mockRestore();
  Platform.OS = originalOS;
});

describe('on Android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('offers Save to device beside Share, with Share not the only way out', async () => {
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    const labels = buttons().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(['Share', 'Save to device', 'Cancel']));
    press('Cancel');
    await shared;
  });

  it('saves through the create-document screen with the file name, type and held folder', async () => {
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    press('Save to device');
    await shared;
    expect(mockSaveDocument).toHaveBeenCalledWith(
      '/data/cache/exports/veloq-records-2026-03-14.zip',
      'veloq-records-2026-03-14.zip',
      'application/zip',
      HELD_FOLDER
    );
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('suggests the name the caller gives over the file name on disk', async () => {
    const shared = shareExistingFile('file:///data/files/recordings/1728-k3j.fit', 'fit', {
      name: 'Morning Paddle.fit',
    });
    await untilAsked();
    press('Save to device');
    await shared;
    expect(mockSaveDocument).toHaveBeenCalledWith(
      '/data/files/recordings/1728-k3j.fit',
      'Morning Paddle.fit',
      'application/vnd.ant.fit',
      HELD_FOLDER
    );
  });

  it('starts from no folder when none is held', async () => {
    mockGetSetting.mockReturnValue(null);
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    press('Save to device');
    await shared;
    expect(mockSaveDocument).toHaveBeenCalledWith(
      expect.any(String),
      'veloq-records-2026-03-14.zip',
      'application/zip',
      null
    );
  });

  it('opens the share chooser when Share is chosen', async () => {
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    press('Share');
    await shared;
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      ZIP,
      expect.objectContaining({ mimeType: 'application/zip' })
    );
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });

  it('does nothing when the choice is dismissed', async () => {
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    const options = alert.mock.calls[0][3] as { onDismiss?: () => void };
    options.onDismiss?.();
    await shared;
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });

  it('settles quietly when the create-document screen is backed out of', async () => {
    mockSaveDocument.mockResolvedValue(false);
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    press('Save to device');
    await expect(shared).resolves.toBeUndefined();
  });

  it('rejects when the copy fails, so the caller reports it', async () => {
    mockSaveDocument.mockRejectedValue(new Error('disk full'));
    const shared = shareExistingFile(ZIP, 'zip');
    await untilAsked();
    press('Save to device');
    await expect(shared).rejects.toThrow('disk full');
  });
});

describe('on iOS', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('opens the share sheet at once, which carries its own save target', async () => {
    await shareExistingFile(ZIP, 'zip');
    expect(alert).not.toHaveBeenCalled();
    expect(mockSaveDocument).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      ZIP,
      expect.objectContaining({ mimeType: 'application/zip' })
    );
  });
});
