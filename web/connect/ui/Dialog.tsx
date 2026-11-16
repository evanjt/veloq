// A modal dialog: Tab stays inside it, Escape closes it and focus returns to
// the control that opened it. A confirm names what it changes through its
// title and description and offers the change as its action.

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { dialogKey } from './behaviour';
import { Button, type ButtonVariant } from './Button';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Dialog(props: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!props.open) return undefined;
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => opener.current?.focus();
  }, [props.open]);

  if (!props.open) return null;

  function onKeyDown(event: KeyboardEvent) {
    const controls = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (dialogKey(event, controls, document.activeElement, props.onClose)) event.stopPropagation();
  }

  return (
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div
        ref={panel}
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="ui-dialog-title">
          {props.title}
        </h2>
        {props.description ? <p id={descriptionId}>{props.description}</p> : null}
        {props.children}
        <div className="ui-dialog-actions">{props.actions}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant?: ButtonVariant;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{props.cancelLabel}</Button>
          <Button
            variant={props.variant ?? 'destructive'}
            onClick={() => {
              props.onConfirm();
              props.onClose();
            }}
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    />
  );
}
