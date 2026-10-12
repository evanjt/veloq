/**
 * The one mark for a value the data does not carry: a measurement never
 * taken, a field the source left out, a read that failed. Printing a zero in
 * its place states a measurement nobody made, and a single hyphen is announced
 * as "minus" by TalkBack and VoiceOver.
 */
export const ABSENT = '--';

const STANDALONE_MARK = /(^|\s)--(?=\s|$)/;
const EVERY_STANDALONE_MARK = new RegExp(STANDALONE_MARK.source, 'g');

/**
 * What a screen reader should speak for `text`: each standalone absent mark
 * read as the localised "no data". Undefined when `text` carries no mark, so it
 * can be passed straight to `accessibilityLabel` and leave the text as spoken.
 */
export function absentLabel(text: string, t: (key: 'common.noData') => string): string | undefined {
  if (!STANDALONE_MARK.test(text)) return undefined;
  const spoken = t('common.noData');
  return text.replace(EVERY_STANDALONE_MARK, (_, lead: string) => `${lead}${spoken}`);
}
