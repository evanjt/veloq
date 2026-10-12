/**
 * One number as typed into a field. The decimal separator may be a comma or a
 * point, since a decimal pad shows the one the region uses, and a whole number
 * may end on it. Anything that is not exactly one number, such as trailing
 * text, a second separator or a grouping separator beside a decimal one, is
 * null rather than the number it starts with: a truncated value would pass the
 * caller's range check and save the wrong figure. The range is the caller's.
 */
export function parseDecimalInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[-+]?(\d+[.,]?\d*|[.,]\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
