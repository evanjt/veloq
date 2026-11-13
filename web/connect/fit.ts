// Lines of latitude and longitude fitted into a box in SVG units. One scale for
// every line given, so lines drawn together keep their relative size. Pure, so
// a test drives it without a browser.

/** A vertex as the engine's track decodes it: latitude, then longitude. */
export type LatLng = [lat: number, lng: number];

export type Box = { width: number; height: number; margin: number };

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The lines fitted into the box, north up and centred. Longitude is squeezed by
 * the cosine of the middle latitude so the shape keeps its proportions. Each
 * vertex is an `[x, y]` rounded to a tenth. Null when the lines have no extent
 * or no vertex at all.
 */
export function fitLines(
  lines: readonly (readonly LatLng[])[],
  box: Box
): [x: number, y: number][][] | null {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const line of lines) {
    for (const [lat, lng] of line) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  if (!Number.isFinite(south) || !Number.isFinite(west)) return null;

  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const width = (east - west) * squeeze;
  const height = north - south;
  if (width === 0 && height === 0) return null;

  const roomX = box.width - 2 * box.margin;
  const roomY = box.height - 2 * box.margin;
  const scale = Math.min(
    width === 0 ? Infinity : roomX / width,
    height === 0 ? Infinity : roomY / height
  );
  const left = box.margin + (roomX - width * scale) / 2;
  const top = box.margin + (roomY - height * scale) / 2;
  return lines.map((line) =>
    line.map(([lat, lng]) => [
      round(left + (lng - west) * squeeze * scale),
      round(top + (north - lat) * scale),
    ])
  );
}
