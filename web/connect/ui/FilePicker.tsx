// A file-pick button: a kit `Button` that opens a visually hidden file input,
// so the browser's own "Choose File" control is never drawn. The input stays
// in the tab order's reach through the button, and a chosen file is handed to
// `onPick` once; the input is cleared so the same file can be picked again.

import { useRef } from 'react';

import { Button, type ButtonVariant } from './Button';

export function FilePicker(props: {
  id: string;
  label: string;
  accept: string;
  onPick: (file: File) => void;
  variant?: ButtonVariant;
}) {
  const { variant = 'secondary' } = props;
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button id={`${props.id}-choose`} variant={variant} onClick={() => input.current?.click()}>
        {props.label}
      </Button>
      <input
        ref={input}
        id={props.id}
        className="ui-visually-hidden"
        type="file"
        accept={props.accept}
        tabIndex={-1}
        aria-label={props.label}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          props.onPick(file);
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
