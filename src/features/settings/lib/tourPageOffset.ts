/** The slide row's horizontal offset that puts slide `index` in a card `width` wide. */
export function tourPageOffset(index: number, width: number): number {
  'worklet';
  return -width * index;
}
