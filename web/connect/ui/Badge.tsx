// A small status label. The tone is always paired with the text, and `mark`
// adds a glyph so the state does not rest on colour.

export type BadgeTone = 'neutral' | 'good' | 'warning' | 'bad';

const MARKS: Record<BadgeTone, string> = { neutral: '', good: '✓', warning: '!', bad: '✕' };

export function Badge(props: { tone?: BadgeTone; children: string }) {
  const tone = props.tone ?? 'neutral';
  return (
    <span className="ui-badge" data-tone={tone}>
      {MARKS[tone] === '' ? null : <span aria-hidden="true">{MARKS[tone]}</span>}
      {props.children}
    </span>
  );
}
