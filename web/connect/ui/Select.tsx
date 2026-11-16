// A native select with a visible label, so it keeps the platform's keyboard and
// screen reader behaviour.

export type SelectOption = { value: string; label: string };

export function Select(props: {
  id?: string;
  hideLabel?: boolean;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="ui-field">
      {props.hideLabel ? null : <span className="ui-field-label">{props.label}</span>}
      <select
        id={props.id}
        aria-label={props.hideLabel ? props.label : undefined}
        className="ui-select"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
