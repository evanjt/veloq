// A search box with a label, a clear button once it holds text, and
// `type="search"` for the platform's own affordances.

export function SearchField(props: {
  id?: string;
  label: string;
  clearLabel: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="ui-field ui-search">
      <span className="ui-field-label">{props.label}</span>
      <span className="ui-search-box">
        <input
          id={props.id}
          type="search"
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        {props.value === '' ? null : (
          <button type="button" aria-label={props.clearLabel} onClick={() => props.onChange('')}>
            ×
          </button>
        )}
      </span>
    </label>
  );
}
