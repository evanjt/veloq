// How the page writes a measurement.

let locale = 'en-GB';
let units: 'metric' | 'imperial' = 'metric';

/** The unit system distances and speeds are written in; the phone's preference. */
export function setUnitSystem(system: 'metric' | 'imperial') {
  units = system;
}

const METRES_PER_MILE = 1609.344;

/** The tag numbers are written in; set once the page has chosen its language. */
export function setNumberLocale(tag: string) {
  locale = tag;
}

const oneDecimal = (value: number) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    value
  );

export const km = (metres: number | null | undefined) =>
  metres == null
    ? null
    : units === 'imperial'
      ? `${oneDecimal(metres / METRES_PER_MILE)} mi`
      : `${oneDecimal(metres / 1000)} km`;

/** A distance as a number in the unit `distanceUnit` names, for an axis that carries the unit in its title. */
export const distanceValue = (metres: number) =>
  oneDecimal(units === 'imperial' ? metres / METRES_PER_MILE : metres / 1000);

/** Metres for a number typed in the unit `distanceUnit` names. */
export const metresOfDistance = (value: number) =>
  units === 'imperial' ? value * METRES_PER_MILE : value * 1000;

/** The unit distances are written in. */
export const distanceUnit = () => (units === 'imperial' ? 'mi' : 'km');

export function clock(seconds: number | null | undefined) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** A pace in decimal minutes per kilometre as minutes and seconds, `5:24`. */
export function paceText(minutes: number): string {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const kmh = (speed: number | null | undefined) =>
  speed == null
    ? null
    : units === 'imperial'
      ? `${oneDecimal((speed * 3600) / METRES_PER_MILE)} mph`
      : `${oneDecimal(speed * 3.6)} km/h`;

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

/** A moment in the phone's local time, as the page writes a start: `2026-11-06 06:00`. */
export function localDateTime(milliseconds: number | null | undefined) {
  if (milliseconds == null) return null;
  const at = new Date(milliseconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Whether distances are written in metres and kilometres. */
export const metricUnits = () => units === 'metric';
