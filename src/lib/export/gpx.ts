/**
 * GPX 1.1 file generator.
 * Converts GPS points to standard GPX XML for sharing with other apps.
 */

interface GpxPoint {
  latitude: number;
  longitude: number;
  elevation?: number;
}

interface GpxParams {
  name: string;
  points: GpxPoint[];
  time?: string;
  sport?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateGpx({ name, points, time, sport }: GpxParams): string {
  const trkpts = points
    .map((p) => {
      const ele = p.elevation != null ? `\n        <ele>${p.elevation}</ele>` : '';
      return `      <trkpt lat="${p.latitude}" lon="${p.longitude}">${ele}\n      </trkpt>`;
    })
    .join('\n');

  const timeTag = time ? `\n    <time>${escapeXml(time)}</time>` : '';
  const typeTag = sport ? `\n    <type>${escapeXml(sport)}</type>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Veloq"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>${timeTag}
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>${typeTag}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}
