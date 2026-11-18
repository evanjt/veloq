// A list's filter field for the table toolbar: a funnel, a field labelled as a filter, a clear
// button once it holds text, and the "N of M" count in a polite live region. It is the one
// control a collection page filters its rows with; the page keeps the text in the address.

import type { FilterCount } from './filterText';

export type ListFilterProps = {
  id?: string;
  /** Names the field for assistive technology and is its placeholder: "Filter activities". */
  label: string;
  clearLabel: string;
  value: string;
  onChange: (value: string) => void;
  /** Null while the phone has not answered, so the count never reads as a zero it was never given. */
  count: FilterCount | null;
  countText: (count: FilterCount) => string;
};

function Funnel() {
  return (
    <svg
      className="ui-filter-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function ListFilter(props: ListFilterProps) {
  return (
    <div className="ui-list-filter" role="search">
      <span className="ui-filter-box">
        <Funnel />
        <input
          id={props.id}
          type="search"
          aria-label={props.label}
          placeholder={props.label}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        {props.value === '' ? null : (
          <button type="button" aria-label={props.clearLabel} onClick={() => props.onChange('')}>
            ×
          </button>
        )}
      </span>
      <span className="ui-filter-count" aria-live="polite">
        {props.count ? props.countText(props.count) : ''}
      </span>
    </div>
  );
}
