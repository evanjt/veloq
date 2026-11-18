// Small controls the pages draw through the kit so no page renders a bare
// button or input: a text field, a checkbox, a switch, a sort header button, a
// chip-shaped disclosure button and a heat map day cell.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';

export function TextField(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'onChange'> & {
    label: string;
    hideLabel?: boolean;
    inputRef?: Ref<HTMLInputElement>;
    onChange?: (value: string) => void;
  }
) {
  const { label, hideLabel, inputRef, onChange, ...rest } = props;
  return (
    <label className="ui-field">
      {hideLabel ? null : <span className="ui-field-label">{label}</span>}
      <input
        {...rest}
        ref={inputRef}
        aria-label={hideLabel ? label : undefined}
        className="ui-select"
        onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
      />
    </label>
  );
}

export function Checkbox(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type' | 'onChange'> & {
    onChange: (checked: boolean) => void;
  }
) {
  const { onChange, ...rest } = props;
  return (
    <input
      {...rest}
      type="checkbox"
      className="ui-checkbox"
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

/** An on and off setting: a labelled checkbox read out as a switch. */
export function Switch(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type' | 'role' | 'onChange'> & {
    label: string;
    onChange: (on: boolean) => void;
  }
) {
  const { label, onChange, ...rest } = props;
  return (
    <label className="ui-switch">
      <input
        {...rest}
        type="checkbox"
        role="switch"
        className="ui-checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function SortButton(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> & {
    children: ReactNode;
  }
) {
  return <button {...props} type="button" className="ui-sort" />;
}

export function ChipButton(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> & {
    buttonRef?: Ref<HTMLButtonElement>;
    children: ReactNode;
  }
) {
  const { buttonRef, ...rest } = props;
  return <button {...rest} ref={buttonRef} type="button" className="chip" />;
}

export function HeatCell(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> & { level: number }
) {
  const { level, ...rest } = props;
  return <button {...rest} type="button" className={`day level-${level}`} />;
}
