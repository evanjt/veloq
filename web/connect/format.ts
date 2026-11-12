// How the page writes a measurement.

let locale = 'en-GB';

/** The tag numbers are written in; set once the page has chosen its language. */
export function setNumberLocale(tag: string) {
  locale = tag;
}

const oneDecimal = (value: number) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    value
  );

export const km = (metres: number | null | undefined) =>
  metres == null ? null : `${oneDecimal(metres / 1000)} km`;

export function clock(seconds: number | null | undefined) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export const kmh = (speed: number | null | undefined) =>
  speed == null ? null : `${oneDecimal(speed * 3.6)} km/h`;

/** A live clock: `m:ss`, or `h:mm:ss` past an hour. Under zero reads as zero. */
export function elapsed(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A transfer rate: whole bytes under a kilobyte, then kilobytes to one place. */
export const rate = (bytesPerSecond: number) =>
  bytesPerSecond < 1000
    ? `${Math.round(bytesPerSecond)} B/s`
    : `${oneDecimal(bytesPerSecond / 1000)} kB/s`;
