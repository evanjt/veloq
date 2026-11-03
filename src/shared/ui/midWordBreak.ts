/**
 * Finds a label that the text layout broke inside a word.
 *
 * A label wraps only at spaces, so a line that ends where the label's next character is not
 * whitespace was cut mid-word. The lines come from `onTextLayout`; some platforms keep the
 * trailing space on a line and some drop it, so the label is walked rather than the lines
 * compared with it.
 */

/** The word a break cut, as the label spells it, or null when every break falls at a space. */
export function midWordBreak(label: string, lines: readonly string[]): string | null {
  let at = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const text = (lines[i] ?? '').trim();
    if (text.length === 0) continue;
    const found = label.indexOf(text, at);
    if (found === -1) return null;
    at = found + text.length;
    if (at < label.length && !/\s/.test(label.charAt(at))) {
      const start = label.lastIndexOf(' ', at) + 1;
      const end = label.indexOf(' ', at);
      return label.slice(start, end === -1 ? undefined : end);
    }
    while (at < label.length && /\s/.test(label.charAt(at))) at++;
  }
  return null;
}
