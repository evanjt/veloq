/**
 * Which of the two bulk export pills is running, and what to call it.
 *
 * Its own module because the row and the alert that name the format are
 * rendered on the JavaScript side alone, and `bulkExport.ts` reaches the
 * engine. A component that only needs the name should not pull the native
 * binding in behind it.
 */

export type BulkExportKind = 'gpx' | 'geojson';

/**
 * What the athlete is told they are getting. Not translated: these are file
 * format names and the pills that start the export are labelled with them.
 */
export const BULK_EXPORT_FORMAT_NAME: Record<BulkExportKind, string> = {
  gpx: 'GPX',
  geojson: 'GeoJSON',
};
