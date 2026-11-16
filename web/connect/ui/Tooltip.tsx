// A tooltip shown on hover and on keyboard focus after a short delay, hidden by
// Escape, and tied to its control through `aria-describedby`.

import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { TOOLTIP_DELAY_MS } from './behaviour';

export function Tooltip(props: { text: string; children: ReactElement<Record<string, unknown>> }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    cancel();
    timer.current = setTimeout(() => setShown(true), TOOLTIP_DELAY_MS);
  };
  const hide = () => {
    cancel();
    setShown(false);
  };
  useEffect(() => cancel, []);
  return (
    <span
      className="ui-tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => event.key === 'Escape' && hide()}
    >
      {cloneElement(props.children, { 'aria-describedby': shown ? id : undefined })}
      {shown ? (
        <span id={id} role="tooltip" className="ui-tooltip">
          {props.text}
        </span>
      ) : null}
    </span>
  );
}
