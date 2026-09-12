/**
 * Scenario: the enriched activity notification can carry a picture on iOS, and
 * the only rasteriser in the task's runtime is Skia's CPU surface.
 *
 * Expected behaviour: the route line encodes to PNG bytes at the size asked
 * for, a track too short to draw yields nothing rather than a blank image, and
 * the attachment is offered to expo-notifications only when there is a file.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import {
  renderRouteLinePng,
  writeRouteLineAttachment,
  ROUTE_LINE_SIZE,
} from '@/features/insights/lib/routeLineImage';
import { presentActivityNotification } from '@/features/settings/lib/notificationService';

const surfaces: { width: number; height: number }[] = [];

jest.mock('@shopify/react-native-skia', () => {
  const paths: string[] = [];
  return {
    Skia: {
      Surface: {
        Make: (width: number, height: number) => {
          surfaces.push({ width, height });
          return {
            getCanvas: () => ({
              clear: jest.fn(),
              drawPath: (path: { ops: string }) => paths.push(path.ops),
            }),
            makeImageSnapshot: () => ({
              encodeToBytes: () =>
                new Uint8Array([0x89, 0x50, 0x4e, 0x47, width & 0xff, height & 0xff]),
            }),
          };
        },
      },
      Path: {
        Make: () => {
          const ops: string[] = [];
          return {
            ops,
            moveTo: (x: number, y: number) => ops.push(`M${Math.round(x)},${Math.round(y)}`),
            lineTo: (x: number, y: number) => ops.push(`L${Math.round(x)},${Math.round(y)}`),
          };
        },
      },
      Paint: () => ({
        setColor: jest.fn(),
        setStyle: jest.fn(),
        setStrokeWidth: jest.fn(),
        setStrokeCap: jest.fn(),
        setStrokeJoin: jest.fn(),
        setAntiAlias: jest.fn(),
      }),
      Color: (value: string) => value,
    },
    PaintStyle: { Stroke: 1, Fill: 0 },
    StrokeCap: { Round: 1 },
    StrokeJoin: { Round: 1 },
  };
});

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('activity-1'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
}));

jest.mock('@/theme', () => ({
  brand: { teal: '#14B8A6', tealLight: '#0D9488' },
  mapPreviewColors: { routeHalo: '#FFFFFF', light: { bg: '#e8f4e8' } },
}));

const track = [
  { latitude: 46.5, longitude: 6.6 },
  { latitude: 46.51, longitude: 6.62 },
  { latitude: 46.52, longitude: 6.61 },
];

describe('renderRouteLinePng', () => {
  beforeEach(() => {
    surfaces.length = 0;
    jest.clearAllMocks();
  });

  it('encodes a PNG at the requested size', () => {
    const bytes = renderRouteLinePng(track, 320, 160);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(surfaces).toEqual([{ width: 320, height: 160 }]);
  });

  it('draws nothing for a track of one point', () => {
    expect(renderRouteLinePng([track[0]], 320, 160)).toBeNull();
    expect(surfaces).toHaveLength(0);
  });

  it('draws nothing for an empty track', () => {
    expect(renderRouteLinePng([], 320, 160)).toBeNull();
  });

  it('draws nothing for a non-positive size', () => {
    expect(renderRouteLinePng(track, 0, 160)).toBeNull();
    expect(renderRouteLinePng(track, 320, -1)).toBeNull();
  });

  it('gives the same bytes for the same input twice', () => {
    const first = renderRouteLinePng(track, 320, 160);
    const second = renderRouteLinePng(track, 320, 160);
    expect(Array.from(second!)).toEqual(Array.from(first!));
  });
});

describe('writeRouteLineAttachment', () => {
  beforeEach(() => {
    surfaces.length = 0;
    jest.clearAllMocks();
  });

  it('writes the PNG under the activity id and returns its path', async () => {
    const path = await writeRouteLineAttachment('a1', track);
    expect(path).toBe('file:///cache/notification_routes/a1.png');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/notification_routes/a1.png',
      expect.any(String),
      { encoding: 'base64' }
    );
    expect(surfaces).toEqual([{ width: ROUTE_LINE_SIZE.width, height: ROUTE_LINE_SIZE.height }]);
  });

  it('empties the directory first, so an unpresented picture does not accumulate', async () => {
    await writeRouteLineAttachment('a1', track);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///cache/notification_routes/', {
      idempotent: true,
    });
  });

  it('returns null when there is nothing to draw', async () => {
    expect(await writeRouteLineAttachment('a1', [track[0]])).toBeNull();
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the write fails', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('no space'));
    expect(await writeRouteLineAttachment('a1', track)).toBeNull();
  });
});

describe('presentActivityNotification attachments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('attaches the file on iOS when one is given', async () => {
    Platform.OS = 'ios';
    await presentActivityNotification('a1', 'Ride', 'Done', undefined, '/cache/a1.png');
    const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content;
    expect(content.attachments).toEqual([
      { identifier: 'activity-a1-route', url: '/cache/a1.png', type: 'public.png' },
    ]);
  });

  it('sends no attachments key when no file is given', async () => {
    Platform.OS = 'ios';
    await presentActivityNotification('a1', 'Ride', 'Done');
    const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content;
    expect(content).not.toHaveProperty('attachments');
  });

  it('sends no attachments key on Android, which cannot present one', async () => {
    Platform.OS = 'android';
    await presentActivityNotification('a1', 'Ride', 'Done', undefined, '/cache/a1.png');
    const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content;
    expect(content).not.toHaveProperty('attachments');
  });
});
