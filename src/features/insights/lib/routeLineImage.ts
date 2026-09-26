/**
 * Off-screen raster of an activity's route line, for the picture an enriched
 * notification carries on iOS.
 *
 * Skia's CPU surface needs no view, no GL context and no basemap, so it runs
 * wherever the background task runs. What it draws is a line on a flat ground,
 * not a map.
 *
 * Storage location: cacheDirectory/notification_routes/
 */

import { Skia, PaintStyle, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';

import { brand, mapPreviewColors } from '@/theme';
import { projectRouteToBox } from '@/shared/geo/routePreview';
import type { LatLng } from '@/shared/geo/polyline';

const ROUTE_DIR = `${FileSystem.cacheDirectory}notification_routes/`;

/** iOS renders the attachment thumbnail at 2:1 in the expanded banner. */
export const ROUTE_LINE_SIZE = { width: 1024, height: 512 } as const;

const PAD = 64;
const HALO_STROKE = 20;
const LINE_STROKE = 12;

/**
 * PNG bytes for a route line drawn on a flat ground, or `null` when there is
 * nothing to draw: fewer than two points, a non-positive size, or no Skia
 * surface available.
 */
export function renderRouteLinePng(
  coords: LatLng[] | null | undefined,
  width: number,
  height: number
): Uint8Array | null {
  if (!coords || coords.length < 2 || width <= 0 || height <= 0) return null;

  const points = projectRouteToBox(coords, width, height, PAD);
  if (points.length < 2) return null;

  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;

  const path = Skia.Path.Make();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color(mapPreviewColors.light.bg));
  canvas.drawPath(path, strokePaint(mapPreviewColors.routeHalo, HALO_STROKE));
  canvas.drawPath(path, strokePaint(brand.tealLight, LINE_STROKE));

  return surface.makeImageSnapshot().encodeToBytes();
}

/**
 * Draw the route for `activityId` and write it under the cache directory.
 * Returns the file path, or `null` when nothing was drawn or the write failed.
 * A notification without its picture is still worth posting.
 *
 * iOS moves an attachment into its own store when the notification is
 * scheduled, so anything still here is a picture that was never presented.
 * The directory is emptied before each write rather than grown.
 */
export async function writeRouteLineAttachment(
  activityId: string,
  coords: LatLng[] | null | undefined
): Promise<string | null> {
  const bytes = renderRouteLinePng(coords, ROUTE_LINE_SIZE.width, ROUTE_LINE_SIZE.height);
  if (!bytes || bytes.length === 0) return null;

  const path = `${ROUTE_DIR}${activityId}.png`;
  try {
    await FileSystem.deleteAsync(ROUTE_DIR, { idempotent: true });
    await FileSystem.makeDirectoryAsync(ROUTE_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(path, toBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null;
  }
  return path;
}

function strokePaint(color: string, strokeWidth: number) {
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(strokeWidth);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setAntiAlias(true);
  return paint;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
