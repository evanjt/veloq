// Toasts with an optional undo action. The region is a polite live region, a
// toast stays until dismissed or its lifetime ends, and undo is a real button.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { dismissToast, pushToast, toastLifetime, undoToast, type ToastEntry } from './behaviour';
import { Button } from './Button';

type Notify = (message: string, undo?: ToastEntry['undo']) => void;
const ToastContext = createContext<Notify>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastRegion(props: {
  toasts: readonly ToastEntry[];
  dismissLabel: string;
  onDismiss: (id: number) => void;
  onUndo: (id: number) => void;
  /** Called when a pointer or focus enters (true) or leaves (false) the region. */
  onHold?: (held: boolean) => void;
}) {
  const { onHold } = props;
  return (
    <div
      className="ui-toasts"
      role="status"
      aria-live="polite"
      onMouseEnter={() => onHold?.(true)}
      onMouseLeave={() => onHold?.(false)}
      onFocus={() => onHold?.(true)}
      onBlur={() => onHold?.(false)}
    >
      {props.toasts.map((toast) => (
        <div key={toast.id} className="ui-toast">
          <span>{toast.message}</span>
          {toast.undo ? (
            <Button size="sm" variant="ghost" onClick={() => props.onUndo(toast.id)}>
              {toast.undo.label}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={props.dismissLabel}
            onClick={() => props.onDismiss(toast.id)}
          >
            ×
          </Button>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({
  dismissLabel,
  children,
}: {
  dismissLabel: string;
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [held, setHeld] = useState(false);
  const next = useRef(1);
  const notify = useCallback<Notify>((message, undo) => {
    const id = next.current++;
    setToasts((list) => pushToast(list, undo ? { id, message, undo } : { id, message }));
  }, []);
  useEffect(() => {
    const first = toasts[0];
    if (!first || held) return undefined;
    const oldest = first.id;
    const timer = setTimeout(
      () => setToasts((list) => dismissToast(list, oldest)),
      toastLifetime(first)
    );
    return () => clearTimeout(timer);
  }, [toasts, held]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <ToastRegion
        toasts={toasts}
        dismissLabel={dismissLabel}
        onDismiss={(id) => setToasts((list) => dismissToast(list, id))}
        onUndo={(id) => setToasts((list) => undoToast(list, id))}
        onHold={setHeld}
      />
    </ToastContext.Provider>
  );
}
