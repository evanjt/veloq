// Cutting a section from one ride. The ends are the brush on the charts, or two
// grips dragged along the track on the map, or the distances typed here; the
// three read and write the page's one range, so they never disagree. Save sends
// `section.create` with that range of the stored track, and the toast's undo
// takes the new section out again. The engine stores and measures it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IndexRange } from '../charts/scale';
import { distanceUnit, distanceValue, km, metresOfDistance } from '../format';
import type { QueryClient } from '../query';
import { createAsk, indexAtDistance, keepsEnough, moved, type Handle } from '../sectionBounds';
import { Button, TextField } from '../ui';
import { useBatch } from '../useBatch';

/** The range as the span helpers take it. */
const spanOf = (range: IndexRange) => ({ start: range.from, end: range.to });

/** The distance field a handle is typed into: what it shows, and what committing it does. */
function DistanceField(props: {
  label: string;
  metres: number | undefined;
  onCommit: (metres: number) => void;
}) {
  const shown = props.metres === undefined ? '' : distanceValue(props.metres);
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    const value = Number.parseFloat((typed ?? '').replace(',', '.'));
    setTyped(null);
    if (Number.isFinite(value)) props.onCommit(metresOfDistance(value));
  };
  return (
    <TextField
      label={props.label}
      inputMode="decimal"
      value={typed ?? shown}
      onChange={setTyped}
      onBlur={() => typed !== null && commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

export function CreateSectionPanel(props: {
  /** The activity the section is cut from. */
  id: string;
  sport: string;
  /** Metres from the start at each sample. */
  distance: readonly number[];
  range: IndexRange;
  queries: QueryClient;
  onRange: (range: IndexRange) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { distance, range, onClose } = props;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const batch = useBatch(props.queries, t('connectPage.routes.editFailed'));
  const whole = { start: 0, end: Math.max(0, distance.length - 1) };

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const put = (handle: Handle, metres: number) => {
    const index = indexAtDistance(distance, metres);
    if (index === null) return;
    const next = moved(spanOf(range), handle, index, whole);
    props.onRange({ from: next.start, to: next.end });
  };

  const span = spanOf(range);
  const long = (distance[range.to] ?? 0) - (distance[range.from] ?? 0);
  const enough = keepsEnough(span);

  async function save() {
    if (saving || !enough) return;
    setSaving(true);
    const label = name.trim();
    const ok = await batch.run(
      [{ method: 'section.create', params: createAsk(props.id, span, props.sport, name) }],
      label
        ? t('connectPage.activity.createdNamed', { name: label })
        : t('connectPage.activity.created'),
      (answers) => {
        const made = (answers[0] as { sectionId?: string } | undefined)?.sectionId;
        return made ? [{ method: 'section.disable', params: { id: made } }] : [];
      },
      t('connectPage.sections.undo')
    );
    setSaving(false);
    if (ok) props.onClose();
  }

  return (
    <section
      id="create-section"
      className="ui-card"
      aria-label={t('connectPage.activity.createSection')}
    >
      <h2 className="panel-title">{t('connectPage.activity.createSection')}</h2>
      <p className="meta">{t('connectPage.activity.createHint')}</p>
      <div className="create-fields">
        <DistanceField
          label={t('connectPage.activity.createStart', { unit: distanceUnit() })}
          metres={distance[range.from]}
          onCommit={(metres) => put('start', metres)}
        />
        <DistanceField
          label={t('connectPage.activity.createEnd', { unit: distanceUnit() })}
          metres={distance[range.to]}
          onCommit={(metres) => put('end', metres)}
        />
        <TextField
          label={t('connectPage.routes.name')}
          value={name}
          onChange={setName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
        />
        <p className="create-length">
          <span className="meta">{t('connectPage.routes.sortDistance')}</span>{' '}
          <output id="create-length">{km(long)}</output>
        </p>
      </div>
      {enough ? null : (
        <p className="notice" role="alert">
          {t('connectPage.sections.boundsTooShort')}
        </p>
      )}
      {batch.refusal ? (
        <p className="notice" role="alert">
          {batch.refusal}
        </p>
      ) : null}
      <div className="section-actions">
        <Button variant="primary" disabled={!enough} busy={saving} onClick={() => void save()}>
          {t('connectPage.activity.createSave')}
        </Button>
        <Button onClick={props.onClose}>{t('connectPage.sections.cancel')}</Button>
      </div>
    </section>
  );
}
