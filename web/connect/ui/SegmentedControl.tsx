// A single-choice group drawn as joined segments, the web form of the app's
// ToggleButton. The chosen segment carries `aria-pressed` and a filled ground,
// so the choice is readable without colour.

export type Segment<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>(props: {
  label: string;
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="ui-segmented">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
