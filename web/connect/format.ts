// How the page writes a measurement.

export const km = (metres: number | null | undefined) =>
  metres == null ? null : `${(metres / 1000).toFixed(1)} km`;

export function clock(seconds: number | null | undefined) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export const kmh = (speed: number | null | undefined) =>
  speed == null ? null : `${(speed * 3.6).toFixed(1)} km/h`;
