// A text input. With a `label` it is wrapped with a visible one; without, the
// caller names it with `aria-label`.

import type { InputHTMLAttributes } from 'react';

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label?: string;
};

export function TextField({ label, ...rest }: TextFieldProps) {
  const input = <input {...rest} className="ui-input" />;
  if (label === undefined) return input;
  return (
    <label className="ui-field">
      <span className="ui-field-label">{label}</span>
      {input}
    </label>
  );
}
