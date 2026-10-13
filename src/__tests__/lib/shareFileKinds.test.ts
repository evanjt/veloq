/**
 * Scenario: a file or a link leaves the app through the one share helper.
 *
 * Expected behaviour: every kind of file goes out under a specific type and a
 * readable title, a recording under its name and date rather than its storage
 * id, and on iPad the sheet points at the control that opened it.
 */

import { Platform, Share } from 'react-native';
import * as RendererProxy from 'react-native/Libraries/ReactNative/RendererProxy';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  shareCopyAs,
  shareExistingFile,
  shareFile,
  shareText,
  type ShareAnchor,
  type ShareKind,
} from '@/features/settings/lib/shareFile';

jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  shareAsync: jest.fn(async () => undefined),
}));

const originalOS = Platform.OS;

function anchorAt(x: number, y: number, width: number, height: number): ShareAnchor {
  return {
    current: {
      measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
        callback(x, y, width, height),
    },
  } as unknown as ShareAnchor;
}

function sharedOptions() {
  return jest.mocked(Sharing.shareAsync).mock.calls[0][1] ?? {};
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
});

afterEach(() => {
  Platform.OS = originalOS;
});

it.each<[ShareKind, string]>([
  ['gpx', 'application/gpx+xml'],
  ['zip', 'application/zip'],
  ['geojson', 'application/geo+json'],
  ['fit', 'application/vnd.ant.fit'],
  ['text', 'text/plain'],
])('shares a %s file under its own type and a title', async (kind, mimeType) => {
  await shareExistingFile('file:///cache/exports/Lake loop.bin', kind);
  const options = sharedOptions();
  expect(options.mimeType).toBe(mimeType);
  expect(options.mimeType).not.toBe('application/octet-stream');
  expect(options.dialogTitle).toBe('Lake loop.bin');
});

it('titles the sheet with the name the caller gives', async () => {
  await shareExistingFile('file:///cache/exports/x.zip', 'zip', { name: 'Records.zip' });
  expect(sharedOptions().dialogTitle).toBe('Records.zip');
});

it('passes the measured control as the iPad anchor', async () => {
  await shareExistingFile('file:///cache/exports/x.zip', 'zip', {
    anchor: anchorAt(12, 340, 88, 44),
  });
  expect(sharedOptions().anchor).toEqual({ x: 12, y: 340, width: 88, height: 44 });
});

it('shares without an anchor when the control has gone', async () => {
  await shareExistingFile('file:///cache/exports/x.zip', 'zip', { anchor: { current: null } });
  expect(sharedOptions()).not.toHaveProperty('anchor');
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
});

it('writes text content under the kind extension', async () => {
  await shareFile({ content: 'log', name: 'veloq-crash-log', kind: 'text' });
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    'file:///cache/exports/veloq-crash-log.txt',
    'log',
    expect.any(Object)
  );
  expect(sharedOptions().dialogTitle).toBe('veloq-crash-log.txt');
});

it('keeps an extension the name already carries', async () => {
  await shareFile({ content: '<gpx/>', name: 'Lake_loop.gpx', kind: 'gpx' });
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///cache/exports/Lake_loop.gpx',
    expect.any(Object)
  );
});

it('shares a copy under a readable name and deletes the copy afterwards', async () => {
  await shareCopyAs('file:///docs/recordings/1728540000000-k3j9qa.fit', 'fit', 'Lake: loop/2');
  const copied = 'file:///cache/exports/Lake_ loop_2.fit';
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({
    from: 'file:///docs/recordings/1728540000000-k3j9qa.fit',
    to: copied,
  });
  expect(Sharing.shareAsync).toHaveBeenCalledWith(copied, expect.any(Object));
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(copied, { idempotent: true });
});

it('deletes the copy when the share fails, and still rejects', async () => {
  jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('no sheet'));
  await expect(shareCopyAs('file:///docs/r.fit', 'fit', 'Lake loop')).rejects.toThrow('no sheet');
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/exports/Lake loop.fit', {
    idempotent: true,
  });
});

it('rejects when there is no share sheet, so the caller can say so', async () => {
  jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('unavailable'));
  await expect(shareExistingFile('file:///cache/exports/x.zip', 'zip')).rejects.toThrow(
    'unavailable'
  );
});

it('opens without an anchor when the control never answers its measurement', async () => {
  const silent = { current: { measureInWindow: () => {} } } as unknown as ShareAnchor;
  await shareExistingFile('file:///cache/exports/x.zip', 'zip', { anchor: silent });
  expect(sharedOptions()).not.toHaveProperty('anchor');
});

it('shares a link through the text sheet anchored to the control', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const card = { name: 'card' };
  const handle = jest
    .spyOn(RendererProxy, 'findNodeHandle')
    .mockImplementation((node) => (node === card ? 7 : null));
  const anchor = { current: card } as unknown as ShareAnchor;
  await shareText({ message: 'Lake loop', title: 'Lake loop' }, { subject: 'Lake loop', anchor });
  expect(share).toHaveBeenCalledWith(
    { message: 'Lake loop', title: 'Lake loop' },
    { subject: 'Lake loop', anchor: 7 }
  );
  handle.mockRestore();
  share.mockRestore();
});

it('shares a link with no anchor when the control cannot be found', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const anchor = { current: { name: 'not a view' } } as unknown as ShareAnchor;
  await shareText({ message: 'Lake loop' }, { anchor });
  expect(share).toHaveBeenCalledWith({ message: 'Lake loop' }, {});
  share.mockRestore();
});

it('shares a link with no anchor when there is no control', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await shareText({ message: 'Lake loop' });
  expect(share).toHaveBeenCalledWith({ message: 'Lake loop' }, {});
  share.mockRestore();
});
