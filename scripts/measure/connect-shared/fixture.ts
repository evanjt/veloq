// Fifty invented rows and six figures, the shape of a feed's first screen.
export const COLUMNS = ['Outing', 'Distance km', 'Time', 'Climb m', 'Load'];
export const ROWS = Array.from({ length: 50 }, (_, i) => ({
  key: `row-${i}`,
  cells: [
    `Outing ${i + 1}`,
    (12.4 + ((i * 7.3) % 90)).toFixed(1),
    `${String(1 + (i % 4)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`,
    String(120 + ((i * 97) % 1400)),
    String(30 + ((i * 31) % 180)),
  ],
}));
export const TILES = [
  ['Distance', '412.6', 'km'],
  ['Time', '18:42', 'h'],
  ['Climb', '6 240', 'm'],
  ['Outings', '23', ''],
  ['Load', '1 180', ''],
  ['Longest', '96.3', 'km'],
] as const;
export function markRendered() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      (window as unknown as { __rendered: number }).__rendered = performance.now();
    })
  );
}
