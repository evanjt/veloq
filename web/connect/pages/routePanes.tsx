// What the routes and sections panes share: one read of the query layer as a pane holds it, the
// text a failed read shows in place, the name in place and the facts list.

import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReadError } from '../query';
import type { Edit } from '../routesEdits';
import type { Methods } from '../schema';
import { ReadNotice } from '../shell/StatePanes';
import { Button, ErrorState, TextField } from '../ui';
import type { Editor } from '../useEdit';
import { useRead as useQueryRead } from '../useRead';

/** One read of the query layer, as the panes hold it: the value, or why there is none. */
export function useRouteRead<T>(
  method: keyof Methods,
  params: object | null
): { value: T | null; failed: boolean; error: ReadError | null; retry: () => void } {
  const read = useQueryRead(method, params as never);
  return {
    value: (read.data as T | undefined) ?? null,
    failed: read.error !== null && read.data === undefined,
    error: read.error,
    retry: read.retry,
  };
}

/** What a failed read shows in place: the update notice for a phone without the method, else the failure. */
export function Refused({
  error,
  title,
  plain = false,
}: {
  error: ReadError;
  title: string;
  plain?: boolean;
}) {
  if (error.kind === 'unsupported') return <ReadNotice error={error} />;
  return plain ? <p className="notice">{title}</p> : <ErrorState title={title} />;
}

/** The name in place: a field and a save, with the engine's refusal under it. */
export function RenameField({
  value,
  label,
  editor,
  edit,
}: {
  value: string;
  label: string;
  editor: Editor;
  edit: (name: string) => Edit;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  return (
    <form
      className="rename"
      onSubmit={(event) => {
        event.preventDefault();
        void editor.run(edit(text.trim()));
      }}
    >
      <TextField label={label} value={text} onChange={setText} />
      <Button type="submit" disabled={text.trim() === value}>
        {t('connectPage.routes.actionRename')}
      </Button>
      {editor.refusal ? (
        <p className="notice" role="alert">
          {editor.refusal}
        </p>
      ) : null}
    </form>
  );
}

export function Facts({ facts }: { facts: [string, string | null][] }) {
  return (
    <dl className="facts">
      {facts
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  );
}
