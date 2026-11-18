// Editing a section's ends on the section page. Two grips on the map are dragged
// along the section's own line, or along the track of the ride it was cut from
// once that is shown beyond the ends; each lands on a vertex. A save sends the
// edit with the vertex indices, and the toast's undo reverts to the version the
// section held before it. The engine measures and keeps the section: the length,
// slope and lap count shown while dragging are its preview of the ends.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { km } from '../format';
import type { BoundsEditor } from '../map/SectionMap';
import type { QueryClient } from '../query';
import { pointsOf } from '../preview';
import type { Methods } from '../schema';
import {
  keepsEnough,
  lngLatOf,
  moved,
  paddedWindow,
  resetWrite,
  snapIndex,
  trimWrite,
  expandWrite,
  undoOfEdit,
  escapeAction,
  shownBounds,
  type Handle,
  type Span,
} from '../sectionBounds';
import { Button, ConfirmDialog, SegmentedControl } from '../ui';
import type { Batch } from '../useBatch';
import { useRead } from '../useRead';

type Section = NonNullable<Methods['section.detail']['result']['section']>;

export type EditMode = 'trim' | 'expand';

type Draft = { mode: EditMode; span: Span };

/** What the page holds while the ends are being edited, or null. */
export type BoundsEditing = {
  /** What the map draws and reports. */
  map: BoundsEditor | null;
  /** The panel over the tabs; null while no edit is open. */
  panel: ReactNode;
  begin: () => void;
  active: boolean;
};

/** The edit a draft would send: an expand over the reference ride's track, or a trim of the line. */
function writeOf(draft: Draft, extension: { activityId: string } | undefined, id: string) {
  return draft.mode === 'expand' && extension
    ? expandWrite(id, extension.activityId, draft.span)
    : trimWrite(id, draft.span);
}

export function useBoundsEditing(args: {
  id: string;
  section: Section | null;
  hasOriginalBounds: boolean;
  phone: QueryClient;
  batch: Batch;
}): BoundsEditing {
  const { id, section, phone, batch } = args;
  const { t } = useTranslation();
  const [held, setDraft] = useState<(Draft & { of: string }) | null>(null);
  // An edit belongs to the section it was begun on, so another section starts with none.
  const draft = held?.of === id ? held : null;
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const encoded = section?.encodedPolyline ?? null;
  const line = useMemo(() => (encoded ? lngLatOf(pointsOf(encoded)) : []), [encoded]);
  const extension = useRead('section.extensionTrack', draft ? { id } : null);
  const track = useMemo(
    () => (extension.data ? lngLatOf(pointsOf(extension.data.encodedTrack)) : []),
    [extension.data]
  );
  const onTrack = useMemo<Span | null>(
    () =>
      extension.data
        ? { start: extension.data.sectionStartIdx, end: extension.data.sectionEndIdx }
        : null,
    [extension.data]
  );
  const mode = draft?.mode ?? 'trim';
  const path = mode === 'expand' ? track : line;
  const whole = useMemo<Span>(() => ({ start: 0, end: Math.max(0, path.length - 1) }), [path]);
  const reach = useMemo<Span>(
    () => (mode === 'expand' && onTrack ? paddedWindow(track, onTrack) : whole),
    [mode, track, onTrack, whole]
  );
  const span = draft?.span ?? whole;
  const view = useMemo(() => ({ path, window: reach, span }), [path, reach, span]);

  const place = (handle: Handle, index: number | null) => {
    if (!draft || index === null) return;
    setDraft({ of: id, mode: draft.mode, span: moved(draft.span, handle, index, reach) });
  };

  const begin = () => setDraft({ of: id, mode: 'trim', span: { start: 0, end: line.length - 1 } });
  const choose = (next: EditMode) => {
    if (next === 'expand' && onTrack) setDraft({ of: id, mode: 'expand', span: onTrack });
    else setDraft({ of: id, mode: 'trim', span: { start: 0, end: line.length - 1 } });
  };

  const unchanged =
    mode === 'trim'
      ? span.start === 0 && span.end === line.length - 1
      : onTrack !== null && span.start === onTrack.start && span.end === onTrack.end;
  const proposed = draft && !unchanged && keepsEnough(span) ? writeOf(draft, extension.data, id) : null;
  const preview = useRead('section.boundsPreview', proposed?.params ?? null);
  const shown = shownBounds(
    unchanged,
    {
      distanceMeters: section?.distanceMeters ?? 0,
      avgGradePercent: section?.avgGradePercent ?? null,
    },
    preview.data ?? null
  );

  const open = draft !== null;
  const dirty = open && !unchanged;
  useEffect(() => {
    if (!open) return undefined;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (escapeAction(dirty) === 'close') setDraft(null);
      else setDiscarding(true);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, dirty]);

  const label = section?.name ?? t('connectPage.routes.unnamedSection');
  const undoLabel = t('connectPage.sections.undo');
  const back = () => undoOfEdit(phone, id);

  async function save() {
    if (!draft || saving) return;
    const write = writeOf(draft, extension.data, id);
    setSaving(true);
    const undo = await back();
    const ok = await batch.run(
      [write],
      t('connectPage.sections.boundsSaved', { name: label, length: km(shown.metres) ?? '' }),
      undo,
      undoLabel
    );
    setSaving(false);
    if (ok) setDraft(null);
  }

  async function reset() {
    if (saving) return;
    setSaving(true);
    const undo = await back();
    const ok = await batch.run(
      [resetWrite(id)],
      t('connectPage.sections.boundsResetDone', { name: label }),
      undo,
      undoLabel
    );
    setSaving(false);
    if (ok) setDraft(null);
  }

  const map: BoundsEditor | null = draft
    ? {
        view,
        labels: {
          start: t('connectPage.sections.boundsStart'),
          end: t('connectPage.sections.boundsEnd'),
        },
        onMove: (handle, at) => place(handle, snapIndex(path, at, reach)),
        onStep: (handle, delta) => place(handle, span[handle] + delta),
      }
    : null;

  const panel = draft ? (
    <section
      id="section-editor"
      className="ui-card"
      aria-label={t('connectPage.sections.editBounds')}
    >
      <h2 className="panel-title">{t('connectPage.sections.editBounds')}</h2>
      <p className="meta">{t('connectPage.sections.boundsHint')}</p>
      <dl className="facts section-facts">
        <dt>{t('connectPage.routes.sortDistance')}</dt>
        <dd id="bounds-length">{km(shown.metres) ?? '–'}</dd>
        <dt>{t('connectPage.sections.grade')}</dt>
        <dd id="bounds-grade">{shown.slope === null ? '–' : `${shown.slope.toFixed(1)} %`}</dd>
      </dl>
      {preview.data ? (
        <p className="meta" id="bounds-laps">
          {t('connectPage.sections.boundsLaps', { count: preview.data.lapsRemeasured })}
        </p>
      ) : null}
      {extension.data ? (
        <SegmentedControl
          label={t('connectPage.sections.boundsShow')}
          value={mode}
          options={[
            { value: 'trim', label: t('connectPage.sections.boundsLine') },
            { value: 'expand', label: t('connectPage.sections.boundsBeyond') },
          ]}
          onChange={choose}
        />
      ) : extension.error ? (
        <p className="meta" role="status">
          {t('connectPage.sections.boundsNoTrack')}
        </p>
      ) : null}
      {keepsEnough(span) ? null : (
        <p className="notice" role="alert">
          {t('connectPage.sections.boundsTooShort')}
        </p>
      )}
      <div className="section-actions">
        <Button
          variant="primary"
          disabled={!keepsEnough(span) || unchanged}
          busy={saving}
          onClick={() => void save()}
        >
          {t('connectPage.sections.boundsSave')}
        </Button>
        <Button disabled={!args.hasOriginalBounds || saving} onClick={() => void reset()}>
          {t('connectPage.sections.boundsReset')}
        </Button>
        <Button
          onClick={() => (escapeAction(dirty) === 'close' ? setDraft(null) : setDiscarding(true))}
        >
          {t('connectPage.sections.cancel')}
        </Button>
      </div>
      <ConfirmDialog
        open={discarding}
        title={t('connectPage.sections.boundsDiscardTitle')}
        description={t('connectPage.sections.boundsDiscardBody')}
        confirmLabel={t('connectPage.sections.boundsDiscard')}
        cancelLabel={t('connectPage.sections.boundsKeepEditing')}
        onConfirm={() => {
          setDiscarding(false);
          setDraft(null);
        }}
        onClose={() => setDiscarding(false)}
      />
    </section>
  ) : null;

  return { map, panel, begin, active: draft !== null };
}
