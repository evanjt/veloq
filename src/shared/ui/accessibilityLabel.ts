/**
 * The name a screen reader speaks for a grouped element.
 *
 * A labelled pressable is one accessibility element: iOS stops reaching its
 * children and TalkBack reads the label in their place. So the label carries
 * what the element draws, in reading order: the title, the value with its unit
 * once, the context, then a record, a trend word and a delta. Each part is the
 * display string the element already renders, from the formatter it draws
 * with. An absent or blank part is skipped, so a missing value is never spoken
 * as an empty pause, and a part equal to one already spoken is skipped too.
 */
export type AccessibilityLabelPart = string | number | null | undefined | false;

export function composeAccessibilityLabel(...parts: AccessibilityLabelPart[]): string {
  const spoken: string[] = [];
  for (const part of parts) {
    if (part === null || part === undefined || part === false) continue;
    const text = String(part).trim();
    if (text === '' || spoken.includes(text)) continue;
    spoken.push(text);
  }
  return spoken.join(', ');
}
